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
 * Checklist de onboarding.
 */
const ONBOARDING_CHECKLIST = {
  create_admin_user: {
    label: 'Criar usuário administrador',
    description: 'Crie o primeiro usuário administrador do tenant',
    required: true,
  },
  create_first_agent: {
    label: 'Criar primeiro agente IA',
    description: 'Configure seu primeiro agente de IA',
    required: false,
  },
  create_first_flow: {
    label: 'Criar primeiro fluxo',
    description: 'Crie seu primeiro fluxo de conversação',
    required: false,
  },
  create_first_queue: {
    label: 'Criar primeira fila',
    description: 'Configure sua primeira fila de atendimento',
    required: false,
  },
  configure_branding: {
    label: 'Configurar branding',
    description: 'Personalize o visual da plataforma',
    required: false,
  },
  index_documents: {
    label: 'Indexar documentos',
    description: 'Adicione documentos à base de conhecimento',
    required: false,
  },
};

/**
 * Obtém o status de onboarding de um tenant.
 * 
 * @param {string} tenantId - ID do tenant
 * @returns {Object} Status de onboarding
 */
function getOnboardingStatus(tenantId) {
  const tenant = getTenant(tenantId);
  if (!tenant) {
    return null;
  }

  const onboarding = tenant.settings?.onboarding || {};
  const completed = onboarding.completed || false;
  const completedSteps = onboarding.completedSteps || [];
  const currentStep = onboarding.currentStep || 'create_admin_user';

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
  const tenant = getTenant(tenantId);
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
    onboarding: getOnboardingStatus(tenantId),
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
  const tenant = getTenant(tenantId);
  if (!tenant) {
    return { success: false, error: 'Tenant não encontrado' };
  }

  const onboarding = tenant.settings?.onboarding || {};
  
  if (onboarding.startedAt) {
    // Onboarding já iniciado
    return {
      success: true,
      onboarding: getOnboardingStatus(tenantId),
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
    onboarding: getOnboardingStatus(tenantId),
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
  };

  return {
    segment,
    templateIds: Array.from(new Set(bySegment[segment] || [...base, 'mkt-onboarding-cliente'])),
  };
}

function stableTenantTemplateId(tenantId, globalTemplateId) {
  // Ex: onb-<tenantId>-mkt-lead-captacao
  return `onb-${tenantId}-${safeToString(globalTemplateId).replace(/[^a-zA-Z0-9_-]/g, '')}`.slice(0, 180);
}

async function createInitialTemplates(tenantId, options = {}) {
  const tenant = getTenant(tenantId);
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
  const tenant = getTenant(tenantId);
  if (!tenant) {
    return { success: false, error: 'Tenant não encontrado' };
  }

  const onboarding = tenant.settings?.onboarding || {};
  
  if (onboarding.completed) {
    return {
      success: true,
      onboarding: getOnboardingStatus(tenantId),
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

  const result = updateTenant(tenantId, { settings });
  if (!result.success) {
    return result;
  }

  logger.info('[Onboarding] Onboarding finalizado', { tenantId });

  return {
    success: true,
    onboarding: getOnboardingStatus(tenantId),
  };
}

module.exports = {
  getOnboardingStatus,
  completeOnboardingStep,
  startOnboarding,
  createInitialTemplates,
  completeOnboarding,
  ONBOARDING_CHECKLIST,
};
