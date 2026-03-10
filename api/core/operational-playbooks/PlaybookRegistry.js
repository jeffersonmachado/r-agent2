'use strict';

function safeString(value) {
  const normalized = value == null ? '' : String(value).trim();
  return normalized || null;
}

function normalizeSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps
    .map((step, index) => {
      if (!step || typeof step !== 'object') return null;
      const id = safeString(step.id) || `step-${index + 1}`;
      const type = safeString(step.type);
      if (!type) return null;
      return {
        id,
        type,
        title: safeString(step.title) || type,
        description: safeString(step.description) || null,
        requiresConfirmation: step.requiresConfirmation !== false,
        ...step,
        id,
        type,
      };
    })
    .filter(Boolean);
}

function normalizePlaybook(playbook) {
  if (!playbook || typeof playbook !== 'object') return null;
  const id = safeString(playbook.id);
  const triggerSignal = safeString(playbook.triggerSignal || playbook.trigger_signal);
  if (!id || !triggerSignal) return null;

  return {
    id,
    triggerSignal,
    name: safeString(playbook.name) || id,
    description: safeString(playbook.description) || 'Playbook operacional',
    steps: normalizeSteps(playbook.steps),
    metadata: playbook.metadata && typeof playbook.metadata === 'object' ? playbook.metadata : {},
  };
}

const DEFAULT_PLAYBOOKS = [
  {
    id: 'customer_reactivation',
    triggerSignal: 'customer_reactivation',
    name: 'Reativar cliente',
    description: 'Fluxo guiado para recuperar contato inativo e retomar relacionamento.',
    steps: [
      {
        id: 'send_whatsapp',
        type: 'send_whatsapp_template',
        title: 'Enviar template de reativação',
        description: 'Envia uma mensagem inicial para retomar a conversa.',
        template: 'cliente_sem_retorno',
        languageCode: 'pt_BR',
      },
      {
        id: 'suggest_slots',
        type: 'suggest_schedule_slots',
        title: 'Sugerir horários',
        description: 'Busca horários disponíveis para reagendamento.',
        limit: 3,
        durationMinutes: 30,
      },
      {
        id: 'create_followup',
        type: 'create_followup',
        title: 'Criar follow-up',
        description: 'Agenda retorno caso não haja resposta.',
        delayHours: 24,
      },
    ],
  },
  {
    id: 'followup_recovery',
    triggerSignal: 'followup_overdue',
    name: 'Regularizar follow-up atrasado',
    description: 'Recupera follow-ups pendentes com tarefa e callback.',
    steps: [
      {
        id: 'notify_operator',
        type: 'notify_operator',
        title: 'Notificar operador',
        description: 'Notifica o operador responsável sobre atraso.',
      },
      {
        id: 'create_task',
        type: 'create_task',
        title: 'Criar tarefa operacional',
        description: 'Cria tarefa para tratamento do atraso.',
        titleTemplate: 'Regularizar follow-up do contato',
        priority: 'high',
      },
      {
        id: 'create_followup',
        type: 'create_followup',
        title: 'Reagendar callback',
        description: 'Agenda callback no curto prazo.',
        delayHours: 4,
      },
    ],
  },
  {
    id: 'upsell_conversion',
    triggerSignal: 'upsell_opportunity',
    name: 'Converter oportunidade de upsell',
    description: 'Abre oportunidade comercial e conduz próximo contato.',
    steps: [
      {
        id: 'create_opportunity',
        type: 'create_opportunity',
        title: 'Criar oportunidade CRM',
        description: 'Registra oportunidade no pipeline.',
      },
      {
        id: 'send_whatsapp_message',
        type: 'send_whatsapp_message',
        title: 'Enviar mensagem de proposta',
        description: 'Envia mensagem comercial personalizada.',
        message: 'Temos uma condição especial para você. Posso te enviar os detalhes agora?',
      },
      {
        id: 'create_task',
        type: 'create_task',
        title: 'Criar tarefa de negociação',
        description: 'Acompanha evolução da oportunidade.',
        titleTemplate: 'Acompanhar oportunidade de upsell',
      },
    ],
  },
  {
    id: 'ticket_escalation_response',
    triggerSignal: 'ticket_escalation',
    name: 'Escalada de ticket crítico',
    description: 'Fluxo guiado para reduzir risco em ticket escalado.',
    steps: [
      {
        id: 'notify_team',
        type: 'notify_team',
        title: 'Notificar equipe responsável',
        description: 'Alerta o time para intervenção imediata.',
        priority: 'high',
      },
      {
        id: 'create_task',
        type: 'create_task',
        title: 'Criar tarefa de escalada',
        description: 'Registra ação operacional de escalada.',
        priority: 'high',
      },
      {
        id: 'notify_operator',
        type: 'notify_operator',
        title: 'Confirmar owner operacional',
        description: 'Confirma responsável pela execução.',
      },
    ],
  },
  {
    id: 'schedule_conflict_resolution',
    triggerSignal: 'schedule_conflict',
    name: 'Resolver conflito de agenda',
    description: 'Orquestra reagendamento e comunicação com cliente.',
    steps: [
      {
        id: 'suggest_schedule_slots',
        type: 'suggest_schedule_slots',
        title: 'Sugerir novos horários',
        description: 'Busca slots alternativos válidos.',
        limit: 3,
        durationMinutes: 30,
      },
      {
        id: 'notify_customer',
        type: 'send_whatsapp_message',
        title: 'Notificar cliente sobre ajuste',
        description: 'Comunica necessidade de replanejamento.',
        message: 'Identificamos um ajuste de agenda e vamos confirmar o melhor horário com você.',
      },
    ],
  },
  {
    id: 'knowledge_gap_assist',
    triggerSignal: 'knowledge_gap',
    name: 'Cobertura de lacuna de conhecimento',
    description: 'Ativa assistência quando há lacuna de base RAG.',
    steps: [
      {
        id: 'notify_operator',
        type: 'notify_operator',
        title: 'Notificar operador',
        description: 'Solicita revisão contextual para apoio manual.',
      },
      {
        id: 'create_task',
        type: 'create_task',
        title: 'Criar tarefa de documentação',
        description: 'Registra ação para enriquecimento da base.',
        priority: 'medium',
      },
    ],
  },
];

class PlaybookRegistry {
  constructor({ playbooks = DEFAULT_PLAYBOOKS } = {}) {
    this.playbooksById = new Map();
    this.playbookBySignal = new Map();
    for (const playbook of playbooks) {
      this.register(playbook);
    }
  }

  register(playbook) {
    const normalized = normalizePlaybook(playbook);
    if (!normalized) {
      return { ok: false, error: 'invalid_playbook' };
    }

    this.playbooksById.set(normalized.id, normalized);
    this.playbookBySignal.set(normalized.triggerSignal, normalized.id);
    return { ok: true, playbook: normalized };
  }

  getPlaybook(id) {
    const key = safeString(id);
    if (!key) return null;
    return this.playbooksById.get(key) || null;
  }

  getPlaybookForSignal(signalType) {
    const signalKey = safeString(signalType);
    if (!signalKey) return null;
    const playbookId = this.playbookBySignal.get(signalKey);
    if (!playbookId) return null;
    return this.playbooksById.get(playbookId) || null;
  }

  listPlaybooks() {
    return Array.from(this.playbooksById.values());
  }
}

module.exports = {
  PlaybookRegistry,
  DEFAULT_PLAYBOOKS,
};
