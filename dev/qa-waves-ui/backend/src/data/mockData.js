export const baseWaves = [
  {
    id: 'wave-onboarding',
    name: 'Onboarding Operacional',
    description: 'Fluxos criticos de entrada de cliente e validacao de dados.',
    status: 'active',
    coverage: 92
  },
  {
    id: 'wave-billing',
    name: 'Cobranca e Negociacao',
    description: 'Cenarios de segunda via, negociacao e regularizacao.',
    status: 'warning',
    coverage: 78
  },
  {
    id: 'wave-support',
    name: 'Suporte Omnichannel',
    description: 'Atendimento em WhatsApp, Webchat e Voz para chamados comuns.',
    status: 'active',
    coverage: 85
  }
];

export const baseWaveItems = [
  { id: 'item-cpf', waveId: 'wave-onboarding', name: 'Validacao de CPF', type: 'qa', channel: 'webchat', critical: true, lastStatus: 'success', lastRunAt: '2026-04-21T17:11:00.000Z' },
  { id: 'item-biometric', waveId: 'wave-onboarding', name: 'Biometria simplificada', type: 'rpa', channel: 'voice', critical: true, lastStatus: 'failure', lastRunAt: '2026-04-21T17:22:00.000Z' },
  { id: 'item-contract', waveId: 'wave-onboarding', name: 'Aceite contratual', type: 'qa', channel: 'whatsapp', critical: false, lastStatus: 'success', lastRunAt: '2026-04-21T17:35:00.000Z' },

  { id: 'item-debt', waveId: 'wave-billing', name: 'Consulta de debito', type: 'qa', channel: 'webchat', critical: true, lastStatus: 'success', lastRunAt: '2026-04-21T15:20:00.000Z' },
  { id: 'item-ticket', waveId: 'wave-billing', name: 'Geracao de boleto', type: 'rpa', channel: 'voice', critical: false, lastStatus: 'success', lastRunAt: '2026-04-21T15:42:00.000Z' },
  { id: 'item-reneg', waveId: 'wave-billing', name: 'Renegociacao assistida', type: 'replay', channel: 'whatsapp', critical: true, lastStatus: 'failure', lastRunAt: '2026-04-21T15:58:00.000Z' },

  { id: 'item-open-ticket', waveId: 'wave-support', name: 'Abertura de chamado', type: 'qa', channel: 'webchat', critical: false, lastStatus: 'success', lastRunAt: '2026-04-21T18:05:00.000Z' },
  { id: 'item-priority-escalation', waveId: 'wave-support', name: 'Escalonamento prioritario', type: 'rpa', channel: 'voice', critical: true, lastStatus: 'success', lastRunAt: '2026-04-21T18:26:00.000Z' },
  { id: 'item-followup', waveId: 'wave-support', name: 'Follow-up automatico', type: 'replay', channel: 'whatsapp', critical: false, lastStatus: 'success', lastRunAt: '2026-04-21T18:42:00.000Z' }
];

export const baseReplays = [
  {
    id: 'replay-1001',
    waveId: 'wave-onboarding',
    waveName: 'Onboarding Operacional',
    itemId: 'item-cpf',
    itemName: 'Validacao de CPF',
    name: 'Replay CPF cenario padrao',
    seed: 'seed-qa-001',
    channel: 'webchat',
    status: 'success',
    startedAt: '2026-04-20T08:10:00.000Z',
    finishedAt: '2026-04-20T08:12:50.000Z',
    durationMs: 170000,
    critical: true
  },
  {
    id: 'replay-1002',
    waveId: 'wave-billing',
    waveName: 'Cobranca e Negociacao',
    itemId: 'item-reneg',
    itemName: 'Renegociacao assistida',
    name: 'Replay renegociacao limite',
    seed: 'seed-rpa-044',
    channel: 'whatsapp',
    status: 'failure',
    startedAt: '2026-04-20T19:00:00.000Z',
    finishedAt: '2026-04-20T19:06:10.000Z',
    durationMs: 370000,
    critical: true
  },
  {
    id: 'replay-1003',
    waveId: 'wave-support',
    waveName: 'Suporte Omnichannel',
    itemId: 'item-open-ticket',
    itemName: 'Abertura de chamado',
    name: 'Replay chamado rapido',
    seed: 'seed-replay-918',
    channel: 'webchat',
    status: 'success',
    startedAt: '2026-04-21T16:10:00.000Z',
    finishedAt: '2026-04-21T16:11:40.000Z',
    durationMs: 100000,
    critical: false
  }
];
