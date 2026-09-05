/**
 * Serviço de Onboarding do Tenant.
 * 
 * Gerencia o processo de onboarding de novos tenants:
 * - Wizard de primeiro acesso
 * - Checklist de configuração
 * - Templates iniciais automáticos
 */

const { getTenant, updateTenant } = require('./tenantService');
const { createAgent } = require('./authService');
const { createQueue } = require('./queueService');
const flowTemplateMarketplaceService = require('./flowTemplateMarketplaceService');
const logger = require('../utils/logger');
const verticalsRegistry = require('../../config/verticals.json');

// IDs canônicos de verticais (kind === 'vertical' em config/verticals.json).
const CANONICAL_VERTICAL_IDS = Object.keys(verticalsRegistry.domains || {})
  .filter((id) => verticalsRegistry.domains[id] && verticalsRegistry.domains[id].kind === 'vertical');

// Aliases declarados no registry resolvem para o ID canônico (ex.: academia→fitness).
const VERTICAL_ALIAS_TO_ID = (() => {
  const map = new Map();
  for (const id of CANONICAL_VERTICAL_IDS) {
    map.set(id, id);
    for (const alias of verticalsRegistry.domains[id].aliases || []) {
      map.set(safeTrim(alias).toLowerCase(), id);
    }
  }
  return map;
})();

// Vertical canônica → chave de segmento do plano de templates (bySegment).
const VERTICAL_TO_TEMPLATE_SEGMENT = {
  beauty: 'servicos',
  fitness: 'academia',
  bakery: 'padaria',
  food: 'varejo',
  services: 'servicos',
  clinic: 'saude',
  market: 'varejo',
};

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function safeTrim(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value).trim();
  } catch (_) {
    return fallback;
  }
}

function safeErrorMessage(err, fallback = '') {
  if (!err) return fallback;
  let message;
  try {
    message = err?.message;
  } catch (_) {
    message = null;
  }

  if (message !== null && message !== undefined) return safeTrim(message, fallback);
  return safeTrim(err, fallback);
}

/**
 * Checklist de onboarding com 3 níveis de prioridade.
 * 
 * 🔴 required: bloqueia acesso se não completo (validado via API)
 * 🟡 recommended: aparece com destaque, não bloqueia
 * ⚪ optional: aparece na checklist sem urgência
 */
const ONBOARDING_CHECKLIST = {
  // 🔴 OBRIGATÓRIO — validado automaticamente
  configure_ai_provider: {
    label: 'Configurar provider de IA',
    description: 'Configure OpenAI, DeepSeek, Anthropic ou Kimi para o motor de IA',
    required: true,
    category: 'required',
    autoDetect: true,
  },
  create_admin_user: {
    label: 'Criar usuário administrador',
    description: 'Crie o primeiro usuário administrador do tenant',
    required: true,
    category: 'required',
    autoDetect: true,
  },

  // 🟡 RECOMENDADO
  connect_channel: {
    label: 'Conectar um canal de atendimento',
    description: 'Conecte pelo menos um canal (ex.: WhatsApp) para receber mensagens dos seus clientes. Voz é opcional.',
    required: false,
    category: 'recommended',
    autoDetect: true,
  },
  configure_billing: {
    label: 'Configurar billing',
    description: 'Configure o provider de cobrança (Asaas ou Mercado Pago)',
    required: false,
    category: 'recommended',
  },
  configure_notifications: {
    label: 'Configurar notificações',
    description: 'Configure email e WhatsApp para notificações do sistema',
    required: false,
    category: 'recommended',
  },
  create_first_agent: {
    label: 'Criar primeiro agente IA',
    description: 'Configure seu primeiro agente de IA',
    required: false,
    category: 'recommended',
  },

  // ⚪ OPCIONAL
  create_first_flow: {
    label: 'Criar primeiro fluxo',
    description: 'Crie seu primeiro fluxo de conversação',
    required: false,
    category: 'optional',
  },
  create_first_queue: {
    label: 'Criar primeira fila',
    description: 'Configure sua primeira fila de atendimento',
    required: false,
    category: 'optional',
  },
  configure_branding: {
    label: 'Configurar branding',
    description: 'Personalize o visual da plataforma',
    required: false,
    category: 'optional',
  },
  index_documents: {
    label: 'Indexar documentos',
    description: 'Adicione documentos à base de conhecimento',
    required: false,
    category: 'optional',
  },
};

