'use strict';

const onboardingService = require('../onboardingService');

function listSolutionPacks() {
  // Curadoria mínima: packs por segmento reutilizam o onboarding.
  // Observação: IDs são templates globais (mkt-...) que são instalados como templates do tenant.
  return [
    { id: 'geral', name: 'Geral', description: 'Templates base para começar rápido.', segment: 'geral' },
    { id: 'ecommerce', name: 'E-commerce', description: 'Captação + status de pedido + suporte.', segment: 'ecommerce' },
    { id: 'varejo', name: 'Varejo', description: 'Captação + cobrança + suporte.', segment: 'varejo' },
    { id: 'servicos', name: 'Serviços', description: 'Agendamento + triagem + handover.', segment: 'servicos' },
    { id: 'saude', name: 'Saúde', description: 'Agendamento + atualização cadastral + triagem.', segment: 'saude' },
    { id: 'educacao', name: 'Educação', description: 'Onboarding do cliente + agendamento.', segment: 'educacao' },
    { id: 'financeiro', name: 'Financeiro', description: 'Cobrança + atualização cadastral + triagem.', segment: 'financeiro' },
    { id: 'cobranca', name: 'Cobrança', description: 'Negociação + handover + suporte.', segment: 'cobranca' },
    { id: 'academia', name: 'Academia', description: 'Atendimento completo (ex.: CrossFit) + agendamento.', segment: 'academia' },
  ].map((p) => ({
    ...p,
    kpis: [
      { id: 'flow_executions', label: 'Execuções de fluxo', endpoint: '/api/executions/ledger' },
      { id: 'queue_metrics', label: 'Métricas de fila de jobs', endpoint: '/api/ops/execution-queue/metrics' },
      { id: 'leads_funnel', label: 'Funil de leads (Marketing)', endpoint: '/api/marketing/leads/stats' },
    ],
    operationsChecklist: [
      'Instalar templates do segmento',
      'Configurar filas/roteamento e handover',
      'Publicar canais e testar conversa ponta-a-ponta',
      'Checar métricas e ledger de execução',
    ],
  }));
}

async function installSolutionPack({ tenantId, segment }) {
  // Reusa o onboarding para "instalar" os templates curados.
  const result = await onboardingService.createInitialTemplates(tenantId, { segment });
  return result;
}

module.exports = {
  listSolutionPacks,
  installSolutionPack,
};

