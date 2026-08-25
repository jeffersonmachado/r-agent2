/**
 * Normalizador de replays — converte os formatos heterogêneos de replay em um
 * esquema comum de passos para o componente reutilizável <ReplayPlayer />.
 *
 * Formatos suportados:
 * - Replay do QA Mesh (`qa-mesh/meshEvidence/*​/replays/*.json`):
 *   { steps: [{ index, name, actor, category }], logs, assertions, errors }
 * - Replay RPA (`rpa/replay/*.json`):
 *   { actions, screens, events/timeline, errors }
 * - Detalhes de QA Waves:
 *   { steps: [{ title, category, actor, status, at, screenshotBefore/After }] }
 */

function timestampOf(value) {
  const raw = value?.at || value?.timestamp || value?.startedAt || value?.finishedAt || null;
  if (!raw || String(raw) === '[REDACTED]') return null;
  const time = new Date(raw).getTime();
  if (Number.isNaN(time)) return null;
  return raw;
}

function toScreenshotSrc(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Data URLs (base64), object URLs (blob:) e URLs absolutas http(s) são
  // servíveis diretamente.
  if (/^(data:image\/|blob:|https?:\/\/)/i.test(trimmed)) return trimmed;
  // Rotas relativas servíveis pela aplicação.
  if (/^\/(api|uploads|static|assets|replays|recordings|rpa)\//i.test(trimmed)) return trimmed;
  // Paths absolutos de filesystem (/opt, /home, /var, /tmp, /usr, /root, C:\,
  // etc.) não são URLs servíveis pelo navegador — não renderizar, para evitar
  // <img> quebrado (404).
  return null;
}

function isErrorStatus(value) {
  const raw = String(value || '').toLowerCase();
  return ['failed', 'failure', 'error', 'timeout'].includes(raw);
}

function normalizeStep(step, index) {
  return {
    id: step.id || step.screenId || `step-${step.index || index + 1}`,
    index: step.index || index + 1,
    title: step.title || step.name || `Passo ${step.index || index + 1}`,
    type: 'step',
    category: step.category || null,
    actor: step.actor || step.stepActor || null,
    status: step.status || null,
    at: timestampOf(step),
    description: step.description || step.trainingDescription || null,
    trainingDescription: step.trainingDescription || step.metadata?.trainingDescription || null,
    trainingHint: step.trainingHint || step.metadata?.trainingHint || null,
    expectedVisual: step.expectedVisual || step.metadata?.expectedVisual || null,
    screenshotBefore: toScreenshotSrc(step.screenshotBefore || step.evidence?.screenshotBefore),
    screenshotAfter: toScreenshotSrc(step.screenshotAfter || step.evidence?.screenshotAfter),
    screenshot: toScreenshotSrc(step.screenshot || step.screenshotDataUrl || step.evidence?.screenshot),
    isError: isErrorStatus(step.status) || Boolean(step.error),
  };
}

function normalizeAction(action, index) {
  const valueText = typeof action.value === 'string'
    ? action.value
    : action.value?.url || action.value?.text || null;
  return {
    id: action.id || `action-${index + 1}`,
    index: index + 1,
    title: action.step || action.type || `Ação ${index + 1}`,
    type: 'action',
    category: 'RPA_ACTION',
    actor: 'rpa',
    status: action.success === false ? 'failed' : (action.success === true ? 'passed' : null),
    at: timestampOf(action),
    description: action.error || valueText || null,
    trainingDescription: action.trainingDescription || action.metadata?.trainingDescription || null,
    trainingHint: action.trainingHint || action.metadata?.trainingHint || null,
    expectedVisual: action.expectedVisual || action.metadata?.expectedVisual || null,
    screenshotBefore: null,
    screenshotAfter: null,
    screenshot: null,
    isError: Boolean(action.error) || action.success === false,
  };
}

function normalizeScreen(screen, index) {
  return {
    id: screen.screenId || `screen-${index + 1}`,
    index: index + 1,
    title: screen.step || screen.screenId || `Tela ${index + 1}`,
    type: 'screen',
    category: null,
    actor: 'rpa',
    status: null,
    at: timestampOf(screen),
    description: screen.signatureData?.url || screen.signatureData?.title || null,
    screenshotBefore: null,
    screenshotAfter: null,
    screenshot: screen.screenshot ? `data:image/png;base64,${screen.screenshot}` : null,
    isError: false,
  };
}

function normalizeEvent(event, index) {
  const description = event.data && typeof event.data === 'object'
    ? Object.entries(event.data).map(([key, value]) => `${key}: ${value}`).join(' · ').slice(0, 160)
    : (event.data ? String(event.data).slice(0, 160) : null);
  return {
    id: event.id || `event-${index + 1}`,
    index: index + 1,
    title: event.type || `Evento ${index + 1}`,
    type: 'event',
    category: 'SYSTEM_EVENT',
    actor: null,
    status: null,
    at: timestampOf(event),
    description,
    screenshotBefore: null,
    screenshotAfter: null,
    screenshot: null,
    isError: isErrorStatus(event.level) || isErrorStatus(event.type),
  };
}

function normalizeLog(log, index) {
  return {
    id: `log-${index + 1}`,
    index: index + 1,
    title: log.message || log.error || `Log ${index + 1}`,
    type: 'log',
    category: null,
    actor: 'log',
    status: null,
    at: timestampOf(log),
    description: log.level || null,
    screenshotBefore: null,
    screenshotAfter: null,
    screenshot: null,
    isError: isErrorStatus(log.level),
  };
}

/**
 * Converte qualquer payload de replay em uma lista ordenada de passos normalizados.
 *
 * @param {object} [payload]
 * @returns {Array<{id:string,index:number,title:string,type:string,category:string|null,
 *   actor:string|null,status:string|null,at:string|null,description:string|null,
 *   screenshotBefore:string|null,screenshotAfter:string|null,screenshot:string|null,
 *   isError:boolean}>}
 */
export function normalizeReplaySteps(payload = {}) {
  if (!payload || typeof payload !== 'object') return [];

  const items = [];
  const seen = new Set();
  const push = (item) => {
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
    }
  };

  (payload.steps || []).forEach((step, index) => push(normalizeStep(step, index)));
  (payload.actions || []).forEach((action, index) => push(normalizeAction(action, index)));
  (payload.screens || []).forEach((screen, index) => push(normalizeScreen(screen, index)));
  (payload.events || payload.timeline || []).forEach((event, index) => push(normalizeEvent(event, index)));

  // Replays sem passos estruturados (ex.: adapter api) caem para os logs.
  if (items.length === 0 && Array.isArray(payload.logs) && payload.logs.length > 0) {
    payload.logs.forEach((log, index) => push(normalizeLog(log, index)));
  }

  const withTime = items.map((item) => ({
    ...item,
    sortAt: item.at ? new Date(item.at).getTime() : 0,
  }));

  return withTime
    .sort((a, b) => {
      if (a.sortAt !== b.sortAt) return a.sortAt - b.sortAt;
      return a.index - b.index;
    })
    .map(({ sortAt, ...item }, position) => ({ ...item, index: position + 1 }));
}

