'use strict';

/**
 * Learning Core — Simulation Engine (núcleo puro, zero I/O).
 *
 * Monta cenários de simulação = jornada × seedType × persona sintética.
 * NUNCA usa dados reais: personas são explicitamente fictícias (documentos
 * 000..., nomes "Simulado") e os passos vêm de um template (replay
 * anonimizado ou passos declarados).
 *
 * O enriquecimento textual (objetivo, variações de entrada) é feito pela
 * orquestração via IA (AI-first); este núcleo gera sempre o cenário-base
 * determinístico, que é válido por si só.
 */

const SEED_TYPES = Object.freeze([
  'happy_path',
  'edge_case',
  'error',
  'timeout',
  'permission_denied',
  'stress',
  'integration',
  'external_failure',
  'vip_customer',
  'delinquent_customer',
]);

/**
 * Personas sintéticas fixas. Documentos/telefones zerados deixam explícito
 * que não são pessoas reais.
 */
const PERSONAS = Object.freeze({
  cliente_vip: {
    key: 'cliente_vip',
    nome: 'Cliente Simulado VIP',
    documento: '000.000.000-00',
    telefone: '+55 00 00000-0000',
    email: 'vip.simulado@example.invalid',
    tags: ['vip', 'prioridade-alta'],
  },
  cliente_inadimplente: {
    key: 'cliente_inadimplente',
    nome: 'Cliente Simulado Inadimplente',
    documento: '000.000.000-00',
    telefone: '+55 00 00000-0000',
    email: 'inadimplente.simulado@example.invalid',
    tags: ['inadimplente', 'bloqueio-financeiro'],
  },
  cliente_novo: {
    key: 'cliente_novo',
    nome: 'Cliente Simulado Novo',
    documento: '000.000.000-00',
    telefone: '+55 00 00000-0000',
    email: 'novo.simulado@example.invalid',
    tags: ['onboarding'],
  },
  usuario_iniciante: {
    key: 'usuario_iniciante',
    nome: 'Operador Simulado Iniciante',
    documento: '000.000.000-00',
    telefone: '+55 00 00000-0000',
    email: 'operador.simulado@example.invalid',
    tags: ['baixa-autonomia'],
  },
});

const SEED_BEHAVIOR = Object.freeze({
  happy_path: { descricao: 'Fluxo nominal, sem falhas.', falhaEsperada: false },
  edge_case: { descricao: 'Entradas no limite (campos vazios, máximos, formatos extremos).', falhaEsperada: false },
  error: { descricao: 'Erro de validação esperado e tratado.', falhaEsperada: true },
  timeout: { descricao: 'Dependência lenta; sistema deve sinalizar e recuperar.', falhaEsperada: true },
  permission_denied: { descricao: 'Ator sem permissão; acesso negado é o resultado correto.', falhaEsperada: true },
  stress: { descricao: 'Volume repetido da mesma operação; consistência sob carga.', falhaEsperada: false },
  integration: { descricao: 'Foco na fronteira com sistema externo.', falhaEsperada: false },
  external_failure: { descricao: 'Falha externa simulada; degradação controlada.', falhaEsperada: true },
  vip_customer: { descricao: 'Atendimento a cliente VIP com prioridade.', falhaEsperada: false },
  delinquent_customer: { descricao: 'Cliente inadimplente; regras de bloqueio/cobrança aplicadas.', falhaEsperada: false },
});

/**
 * Monta o cenário-base determinístico.
 *
 * @param {object} args
 * @param {string} args.journeyKey
 * @param {string} args.seedType  um de SEED_TYPES
 * @param {string} args.personaKey  uma das chaves de PERSONAS
 * @param {Array}  [args.stepsTemplate]  passos-base (ex.: actions anonimizadas
 *   de um replay: { type, selector, value, step })
 * @param {Date}   [args.now]
 * @returns {object} cenário
 */
function buildSimulationScenario({ journeyKey, seedType, personaKey, stepsTemplate, now } = {}) {
  if (!journeyKey || typeof journeyKey !== 'string') {
    throw new Error('journeyKey obrigatorio');
  }
  if (!SEED_TYPES.includes(seedType)) {
    throw new Error(`seedType invalido: ${seedType}. Validos: ${SEED_TYPES.join(', ')}`);
  }
  const persona = PERSONAS[personaKey];
  if (!persona) {
    throw new Error(`personaKey invalida: ${personaKey}. Validas: ${Object.keys(PERSONAS).join(', ')}`);
  }

  const behavior = SEED_BEHAVIOR[seedType];
  const createdAt = (now || new Date()).toISOString();

  const steps = (Array.isArray(stepsTemplate) && stepsTemplate.length > 0
    ? stepsTemplate
    : [{ type: 'navigate', step: 'inicio', value: { route: `/${journeyKey}` } }]
  ).map((step, index) => ({
    index,
    type: step.type || 'acao',
    step: step.step || `passo-${index + 1}`,
    selector: step.selector || null,
    // Dados de entrada sempre da persona sintética quando o passo preenche valor.
    value: step.type === 'fill' && persona
      ? { persona: persona.nome, email: persona.email, documento: persona.documento }
      : (step.value ?? null),
    expectSucesso: !(behavior.falhaEsperada && index === (stepsTemplate || []).length - 1),
  }));

  return {
    journeyKey,
    seedType,
    persona,
    descricao: `Simulacao ${seedType} da jornada ${journeyKey} com persona ${persona.nome}. ${behavior.descricao}`,
    falhaEsperada: behavior.falhaEsperada,
    steps,
    assertions: [
      { tipo: 'sem_dados_reais', descricao: 'Nenhum dado real de cliente em nenhum passo.' },
      behavior.falhaEsperada
        ? { tipo: 'falha_controlada', descricao: 'A falha esperada ocorre e é sinalizada explicitamente.' }
        : { tipo: 'fluxo_completo', descricao: 'Todos os passos concluem com sucesso.' },
    ],
    createdAt,
  };
}

module.exports = {
  buildSimulationScenario,
  SEED_TYPES,
  PERSONAS,
  SEED_BEHAVIOR,
};