/**
 * Auto-detecção: verifica se já existe um admin no tenant.
 */
function hasAdminUser(tenant) {
  try {
    const agents = tenant?.settings?.agents || tenant?.agents || [];
    if (Array.isArray(agents) && agents.length > 0) {
      return agents.some(a => {
        const role = String(a?.role || '').trim().toLowerCase();
        return role === 'admin' || role === 'owner' || role === 'super_admin';
      });
    }
    return Boolean(tenant?.ownerId || tenant?.createdBy);
  } catch (_) {
    return false;
  }
}

/**
 * Auto-detecção: verifica se o tenant tem provider de IA configurado.
 */
function hasAiProvider(tenant) {
  try {
    const aiConfig = tenant?.settings?.ai || tenant?.aiConfig || {};
    const primary = aiConfig?.primary || aiConfig?.provider || null;
    return Boolean(primary);
  } catch (_) {
    return false;
  }
}

/**
 * Auto-detecção: verifica se o tenant tem pelo menos um canal conectado
 * (channel_accounts com status diferente de 'disabled').
 * Best-effort: falha de DB/tabela ausente não derruba o status de onboarding.
 */
async function hasConnectedChannel(tenantId) {
  try {
    const tenantKey = safeTrim(tenantId);
    if (!tenantKey) return false;

    // Requires tardios: mantém o serviço carregável em ambientes sem DB
    // (testes unitários que mockam apenas os serviços de domínio).
    // eslint-disable-next-line global-require
    const { getSequelize } = require('../db/sequelize');
    if (!getSequelize()) return false;

    // eslint-disable-next-line global-require
    const { ChannelAccount } = require('../db/models');
    const Model = typeof ChannelAccount === 'function' ? ChannelAccount() : ChannelAccount;
    // eslint-disable-next-line global-require
    const { Op } = require('sequelize');
    const count = await Model.count({
      where: { tenant_key: tenantKey, status: { [Op.ne]: 'disabled' } },
    });
    return count > 0;
  } catch (err) {
    logger.warn('[Onboarding] Falha ao detectar canais conectados', {
      tenantId: safeTrim(tenantId),
      error: safeErrorMessage(err),
    });
    return false;
  }
}

/**
 * Persiste a vertical canônica do tenant em settings.vertical
 * (fonte lida pela navegação para ativar workspaces verticais).
 *
 * @param {string} tenantId - ID do tenant
 * @param {string|null} vertical - ID canônico (config/verticals.json) ou vazio para limpar
 * @returns {Promise<{success: boolean, vertical?: string|null, error?: string}>}
 */
async function setTenantVertical(tenantId, vertical) {
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    return { success: false, error: 'tenant_not_found' };
  }

  const normalized = safeTrim(vertical).toLowerCase();
  if (normalized && !CANONICAL_VERTICAL_IDS.includes(normalized)) {
    return { success: false, error: 'invalid_vertical' };
  }

  const settings = {
    ...(tenant.settings || {}),
    vertical: normalized || null,
  };

  const result = await updateTenant(tenantId, { settings });
  if (!result.success) {
    return result;
  }

  logger.info('[Onboarding] Vertical do tenant atualizada', {
    tenantId,
    vertical: normalized || null,
  });

  return { success: true, vertical: normalized || null };
}

/**
 * Verifica se o onboarding está bloqueando o acesso.
 * @returns {Promise<{ blocking: boolean, missingSteps: string[] }>}
 */
async function isOnboardingBlocking(tenantId) {
  const status = await getOnboardingStatus(tenantId);
  if (!status) return { blocking: false, missingSteps: [] };
  const missing = status.steps
    .filter(s => s.required && !s.completed)
    .map(s => s.id);
  return { blocking: missing.length > 0, missingSteps: missing };
}

/**
 * Obtém o status de onboarding de um tenant.
 *
 * @param {string} tenantId - ID do tenant
 * @returns {Promise<Object|null>} Status de onboarding
 */