/**
 * Extrai entradas digitadas em campos (type/fill) das ações RPA.
 *
 * @param {object} [payload]
 * @returns {Array<{id:string,field:string,value:string}>}
 */
export function normalizeTypedEntries(payload = {}) {
  if (!payload || typeof payload !== 'object') return [];
  const entries = [];
  (payload.actions || []).forEach((action) => {
    const type = String(action.type || '').toLowerCase();
    if (type === 'type' || type === 'fill' || type === 'select') {
      const value = typeof action.value === 'string'
        ? action.value
        : action.value?.text || action.value?.value || '';
      entries.push({
        id: action.step || `typed-${entries.length + 1}`,
        field: action.selector || action.step || 'campo',
        value: String(value),
      });
    }
  });
  return entries;
}

/**
 * Extrai as assertivas (lista de strings) de um payload de replay.
 *
 * @param {object} [payload]
 * @returns {string[]}
 */
export function normalizeAssertions(payload = {}) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.assertions)) {
    return payload.assertions.filter((item) => typeof item === 'string' || item?.text);
  }
  return [];
}

function computeMutationDiff(before, after) {
  const rows = [];
  const walk = (left, right, basePath = '') => {
    const leftObj = left && typeof left === 'object' && !Array.isArray(left) ? left : {};
    const rightObj = right && typeof right === 'object' && !Array.isArray(right) ? right : {};
    const keys = new Set([...Object.keys(leftObj), ...Object.keys(rightObj)]);
    keys.forEach((key) => {
      const path = basePath ? `${basePath}.${key}` : key;
      const prev = leftObj[key];
      const next = rightObj[key];
      const bothObjects = prev && next && typeof prev === 'object' && typeof next === 'object' && !Array.isArray(prev) && !Array.isArray(next);
      if (bothObjects) {
        walk(prev, next, path);
        return;
      }
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        rows.push({ path, before: prev, after: next });
      }
    });
  };
  walk(before, after, '');
  return rows.slice(0, 120);
}

