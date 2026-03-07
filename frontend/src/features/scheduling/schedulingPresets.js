export const SCHEDULING_PRESET_IDS = {
  CONTATO_AUTOMATICO: 'contato_automatico',
  COM_CONFIRMACAO: 'com_confirmacao',
  HUMANO_AGENDADO: 'humano_agendado',
  INTELIGENTE_IA_DECIDE: 'inteligente_ia_decide',
  PROCESSO_AUTOMATICO: 'processo_automatico',
};

export const DEFAULT_SCHEDULING_PRESET_ID = SCHEDULING_PRESET_IDS.COM_CONFIRMACAO;

export const schedulingPresets = [
  {
    id: SCHEDULING_PRESET_IDS.CONTATO_AUTOMATICO,
    label: 'Contato automático',
    description: 'Contato rápido sem confirmação obrigatória.',
    visibleFields: ['date', 'time', 'channel', 'purpose', 'notes', 'reminders'],
    requiredFields: ['date', 'time', 'channel'],
    defaults: {
      requiresConfirmation: false,
      mode: 'free',
      origin: 'system',
      reminder24h: false,
      reminder1h: true,
      noShow10m: false,
    },
    metadataDefaults: {},
  },
  {
    id: SCHEDULING_PRESET_IDS.COM_CONFIRMACAO,
    label: 'Com confirmação',
    description: 'Fluxo padrão com confirmação e lembretes completos.',
    visibleFields: ['date', 'time', 'durationMinutes', 'channel', 'mode', 'ownerId', 'teamId', 'confirmationTimeout', 'purpose', 'notes', 'reminders', 'requiresConfirmation'],
    requiredFields: ['date', 'time', 'durationMinutes', 'channel'],
    defaults: {
      requiresConfirmation: true,
      mode: 'free',
      origin: 'human',
      reminder24h: true,
      reminder1h: true,
      noShow10m: true,
    },
    metadataDefaults: {
      confirmationTimeoutMinutes: 120,
    },
  },
  {
    id: SCHEDULING_PRESET_IDS.HUMANO_AGENDADO,
    label: 'Humano agendado',
    description: 'Agendamento assistido por operador com agenda de equipe.',
    visibleFields: ['date', 'time', 'durationMinutes', 'channel', 'mode', 'ownerId', 'teamId', 'purpose', 'notes', 'reminders', 'requiresConfirmation', 'origin'],
    requiredFields: ['date', 'time', 'durationMinutes', 'channel', 'teamOrOwner'],
    defaults: {
      requiresConfirmation: true,
      mode: 'team_based',
      origin: 'human',
      reminder24h: true,
      reminder1h: true,
      noShow10m: true,
    },
    metadataDefaults: {},
  },
  {
    id: SCHEDULING_PRESET_IDS.INTELIGENTE_IA_DECIDE,
    label: 'Inteligente (IA decide)',
    description: 'Coleta janela e prioridade para decisão posterior.',
    visibleFields: [
      'timeWindowStart',
      'timeWindowEnd',
      'channel',
      'priority',
      'allowAutoReschedule',
      'requiresConfirmation',
      'purpose',
      'notes',
      'durationMinutes',
      'origin',
      'reminders',
    ],
    requiredFields: ['timeWindowStart', 'timeWindowEnd', 'channel'],
    defaults: {
      requiresConfirmation: false,
      mode: 'free',
      origin: 'bot',
      reminder24h: false,
      reminder1h: true,
      noShow10m: false,
    },
    metadataDefaults: {
      priority: 'normal',
      allowAutoReschedule: true,
    },
  },
  {
    id: SCHEDULING_PRESET_IDS.PROCESSO_AUTOMATICO,
    label: 'Processo automático',
    description: 'Disparo imediato ou agendado sem confirmação.',
    visibleFields: ['when', 'date', 'time', 'durationMinutes', 'channel', 'purpose', 'notes', 'reminders', 'origin'],
    requiredFields: ['channel', 'purposeOrNotes'],
    defaults: {
      requiresConfirmation: false,
      mode: 'free',
      origin: 'system',
      reminder24h: false,
      reminder1h: true,
      noShow10m: false,
      whenImmediate: true,
    },
    metadataDefaults: {},
  },
];

export function getSchedulingPresetById(id) {
  return schedulingPresets.find((preset) => preset.id === id) || null;
}