async function getOnboardingStatus(tenantId) {
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    return null;
  }

  const onboarding = tenant.settings?.onboarding || {};
  const completed = onboarding.completed || false;
  let completedSteps = onboarding.completedSteps || [];
  const currentStep = onboarding.currentStep || 'configure_ai_provider';

  // Auto-detecção: marca steps que já estão satisfeitos
  if (hasAdminUser(tenant) && !completedSteps.includes('create_admin_user')) {
    completedSteps = [...completedSteps, 'create_admin_user'];
  }
  if (hasAiProvider(tenant) && !completedSteps.includes('configure_ai_provider')) {
    completedSteps = [...completedSteps, 'configure_ai_provider'];
  }
  if (!completedSteps.includes('connect_channel') && await hasConnectedChannel(tenantId)) {
    completedSteps = [...completedSteps, 'connect_channel'];
  }

  // Calcula progresso
  const totalSteps = Object.keys(ONBOARDING_CHECKLIST).length;
  const completedCount = completedSteps.length;
  const progress = Math.round((completedCount / totalSteps) * 100);

  // Verifica quais steps estão completos
  const steps = Object.keys(ONBOARDING_CHECKLIST).map(stepId => {
    const step = ONBOARDING_CHECKLIST[stepId];
    const isCompleted = completedSteps.includes(stepId);
    
    return {
      id: stepId,
      ...step,
      completed: isCompleted,
    };
  });

  return {
    tenantId,
    completed,
    progress,
    currentStep,
    completedSteps,
    steps,
    startedAt: onboarding.startedAt || tenant.createdAt,
    completedAt: onboarding.completedAt || null,
  };
}

/**
 * Marca um step do onboarding como completo.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {string} stepId - ID do step
 * @returns {{success: boolean, onboarding?: Object, error?: string}}
 */
async function completeOnboardingStep(tenantId, stepId) {
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    return { success: false, error: 'Tenant não encontrado' };
  }

  if (!ONBOARDING_CHECKLIST[stepId]) {
    return { success: false, error: 'Step inválido' };
  }

  const onboarding = tenant.settings?.onboarding || {};
  const completedSteps = onboarding.completedSteps || [];

  // Adiciona step se ainda não estiver completo
  if (!completedSteps.includes(stepId)) {
    completedSteps.push(stepId);
  }

  // Verifica se todos os steps obrigatórios estão completos
  const requiredSteps = Object.keys(ONBOARDING_CHECKLIST).filter(
    id => ONBOARDING_CHECKLIST[id].required
  );
  const allRequiredCompleted = requiredSteps.every(id => completedSteps.includes(id));

  // Atualiza settings
  const settings = {
    ...tenant.settings,
    onboarding: {
      ...onboarding,
      completedSteps,
      completed: allRequiredCompleted,
      currentStep: allRequiredCompleted ? null : getNextStep(completedSteps),
      completedAt: allRequiredCompleted ? new Date().toISOString() : null,
    },
  };

  const result = await updateTenant(tenantId, { settings });
  if (!result.success) {
    return result;
  }

  logger.info('[Onboarding] Step completado', {
    tenantId,
    stepId,
    allRequiredCompleted,
  });

  return {
    success: true,
    onboarding: await getOnboardingStatus(tenantId),
  };
}

/**
 * Obtém o próximo step a ser completado.
 * 
 * @param {string[]} completedSteps - Steps já completos
 * @returns {string|null}
 */
function getNextStep(completedSteps) {
  for (const [stepId, step] of Object.entries(ONBOARDING_CHECKLIST)) {
    if (!completedSteps.includes(stepId) && step.required) {
      return stepId;
    }
  }
  
  // Se todos os obrigatórios estão completos, retorna o primeiro opcional
  for (const [stepId] of Object.entries(ONBOARDING_CHECKLIST)) {
    if (!completedSteps.includes(stepId)) {
      return stepId;
    }
  }
  
  return null;
}

/**
 * Inicia o processo de onboarding.
 * 
 * @param {string} tenantId - ID do tenant
 * @returns {{success: boolean, onboarding?: Object, error?: string}}
 */
async function startOnboarding(tenantId) {
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    return { success: false, error: 'Tenant não encontrado' };
  }

  const onboarding = tenant.settings?.onboarding || {};
  
  if (onboarding.startedAt) {
    // Onboarding já iniciado
    return {
      success: true,
      onboarding: await getOnboardingStatus(tenantId),
    };
  }

  const settings = {
    ...tenant.settings,
    onboarding: {
      ...onboarding,
      startedAt: new Date().toISOString(),
      currentStep: 'create_admin_user',
      completedSteps: [],
      completed: false,
    },
  };

  const result = await updateTenant(tenantId, { settings });
  if (!result.success) {
    return result;
  }

  logger.info('[Onboarding] Onboarding iniciado', { tenantId });

  return {
    success: true,
    onboarding: await getOnboardingStatus(tenantId),
  };
}