function toEvidenceMap(steps) {
  return steps.slice(0, 120).map((step) => ({
    id: step.id,
    actionType: step.category || step.type || 'n/a',
    url: step.description || step.title || 'n/a',
    timestamp: step.at || 'n/a',
    screenshotBefore: step.screenshotBefore,
    screenshotAfter: step.screenshotAfter || step.screenshot,
  }));
}

/**
 * Extrai e normaliza as evidências de governança de um replay (timeline
 * operacional, mutation diff, side effects e snapshots antes/depois).
 *
 * @param {object} [payload]
 * @param {Array} [steps] Passos já normalizados (para o evidence map).
 * @returns {{timeline:Array,mutationDiff:Array,sideEffects:object,
 *   snapshots:object,evidenceMap:Array}|null}
 */
export function normalizeReplayEvidence(payload = {}, steps = []) {
  if (!payload || typeof payload !== 'object') return null;

  const mutation = payload.stateMutation || {};
  const contract = payload.stateSnapshotContract || {};
  const required = mutation.requiredSideEffects || contract?.contract?.requiredSideEffects || [];
  const observed = mutation.observedSideEffects || [];

  const timeline = Array.isArray(payload.operationalTimeline) && payload.operationalTimeline.length > 0
    ? payload.operationalTimeline
    : (payload.beforeSnapshot || payload.afterSnapshot ? [
        {
          id: 'initial_state',
          type: 'state',
          label: 'ANTES',
          state: payload.beforeSnapshot?.state || payload.beforeSnapshot || null,
          status: payload.beforeSnapshot ? 'CAPTURED' : 'MISSING',
        },
        {
          id: 'transition',
          type: 'transition',
          label: 'TRANSICAO',
          from: payload.beforeSnapshot?.state || null,
          to: payload.afterSnapshot?.state || null,
          status: mutation.valid && contract.valid ? 'GO' : 'NO_GO',
        },
        {
          id: 'final_state',
          type: 'state',
          label: 'DEPOIS',
          state: payload.afterSnapshot?.state || payload.afterSnapshot || null,
          status: payload.afterSnapshot ? 'CAPTURED' : 'MISSING',
        },
      ] : []);

  return {
    timeline,
    mutationDiff: computeMutationDiff(payload.beforeSnapshot, payload.afterSnapshot),
    sideEffects: {
      required,
      observed,
      missing: required.filter((item) => !observed.includes(item)),
    },
    snapshots: {
      before: payload.beforeSnapshot || null,
      after: payload.afterSnapshot || null,
      contract: contract || null,
    },
    evidenceMap: toEvidenceMap(steps),
  };
}
