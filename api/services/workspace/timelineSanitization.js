'use strict';

const TECHNICAL_EVENT_PATTERN = /qa|rpa|replay|evidence|wave|mesh|autocorrection/i;
const TECHNICAL_SUMMARY_PATTERN = /qa\/rpa|\bqa\b|\brpa\b|replay|evidenceid|evid[êe]ncia|patch|diff|wave|mesh/i;
const ENGINEERING_PAYLOAD_KEYS = ['patch', 'proposed_patch', 'diff', 'teststorun', 'filestochange', 'actionchain', 'engine', 'step', 'replayurl', 'rootcause', 'diagnosis'];
const SUPPORT_DIAGNOSTIC_PAYLOAD_KEYS = ['affectedService', 'health', 'diagnosticCause', 'status'];
// Summary/source text que revela internals de engenharia (QA/RPA/replay/step/patch...)
// não pode chegar ao SUPPORT nem como texto livre — SUPPORT recebe visão
// diagnóstica (causa, serviço afetado, link de replay diagnóstico), nunca
// narrativa de engenharia.
const SUPPORT_ENGINEERING_TEXT_PATTERN = /\bqa\b|\brpa\b|replay|patch|diff|teststorun|filestochange|actionchain|\bengine\b|\bstep\b|wave|mesh|autocorrection/i;
const SUPPORT_DIAGNOSTIC_SUMMARY = 'Evento técnico diagnosticado — evidência disponível para investigação';
const SUPPORT_DIAGNOSTIC_SOURCE = 'diagnóstico';

const OPERATIONAL_INCIDENT_TYPE = 'operational_incident';
const OPERATIONAL_INCIDENT_SUMMARY = 'Instabilidade detectada e recuperada';
const OPERATIONAL_SOURCE = 'operação';

const SOURCE_BUSINESS_LABELS = {
  support: 'atendimento',
  billing: 'financeiro',
  marketing: 'marketing',
  projects: 'projetos',
  project_item: 'projetos',
  rag: 'documentos',
  workspace: OPERATIONAL_SOURCE,
};

function hasEngineeringPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const keys = Object.keys(payload).map((key) => key.toLowerCase());
  return ENGINEERING_PAYLOAD_KEYS.some((key) => keys.includes(key));
}

function isTechnicalEvent(event = {}) {
  if (event.type === 'evidence') return true;
  if (TECHNICAL_EVENT_PATTERN.test(String(event.source || ''))) return true;
  return hasEngineeringPayload(event.payload);
}

function productionSource(source) {
  const value = String(source || '');
  if (!value || TECHNICAL_EVENT_PATTERN.test(value)) return OPERATIONAL_SOURCE;
  return SOURCE_BUSINESS_LABELS[value] || value;
}

function productionSummary(summary) {
  const text = String(summary || '');
  if (!text || TECHNICAL_SUMMARY_PATTERN.test(text)) return OPERATIONAL_INCIDENT_SUMMARY;
  return text;
}

function productionDetailUrl(detailUrl) {
  const url = String(detailUrl || '');
  if (!url) return null;
  if (url.startsWith('/dev/')) return null;
  if (TECHNICAL_EVENT_PATTERN.test(url)) return null;
  return url;
}

function supportDetailUrl(detailUrl) {
  const url = String(detailUrl || '');
  if (!url) return null;
  if (url.startsWith('/dev/rpa-replays')) return url.replace(/^\/dev\//, '/');
  if (url.startsWith('/dev/')) return null;
  return url;
}

function supportDiagnosticPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const subset = {};
  SUPPORT_DIAGNOSTIC_PAYLOAD_KEYS.forEach((key) => {
    if (payload[key] !== undefined && payload[key] !== null) subset[key] = payload[key];
  });
  return Object.keys(subset).length > 0 ? subset : undefined;
}

function sanitizeProductionEvent(event = {}) {
  if (isTechnicalEvent(event)) {
    return {
      id: event.id,
      type: OPERATIONAL_INCIDENT_TYPE,
      source: OPERATIONAL_SOURCE,
      createdAt: event.createdAt,
      summary: OPERATIONAL_INCIDENT_SUMMARY,
      detailUrl: null,
    };
  }
  const sanitized = {
    id: event.id,
    type: event.type,
    source: productionSource(event.source),
    createdAt: event.createdAt,
    summary: productionSummary(event.summary),
  };
  if (event.status !== undefined && event.status !== null) sanitized.status = event.status;
  const detailUrl = productionDetailUrl(event.detailUrl);
  if (detailUrl) sanitized.detailUrl = detailUrl;
  return sanitized;
}

function supportSummary(summary) {
  const text = String(summary || '');
  if (!text) return SUPPORT_DIAGNOSTIC_SUMMARY;
  if (SUPPORT_ENGINEERING_TEXT_PATTERN.test(text)) return SUPPORT_DIAGNOSTIC_SUMMARY;
  return text;
}

function supportSource(source) {
  const value = String(source || '');
  if (!value) return value;
  if (TECHNICAL_EVENT_PATTERN.test(value)) return SUPPORT_DIAGNOSTIC_SOURCE;
  return value;
}

function sanitizeSupportEvent(event = {}) {
  const sanitized = {
    id: event.id,
    type: event.type,
    source: supportSource(event.source),
    createdAt: event.createdAt,
    summary: supportSummary(event.summary),
  };
  if (event.status !== undefined && event.status !== null) sanitized.status = event.status;
  if (event.refId) sanitized.refId = event.refId;
  const detailUrl = supportDetailUrl(event.detailUrl);
  if (detailUrl) sanitized.detailUrl = detailUrl;
  const payload = supportDiagnosticPayload(event.payload);
  if (payload) sanitized.payload = payload;
  return sanitized;
}

function sanitizeTimelineEvents(events = [], classification) {
  const level = String(classification || '').trim().toUpperCase();
  if (level === 'DEVELOPMENT') return events;
  if (level === 'SUPPORT') return events.map(sanitizeSupportEvent);
  return events.map(sanitizeProductionEvent);
}

module.exports = {
  sanitizeTimelineEvents,
  isTechnicalEvent,
  OPERATIONAL_INCIDENT_TYPE,
  OPERATIONAL_INCIDENT_SUMMARY,
  OPERATIONAL_SOURCE,
};
