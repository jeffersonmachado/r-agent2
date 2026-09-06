import { fetchJson, fetchBlob } from './client';

export function listExtensions() {
  return fetchJson('/api/pbx/extensions', { method: 'GET' });
}

export function upsertExtension(payload) {
  return fetchJson('/api/pbx/extensions', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function bulkUpsertExtensions(items) {
  return fetchJson('/api/pbx/extensions/bulk', {
    method: 'POST',
    body: JSON.stringify({ items: Array.isArray(items) ? items : [] }),
  });
}

export function listAcls() {
  return fetchJson('/api/pbx/acls', { method: 'GET' });
}

export function upsertAcl(payload) {
  return fetchJson('/api/pbx/acls', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function deleteAcl(id) {
  const qs = `?id=${encodeURIComponent(String(id || ''))}`;
  return fetchJson(`/api/pbx/acls${qs}`, { method: 'DELETE' });
}

export function getProvisioningToken() {
  // 404 = "Tenant PBX não encontrado" (tenant sem token provisionado —
  // estado vazio legítimo tratado pela página); sem expectedStatuses o
  // client logaria console.error e reprovaria a assertiva pageLoads da
  // page-surface wave.
  return fetchJson('/api/pbx/provisioning-token', { method: 'GET', expectedStatuses: [404] });
}

export function isProvisioningTokenNotFound(err) {
  return err?.status === 404;
}

export async function getProvisioningTokenOrNull() {
  // Tenant sem PBX/token provisionado é estado vazio legítimo: devolve null
  // em vez de lançar, para que as páginas renderizem o empty state sem
  // logger.error/toast no catch do load (a rejeição do Promise.all era
  // tratada como falha de carregamento — ver regressão em
  // frontend/src/api/expectedEmptyState404.test.js). Qualquer outro erro
  // continua sendo lançado (falha real segue visível).
  try {
    return await getProvisioningToken();
  } catch (err) {
    if (isProvisioningTokenNotFound(err)) return null;
    throw err;
  }
}

export function rotateProvisioningToken(expiresInSec = null) {
  const qs = expiresInSec != null ? `?expiresInSec=${encodeURIComponent(String(expiresInSec))}` : '';
  return fetchJson(`/api/pbx/provisioning-token/rotate${qs}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function revokeProvisioningToken() {
  return fetchJson('/api/pbx/provisioning-token/revoke', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function listPbxAuditEvents({ hours = 72, limit = 300 } = {}) {
  const qs = `?hours=${encodeURIComponent(String(hours))}&limit=${encodeURIComponent(String(limit))}`;
  return fetchJson(`/api/pbx/audit${qs}`, { method: 'GET' });
}

export function listTrunks() {
  return fetchJson('/api/pbx/trunks', { method: 'GET' });
}

export function upsertTrunk(payload) {
  return fetchJson('/api/pbx/trunks', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listRoutes(direction = null) {
  const qs = direction ? `?direction=${encodeURIComponent(direction)}` : '';
  return fetchJson(`/api/pbx/routes${qs}`, { method: 'GET' });
}

export function upsertRoute(payload) {
  return fetchJson('/api/pbx/routes', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listQueues() {
  return fetchJson('/api/pbx/queues', { method: 'GET' });
}

export function listQueueMetrics() {
  return fetchJson('/api/pbx/queues/metrics', { method: 'GET' });
}

export function upsertQueue(payload) {
  return fetchJson('/api/pbx/queues', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function dialplanPreview() {
  return fetchJson('/api/pbx/dialplan/preview', { method: 'POST', body: JSON.stringify({}) });
}

export function dialplanApply() {
  return fetchJson('/api/pbx/dialplan/apply', { method: 'POST', body: JSON.stringify({}) });
}

export function rollbackDialplan(version) {
  const qs = `?version=${encodeURIComponent(String(version || ''))}`;
  return fetchJson(`/api/pbx/dialplan/rollback${qs}`, { method: 'POST', body: JSON.stringify({}) });
}

export function listConfigVersions(limit = 20) {
  const qs = `?limit=${encodeURIComponent(String(limit || 20))}`;
  return fetchJson(`/api/pbx/config-versions${qs}`, { method: 'GET' });
}

export function pbxReload() {
  return fetchJson('/api/pbx/reload', { method: 'POST', body: JSON.stringify({}) });
}

export function listQueueMembers(queueId) {
  const qs = `?queueId=${encodeURIComponent(String(queueId || ''))}`;
  return fetchJson(`/api/pbx/queue-members${qs}`, { method: 'GET' });
}

export function upsertQueueMember(payload) {
  return fetchJson('/api/pbx/queue-members', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function deleteQueueMember(id) {
  const qs = `?id=${encodeURIComponent(String(id || ''))}`;
  return fetchJson(`/api/pbx/queue-members${qs}`, { method: 'DELETE' });
}

export function listDids() {
  return fetchJson('/api/pbx/dids', { method: 'GET' });
}

export function upsertDid(payload) {
  return fetchJson('/api/pbx/dids', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listCallRules(type = null) {
  const qs = type ? `?type=${encodeURIComponent(type)}` : '';
  return fetchJson(`/api/pbx/call-rules${qs}`, { method: 'GET' });
}

export function upsertCallRule(payload) {
  return fetchJson('/api/pbx/call-rules', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listAudioAssets(kind = null) {
  const qs = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  return fetchJson(`/api/pbx/audio-assets${qs}`, { method: 'GET' });
}

export function uploadAudioAsset({ kind, file }) {
  const fd = new FormData();
  if (kind) fd.append('kind', String(kind));
  if (file) fd.append('file', file);
  return fetchJson('/api/pbx/audio-assets/upload', {
    method: 'POST',
    body: fd,
  });
}

export function listRecordings(limit = 200) {
  const qs = `?limit=${encodeURIComponent(String(limit))}`;
  return fetchJson(`/api/pbx/recordings${qs}`, { method: 'GET' });
}

export function scanRecordings() {
  return fetchJson('/api/pbx/recordings/scan', { method: 'POST', body: JSON.stringify({}) });
}

/**
 * Baixa o áudio de uma gravação (autenticado) e devolve um Blob
 * para uso em <audio> via URL.createObjectURL.
 */
export async function fetchRecordingFile(id) {
  const response = await fetchBlob(`/api/pbx/recordings/file?id=${encodeURIComponent(String(id))}`, { method: 'GET' });
  return response.blob();
}

export function getRecordingPolicy() {
  return fetchJson('/api/pbx/recordings/policy', { method: 'GET' });
}

export function saveRecordingPolicy(payload) {
  return fetchJson('/api/pbx/recordings/policy', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function listCdr(filters = {}) {
  const sp = new URLSearchParams();
  if (filters.limit != null) sp.set('limit', String(filters.limit));
  if (filters.from) sp.set('from', String(filters.from));
  if (filters.to) sp.set('to', String(filters.to));
  if (filters.src) sp.set('src', String(filters.src));
  if (filters.dst) sp.set('dst', String(filters.dst));
  if (filters.uniqueid) sp.set('uniqueid', String(filters.uniqueid));
  const qs = sp.toString() ? `?${sp.toString()}` : '';
  return fetchJson(`/api/pbx/cdr${qs}`, { method: 'GET' });
}

export function getOperatorPanelSnapshot(filters = {}) {
  const sp = new URLSearchParams();
  if (filters.queueId) sp.set('queueId', String(filters.queueId));
  if (filters.memberRef) sp.set('memberRef', String(filters.memberRef));
  if (filters.cdrLimit != null) sp.set('cdrLimit', String(filters.cdrLimit));
  if (filters.callWindowMinutes != null) sp.set('callWindowMinutes', String(filters.callWindowMinutes));
  if (filters.activeCallWindowMinutes != null) sp.set('activeCallWindowMinutes', String(filters.activeCallWindowMinutes));
  const qs = sp.toString() ? `?${sp.toString()}` : '';
  return fetchJson(`/api/pbx/operator-panel/snapshot${qs}`, { method: 'GET' });
}

export function setOperatorAgentStatus(payload) {
  return fetchJson('/api/pbx/operator-panel/agent-status', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function setOperatorAgentPauseQueue(payload) {
  return fetchJson('/api/pbx/operator-panel/agent-pause-queue', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function operatorTransfer(payload) {
  return fetchJson('/api/pbx/operator-panel/transfer', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

export function operatorCallback(payload) {
  return fetchJson('/api/pbx/operator-panel/callback', {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

/**
 * Retorna a URL base para o SSE do painel operador.
 * Deve ser usado com `new EventSource(buildOperatorPanelEventsUrl(filters))`.
 */
export function buildOperatorPanelEventsUrl(filters = {}, options = {}) {
  const sp = new URLSearchParams();
  if (filters.queueId) sp.set('queueId', String(filters.queueId));
  if (filters.memberRef) sp.set('memberRef', String(filters.memberRef));
  if (filters.cdrLimit != null) sp.set('cdrLimit', String(filters.cdrLimit));
  if (filters.callWindowMinutes != null) sp.set('callWindowMinutes', String(filters.callWindowMinutes));
  if (filters.activeCallWindowMinutes != null) sp.set('activeCallWindowMinutes', String(filters.activeCallWindowMinutes));
  if (options.intervalSec != null) sp.set('intervalSec', String(options.intervalSec));
  if (options.maxDurationSec != null) sp.set('maxDurationSec', String(options.maxDurationSec));
  // EventSource não envia header Authorization: o token vai via query param
  // (aceito apenas por esta rota SSE — ver operatorPanelRoutes.js).
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) sp.set('token', token);
  }
  const qs = sp.toString() ? `?${sp.toString()}` : '';
  // Resolve to full URL so EventSource can use it (supports relative paths via window.location.origin)
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/api/pbx/operator-panel/events${qs}`;
}

// ─── CC Queue Reports ─────────────────────────────────────────────────────────

function buildReportQs(filters = {}) {
  const sp = new URLSearchParams();
  if (filters.from) sp.set('from', String(filters.from));
  if (filters.to) sp.set('to', String(filters.to));
  if (filters.queueName) sp.set('queueName', String(filters.queueName));
  if (filters.limit) sp.set('limit', String(filters.limit));
  return sp.toString() ? `?${sp.toString()}` : '';
}

export function getCcReportAtendidas(filters = {}) {
  return fetchJson(`/api/cc/reports/atendidas${buildReportQs(filters)}`);
}

export function getCcReportAbandonadas(filters = {}) {
  return fetchJson(`/api/cc/reports/abandonadas${buildReportQs(filters)}`);
}

export function getCcReportAgentes(filters = {}) {
  return fetchJson(`/api/cc/reports/agentes${buildReportQs(filters)}`);
}

export function getCcReportPorHora(filters = {}) {
  return fetchJson(`/api/cc/reports/por-hora${buildReportQs(filters)}`);
}

export function getCcReportResumoCampanha(filters = {}) {
  return fetchJson(`/api/cc/reports/resumo-campanha${buildReportQs(filters)}`);
}

export function getCcReportPesquisa(filters = {}) {
  return fetchJson(`/api/cc/reports/pesquisa${buildReportQs(filters)}`);
}