/**
 * Cria templates iniciais para um tenant.
 * 
 * @param {string} tenantId - ID do tenant
 * @returns {{success: boolean, created?: Object, error?: string}}
 */
function normalizeSegment(raw) {
  if (!raw) return 'geral';
  const s = safeTrim(raw).toLowerCase();
  if (!s) return 'geral';
  return s;
}

function getOnboardingTemplatePlan(segment) {
  // Seleção "curada" por segmento (best-effort).
  // IDs são os globais do marketplace: mkt-<id>
  const base = [
    'mkt-lead-captacao',
    'mkt-handover-padrao',
    'mkt-faq-rag',
    'mkt-suporte-tecnico-triagem',
  ];

  const bySegment = {
    ecommerce: [...base, 'mkt-status-pedido-servico', 'mkt-atualizacao-cadastral'],
    varejo: [...base, 'mkt-status-pedido-servico', 'mkt-cobranca'],
    servicos: [...base, 'mkt-agendamento', 'mkt-status-pedido-servico'],
    saude: [...base, 'mkt-agendamento', 'mkt-atualizacao-cadastral'],
    educacao: [...base, 'mkt-onboarding-cliente', 'mkt-agendamento'],
    financeiro: [...base, 'mkt-cobranca', 'mkt-atualizacao-cadastral'],
    cobranca: [...base, 'mkt-cobranca'],
    academia: [...base, 'mkt-segment-academia-crossfit', 'mkt-agendamento', 'mkt-onboarding-cliente'],
    padaria: [...base, 'mkt-segment-padaria', 'mkt-status-pedido-servico', 'mkt-onboarding-cliente'],
    bakery: [...base, 'mkt-segment-padaria', 'mkt-status-pedido-servico', 'mkt-onboarding-cliente'],
  };

  // Resolve IDs canônicos de vertical (config/verticals.json, ex.: fitness,
  // clinic) e aliases para a chave de segmento do plano de templates.
  let resolvedSegment = segment;
  if (!bySegment[resolvedSegment]) {
    const verticalId = VERTICAL_ALIAS_TO_ID.get(resolvedSegment);
    if (verticalId && VERTICAL_TO_TEMPLATE_SEGMENT[verticalId]) {
      resolvedSegment = VERTICAL_TO_TEMPLATE_SEGMENT[verticalId];
    }
  }

  return {
    segment: resolvedSegment,
    templateIds: Array.from(new Set(bySegment[resolvedSegment] || [...base, 'mkt-onboarding-cliente'])),
  };
}

function stableTenantTemplateId(tenantId, globalTemplateId) {
  // Ex: onb-<tenantId>-mkt-lead-captacao
  return `onb-${tenantId}-${safeToString(globalTemplateId).replace(/[^a-zA-Z0-9_-]/g, '')}`.slice(0, 180);
}

