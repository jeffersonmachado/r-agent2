/**
 * Nó "business_entry"
 *
 * Macro: extrai "services" do contexto efêmero (Redis, via executionId) e apresenta opções.
 *
 * Saídas:
 * - selected: quando o usuário escolhe um serviço
 * - skip: quando nenhum serviço é detectado
 *
 * Observação importante:
 * - Este nó é interativo: quando há serviços mas ainda não há seleção,
 *   ele emite `output.type='options'` e o runner deve manter a sessão no mesmo nó
 *   até receber input de seleção.
 */

const { createEngineEvent } = require('../utils');

let businessEntitiesService = null;
try {
  businessEntitiesService = require('../../api/services/business-entities.service');
} catch (err) {
  businessEntitiesService = null;
}

function cloneState(state) {
  return {
    ...state,
    variables: { ...(state.variables || {}) },
    history: Array.isArray(state.history) ? [...state.history] : [],
    metadata: state.metadata ? { ...state.metadata } : undefined,
    context: state.context ? { ...state.context } : undefined,
  };
}

function safeString(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function normalizeText(s) {
  return safeString(s).trim().toLowerCase();
}

function slugify(raw) {
  const s = safeString(raw)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (s || 'service').slice(0, 50);
}

function getExecutionId(state) {
  const meta = state?.metadata || {};
  const vars = state?.variables || {};
  const candidates = [
    meta.executionId,
    meta.pipelineExecutionId,
    meta.runId,
    vars.executionId,
    vars.pipelineExecutionId,
  ];
  for (const c of candidates) {
    const v = safeString(c).trim();
    if (v) return v;
  }
  return null;
}

function isDryRunState(state) {
  const meta = state?.metadata || {};
  return (
    meta?.dryRun === true ||
    meta?.executionMode === 'dry-run' ||
    meta?.mode === 'simulation' ||
    meta?.testMode === true
  );
}

function resolveSelection(input, options) {
  const opts = Array.isArray(options) ? options : [];

  // Formatos suportados: optionId / optionIds / text
  const directId = safeString(input?.optionId || '').trim();
  if (directId) {
    const match = opts.find((o) => safeString(o.id) === directId);
    return match || null;
  }

  if (Array.isArray(input?.optionIds) && input.optionIds.length > 0) {
    const first = safeString(input.optionIds[0]).trim();
    if (first) {
      const match = opts.find((o) => safeString(o.id) === first);
      return match || null;
    }
  }

  const text = safeString(input?.text || '').trim();
  if (text) {
    const t = normalizeText(text);
    // tenta por label, value ou contains
    const match = opts.find((o) => {
      const label = normalizeText(o.label);
      const value = normalizeText(o.value);
      return label === t || value === t || (label && label.includes(t));
    });
    return match || null;
  }

  return null;
}

/**
 * @param {import('../flowTypes').FlowNode} node
 * @param {import('../flowTypes').ConversationState} state
 * @param {any} [input]
 * @param {import('../flowTypes').NodeDependencies} [deps]
 */
async function businessEntryNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  const tenantId = safeString(nextState.tenantId).trim();
  const executionId = getExecutionId(nextState);
  const isDryRun = isDryRunState(nextState);

  /** @type {import('../flowTypes').EngineEvent[]} */
  const events = [];

  const selectedNext =
    (node.next && typeof node.next === 'object' && !Array.isArray(node.next) && node.next.selected) ? node.next.selected : null;
  const skipNext =
    (node.next && typeof node.next === 'object' && !Array.isArray(node.next) && node.next.skip) ? node.next.skip : null;

  // Se já temos opções geradas, tentamos resolver seleção primeiro.
  const storedOptionsKey = `business_entry.${node.id}.options`;
  const storedOptions = Array.isArray(nextState.variables?.[storedOptionsKey])
    ? nextState.variables[storedOptionsKey]
    : null;

  if (storedOptions && input) {
    const chosen = resolveSelection(input, storedOptions);
    if (chosen) {
      const selectedValue = chosen.value != null ? chosen.value : chosen.id;
      nextState.variables[`business_entry.${node.id}.selected`] = selectedValue;

      events.push(
        createEngineEvent('BUSINESS_ENTRY_SELECTED', {
          nodeId: node.id,
          selected: selectedValue,
          executionId,
        }),
      );

      if (selectedNext && selectedNext !== state.currentNodeId) {
        nextState.currentNodeId = selectedNext;
      }

      return {
        nextState,
        events,
        output: {
          type: 'business_entry',
          selected: selectedValue,
          route: 'selected',
        },
      };
    }
  }

  // Sem executionId (ou sem serviço disponível): vai para skip.
  if (!tenantId || !executionId || !businessEntitiesService?.extractBusinessEntities) {
    events.push(
      createEngineEvent('BUSINESS_ENTRY_SKIPPED', {
        nodeId: node.id,
        reason: !tenantId ? 'missing_tenantId' : (!executionId ? 'missing_executionId' : 'service_unavailable'),
      }),
    );

    if (skipNext && skipNext !== state.currentNodeId) {
      nextState.currentNodeId = skipNext;
    }

    return {
      nextState,
      events,
      output: {
        type: 'business_entry',
        route: 'skip',
      },
    };
  }

  let entities = null;
  try {
    const res = await businessEntitiesService.extractBusinessEntities({
      tenantId,
      executionId,
      dryRun: isDryRun,
    });
    entities = res?.entities || null;
  } catch (err) {
    entities = null;
    events.push(
      createEngineEvent('BUSINESS_ENTRY_ERROR', {
        nodeId: node.id,
        error: err?.message || String(err),
        executionId,
      }),
    );
  }

  const services = Array.isArray(entities?.services)
    ? entities.services.map((s) => safeString(s).trim()).filter(Boolean).slice(0, 24)
    : [];

  if (services.length === 0) {
    events.push(
      createEngineEvent('BUSINESS_ENTRY_SKIPPED', {
        nodeId: node.id,
        reason: 'no_services',
        executionId,
      }),
    );

    if (skipNext && skipNext !== state.currentNodeId) {
      nextState.currentNodeId = skipNext;
    }

    return {
      nextState,
      events,
      output: {
        type: 'business_entry',
        route: 'skip',
      },
    };
  }

  // Gera opções e armazena no estado para próxima interação.
  const usedIds = new Set();
  const options = services.map((name, idx) => {
    const base = slugify(name);
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${base}_${suffix++}`;
    }
    usedIds.add(id);
    return { id, label: name, value: name };
  });

  nextState.variables[storedOptionsKey] = options;
  nextState.variables[`business_entry.${node.id}.count`] = options.length;

  events.push(
    createEngineEvent('BUSINESS_ENTRY_OPTIONS_READY', {
      nodeId: node.id,
      executionId,
      optionsCount: options.length,
    }),
  );

  // Output interativo: o runner deve manter currentNodeId neste nó até receber seleção.
  return {
    nextState,
    events,
    output: {
      type: 'options',
      message: 'Selecione um serviço:',
      optionsType: 'button',
      options,
      allowMultiple: false,
      _source: 'business_entry',
    },
  };
}

module.exports = {
  businessEntryNodeHandler,
};

