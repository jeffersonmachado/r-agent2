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
const logger = require('../utils/logger');

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
function completeOnboardingStep(tenantId, stepId) {
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

  const result = updateTenant(tenantId, { settings });
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
function startOnboarding(tenantId) {
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

  const result = updateTenant(tenantId, { settings });
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
function createInitialTemplates(tenantId) {
  const tenant = getTenant(tenantId);
  if (!tenant) {
    return { success: false, error: 'Tenant não encontrado' };
  }

  try {
    const created = {
      queues: [],
      quickReplies: [],
      flows: [],
    };

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
      logger.warn('[Onboarding] Erro ao criar fila padrão', { tenantId, error: err.message });
    }

    // Cria respostas rápidas padrão
    try {
      const { createQuickReply } = require('./quickRepliesService');
      const quickReplies = [
        { text: 'Olá! Como posso ajudar?', category: 'saudacao' },
        { text: 'Obrigado pelo contato!', category: 'agradecimento' },
        { text: 'Vou verificar isso para você.', category: 'processamento' },
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
      logger.warn('[Onboarding] Erro ao criar respostas rápidas', { tenantId, error: err.message });
    }

    logger.info('[Onboarding] Templates iniciais criados', {
      tenantId,
      queues: created.queues.length,
      quickReplies: created.quickReplies.length,
    });

    return {
      success: true,
      created,
    };
  } catch (err) {
    logger.error('[Onboarding] Erro ao criar templates iniciais', {
      tenantId,
      error: err.message,
    });
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Finaliza o onboarding.
 * 
 * @param {string} tenantId - ID do tenant
 * @returns {{success: boolean, onboarding?: Object, error?: string}}
 */
function completeOnboarding(tenantId) {
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
    createInitialTemplates(tenantId);
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