async function createInitialTemplates(tenantId, options = {}) {
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    return { success: false, error: 'Tenant não encontrado' };
  }

  try {
    const created = {
      queues: [],
      quickReplies: [],
      templates: [],
      flows: [], // mantido por compatibilidade (não criamos flows aqui)
    };

    const segment = normalizeSegment(options.segment || tenant.settings?.segment || tenant.settings?.industry || tenant.settings?.vertical);
    const plan = getOnboardingTemplatePlan(segment);

    // Cria fila padrão
    try {
      const queueResult = createQueue({
        name: 'Geral',
        description: 'Fila padrão de atendimento',
        tenantId,
      });
      if (queueResult.success) {
        created.queues.push(queueResult.queue);
      }
    } catch (err) {
      logger.warn('[Onboarding] Erro ao criar fila padrão', { tenantId, error: safeErrorMessage(err) });
    }

    // Cria respostas rápidas padrão
    try {
      const { createQuickReply } = require('./quickRepliesService');
      const quickReplies = [
        { text: 'Olá! Como posso ajudar?', category: 'saudacao' },
        { text: 'Obrigado pelo contato!', category: 'agradecimento' },
        { text: 'Vou verificar isso para você.', category: 'processamento' },
        { text: 'Só um instante enquanto eu valido as informações.', category: 'processamento' },
        { text: 'Você pode me informar seu nome e CPF/CNPJ?', category: 'cadastro' },
        { text: 'Entendi. Vou encaminhar para um atendente humano.', category: 'handover' },
      ];

      for (const qr of quickReplies) {
        try {
          const qrResult = createQuickReply({
            ...qr,
            tenantId,
          });
          if (qrResult.success) {
            created.quickReplies.push(qrResult.quickReply);
          }
        } catch (err) {
          // Ignora erros individuais
        }
      }
    } catch (err) {
      logger.warn('[Onboarding] Erro ao criar respostas rápidas', { tenantId, error: safeErrorMessage(err) });
    }

    // Cria templates de fluxo do tenant com base no catálogo global (por segmento)
    try {
      for (const globalId of plan.templateIds) {
        try {
          const globalTpl = flowTemplateMarketplaceService.getTemplate({ tenantId, id: globalId });
          if (!globalTpl?.flow) continue;
          const tplId = stableTenantTemplateId(tenantId, globalId);

          // eslint-disable-next-line no-await-in-loop
          const tplResult = await flowTemplateMarketplaceService.createTemplate({
            tenantId,
            id: tplId,
            name: globalTpl.name,
            description: globalTpl.description || '',
            icon: globalTpl.icon || '📋',
            tags: Array.from(new Set([...(globalTpl.tags || []), 'onboarding', `segment:${plan.segment}`])),
            flow: globalTpl.flow,
            createdBy: 'system',
          });
          if (tplResult.success) created.templates.push(tplResult.template);
        } catch (err) {
          // best-effort
        }
      }
    } catch (err) {
      logger.warn('[Onboarding] Erro ao criar templates de fluxo do tenant', { tenantId, segment, error: safeErrorMessage(err) });
    }

    // Marca templatesCreated no tenant (best-effort)
    try {
      const onboarding = tenant.settings?.onboarding || {};
      const settings = {
        ...tenant.settings,
        onboarding: {
          ...onboarding,
          templatesCreated: true,
          templatesCreatedAt: onboarding.templatesCreatedAt || new Date().toISOString(),
          templatesSegment: plan.segment,
        },
      };
      updateTenant(tenantId, { settings });
    } catch (err) {
      // best-effort
    }

    logger.info('[Onboarding] Templates iniciais criados', {
      tenantId,
      queues: created.queues.length,
      quickReplies: created.quickReplies.length,
      templates: created.templates.length,
      segment: plan.segment,
    });

    return {
      success: true,
      created,
    };
  } catch (err) {
    logger.error('[Onboarding] Erro ao criar templates iniciais', {
      tenantId,
      error: safeErrorMessage(err),
    });
    return {
      success: false,
      error: safeErrorMessage(err),
    };
  }
}

/**
 * Finaliza o onboarding.
 * 
 * @param {string} tenantId - ID do tenant
 * @returns {{success: boolean, onboarding?: Object, error?: string}}
 */
async function completeOnboarding(tenantId) {
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    return { success: false, error: 'Tenant não encontrado' };
  }

  const onboarding = tenant.settings?.onboarding || {};
  
  if (onboarding.completed) {
    return {
      success: true,
      onboarding: await getOnboardingStatus(tenantId),
    };
  }

  // Cria templates iniciais se ainda não foram criados
  if (!onboarding.templatesCreated) {
    try {
      await createInitialTemplates(tenantId);
    } catch {
      // best-effort
    }
  }

  const settings = {
    ...tenant.settings,
    onboarding: {
      ...onboarding,
      completed: true,
      completedAt: new Date().toISOString(),
      currentStep: null,
      templatesCreated: true,
    },
  };

  const result = await updateTenant(tenantId, { settings });
  if (!result.success) {
    return result;
  }

  logger.info('[Onboarding] Onboarding finalizado', { tenantId });

  return {
    success: true,
    onboarding: await getOnboardingStatus(tenantId),
  };
}

module.exports = {
  getOnboardingStatus,
  isOnboardingBlocking,
  completeOnboardingStep,
  startOnboarding,
  createInitialTemplates,
  completeOnboarding,
  setTenantVertical,
  hasConnectedChannel,
  ONBOARDING_CHECKLIST,
  CANONICAL_VERTICAL_IDS,
};
