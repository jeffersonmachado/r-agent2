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

function safeNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function resolveNodeType(compiledFlow, nodeId) {
  try {
    const nodes = compiledFlow && Array.isArray(compiledFlow.nodes) ? compiledFlow.nodes : [];
    const found = nodeId ? nodes.find((n) => n && String(n.id) === String(nodeId)) : null;
    return found && found.type != null ? String(found.type) : null;
  } catch (_) {
    return null;
  }
}

function resolveExecutionId(state, deps) {
  const fromState = state && state.metadata && state.metadata.executionId ? String(state.metadata.executionId) : null;
  const fromDeps = deps && deps.executionLedger && deps.executionLedger.executionId ? String(deps.executionLedger.executionId) : null;
  return fromState || fromDeps || null;
}

function resolveExecutionStepIndex(state) {
  const cur = state && state.metadata ? state.metadata.executionStepIndex : undefined;
  const n = safeNumber(cur, null);
  return n != null && n >= 0 ? Math.floor(n) : 0;
}

function jsonReplacer(_key, value) {
  if (typeof value === 'function') return '[Function]';
  if (typeof value === 'bigint') return String(value);
  // eslint-disable-next-line no-undef
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(value)) {
    return `[Buffer ${value.length}]`;
  }
  if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
    return `[BufferLike ${value.data.length}]`;
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function toJsonSafe(obj, fallback) {
  try {
    if (obj == null) return fallback;
    if (typeof obj !== 'object') return fallback;
    return JSON.parse(JSON.stringify(obj, jsonReplacer));
  } catch (_) {
    return fallback;
  }
}

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

  // Execution ledger (opcional, via deps):
  // - Mantém a engine desacoplada: o backend injeta um adapter em deps.executionLedger.
  // - Requer um executionId (por ex. em state.metadata.executionId) para anexar node_executions.
  const executionId = resolveExecutionId(state, deps);
  const stepIndex = resolveExecutionStepIndex(state);
  const nodeId = state && state.currentNodeId ? String(state.currentNodeId) : null;
  const nodeType = nodeId ? resolveNodeType(compiledFlow, nodeId) : null;
  const stepStartedAt = new Date();

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

  // Safe-mode: bloqueia execução de fluxos marcados como "requiresReview"
  // (ex.: gerados por IA) a menos que o chamador habilite explicitamente.
  const requiresReview = compiledFlow && compiledFlow.metadata && compiledFlow.metadata.requiresReview === true;
  const allowUnreviewed = deps && deps.allowUnreviewedAiFlow === true;
  if (requiresReview && !allowUnreviewed) {
    const err = new Error('Fluxo está em safe-mode e requer revisão humana (requiresReview=true)');
    // @ts-ignore
    err.code = 'FLOW_REQUIRES_REVIEW';
    // @ts-ignore
    err.type = 'flow';
    throw err;
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

  let stepOutput;
  try {
    // Importante: não modificamos "compiledFlow".
    // A função runStep apenas lê o fluxo para encontrar nós e transições.
    stepOutput = await runStep(
      /** @type {FlowDefinition} */ (compiledFlow),
      state,
      registry,
      input,
      deps, // Passa dependências para o runner
    );
  } catch (err) {
    // Best-effort: registra falha no ledger antes de re-lançar
    try {
      if (executionId && deps && deps.executionLedger && typeof deps.executionLedger.appendNodeExecution === 'function') {
        const sanitizedInput = typeof deps.executionLedger.sanitizeInput === 'function'
          ? deps.executionLedger.sanitizeInput(input)
          : toJsonSafe(input, {});
        await deps.executionLedger.appendNodeExecution({
          executionId,
          nodeId,
          nodeType,
          stepIndex,
          status: 'error',
          startedAt: stepStartedAt,
          finishedAt: new Date(),
          input: sanitizedInput,
          output: {},
          stateBefore: state,
          stateAfter: state,
          events: [],
          errorMessage: err && err.message ? String(err.message) : String(err),
        });
      }
    } catch (_) {}

    throw err;
  }

  // Incrementa contador de passos no estado (para step_index do ledger).
  // - Mantém compatibilidade: só adiciona metadata.executionStepIndex se metadata existir.
  try {
    if (stepOutput && stepOutput.nextState) {
      const next = stepOutput.nextState;
      next.metadata = next.metadata || {};
      next.metadata.executionStepIndex = stepIndex + 1;
    }
  } catch (_) {}

  // Métricas por nó / passo:
  // - Não afetam a execução (erros são ignorados).
  // - Coleta assíncrona (fire & forget).
  // - Inclui tenantId, flowId, flowVersion e eventos de IA.
  if (compiledFlow && typeof compiledFlow === 'object' && typeof compiledFlow.version === 'number') {
    recordMetricsForStep(state, /** @type {any} */ (compiledFlow), stepOutput);
  }

  // Best-effort: registra sucesso no ledger.
  try {
    if (executionId && deps && deps.executionLedger && typeof deps.executionLedger.appendNodeExecution === 'function') {
      const sanitizedInput = typeof deps.executionLedger.sanitizeInput === 'function'
        ? deps.executionLedger.sanitizeInput(input)
        : toJsonSafe(input, {});
      const sanitizedOutput = typeof deps.executionLedger.sanitizeOutput === 'function'
        ? deps.executionLedger.sanitizeOutput(stepOutput.output || {})
        : toJsonSafe(stepOutput.output || {}, {});
      await deps.executionLedger.appendNodeExecution({
        executionId,
        nodeId,
        nodeType,
        stepIndex,
        status: 'ok',
        startedAt: stepStartedAt,
        finishedAt: new Date(),
        input: sanitizedInput,
        output: sanitizedOutput,
        stateBefore: state,
        stateAfter: stepOutput.nextState,
        events: Array.isArray(stepOutput.events) ? stepOutput.events : [],
        errorMessage: null,
      });
    }
  } catch (_) {}

  return {
    state: stepOutput.nextState,
    events: stepOutput.events,
    output: stepOutput.output || null,
  };
}

module.exports = {
  executeStep,
};


