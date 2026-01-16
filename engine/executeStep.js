/**
 * Função de alto nível para executar UM passo do fluxo compilado.
 *
 * Objetivo:
 * - Encapsular a chamada ao runner da engine garantindo:
 *   - Execução de exatamente UM nó por chamada.
 *   - Nenhum loop interno (sem while/for de múltiplos passos).
 *   - Nenhuma mutação do fluxo compilado (CompiledFlow é tratado como read-only).
 *   - Nenhum uso implícito de IA: qualquer integração de IA deve ser feita
 *     explicitamente pelos handlers de nós e/ou pelo backend.
 */

const { runStep } = require('./runner');
const { recordMetricsForStep } = require('./metrics');
const { ReplaySystem } = require('../lib/replaySystem');
const path = require('path');

/**
 * @typedef {import('./flowTypes').ConversationState} ConversationState
 * @typedef {import('./flowTypes').EngineEvent} EngineEvent
 * @typedef {import('./flowTypes').FlowDefinition} FlowDefinition
 * @typedef {import('./nodeRegistry').NodeRegistry} NodeRegistry
 *
 * @typedef {import('./compileFlow').CompiledFlow} CompiledFlow
 */

/**
 * Resultado de uma chamada de executeStep.
 *
 * Decisão de contrato:
 * - Retornamos:
 *   - novo estado da sessão
 *   - lista de eventos gerados neste passo
 *   - saída de alto nível (por ex.: próxima mensagem)
 * - Não existe "loop" interno: apenas um nó é processado.
 *
 * @typedef {Object} ExecuteStepResult
 * @property {ConversationState} state      - Novo estado da conversa após o passo
 * @property {EngineEvent[]} events         - Eventos estruturados gerados no passo
 * @property {Object<string, any>|null} output - Saída de alto nível (mensagem, handoff, etc.) ou null
 */

/**
 * Opções adicionais para execução de um passo.
 *
 * @typedef {Object} ExecuteStepOptions
 * @property {NodeRegistry} registry        - Registro de handlers de nós (obrigatório)
 * @property {Object<string, any>} [input]  - Input opcional para o nó atual (ex.: mensagem do usuário)
 * @property {import('./flowTypes').NodeDependencies} [deps] - Dependências opcionais (serviços de persistência, etc.)
 */

/**
 * Executa exatamente UM nó do fluxo compilado.
 *
 * Regras importantes:
 * - Não altera o fluxo compilado: assume-se que `compiledFlow` já foi
 *   produzido por `compileFlow` e está profundamente imutável.
 * - Stateless em relação ao fluxo: qualquer estado é carregado e devolvido
 *   via `ConversationState`, nunca mantido em variáveis globais.
 * - Nenhum uso implícito de IA: esta função delega a lógica para os
 *   handlers de nós registrados em `registry`; qualquer chamada de IA
 *   deve ser explícita nesses handlers ou em serviços externos.
 *
 * @param {ConversationState} state
 * @param {CompiledFlow|FlowDefinition} compiledFlow - Fluxo compilado ou definição "crua" (para compatibilidade)
 * @param {ExecuteStepOptions} options
 * @returns {Promise<ExecuteStepResult>}
 */
async function executeStep(state, compiledFlow, options) {
  if (!options || !options.registry) {
    throw new Error('executeStep: opção "registry" é obrigatória');
  }

  const registry = options.registry;
  const input = options.input;
  const deps = options.deps;

  // Regras de multi-tenant:
  // - Todo fluxo pertence a um tenant (compiledFlow.tenantId).
  // - Toda sessão possui um tenantId em seu estado.
  // - Antes de executar, validamos que ambos coincidem.
  const flowTenantId = compiledFlow && compiledFlow.tenantId;
  if (flowTenantId && state.tenantId && flowTenantId !== state.tenantId) {
    throw new Error(
      `executeStep: tentativa de executar fluxo de tenant "${flowTenantId}" em sessão do tenant "${state.tenantId}"`,
    );
  }

  // Regras de versionamento:
  // - Sessões usam sempre uma versão fixa.
  // - Se o estado tiver flowVersion, ele deve coincidir com a
  //   versão do fluxo em execução, evitando trocar de versão
  //   durante a mesma conversa.
  const flowVersion = compiledFlow && compiledFlow.version;
  if (typeof state.flowVersion === 'number' && typeof flowVersion === 'number' && state.flowVersion !== flowVersion) {
    throw new Error(
      `executeStep: tentativa de executar versão ${flowVersion} do fluxo em sessão criada para a versão ${state.flowVersion}`,
    );
  }

  // Importante: não modificamos "compiledFlow".
  // A função runStep apenas lê o fluxo para encontrar nós e transições.
  const stepOutput = await runStep(
    /** @type {FlowDefinition} */ (compiledFlow),
    state,
    registry,
    input,
    deps, // Passa dependências para o runner
  );

  // Métricas por nó / passo:
  // - Não afetam a execução (erros são ignorados).
  // - Coleta assíncrona (fire & forget).
  // - Inclui tenantId, flowId, flowVersion e eventos de IA.
  if (compiledFlow && typeof compiledFlow === 'object' && typeof compiledFlow.version === 'number') {
    recordMetricsForStep(state, /** @type {any} */ (compiledFlow), stepOutput);
  }

  return {
    state: stepOutput.nextState,
    events: stepOutput.events,
    output: stepOutput.output || null,
  };
}

module.exports = {
  executeStep,
};


