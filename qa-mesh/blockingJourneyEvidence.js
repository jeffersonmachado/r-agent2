'use strict';

/**
 * Evidência operacional de jornadas blocking (browser real).
 *
 * Contexto: `meshRunner.executeScenarioWithFallback` recusa validar jornadas
 * blocking (support_ticket_flow, fitness_customer_checkin) sem o runner
 * operacional de browser ("Blocking journey nunca deve executar step com
 * page null"). O mesh não possui browser; quem produz essa prova é o smoke
 * prod-like das QA Waves (`scripts/smoke/qa-waves-operational-final-smoke.js`),
 * que executa as jornadas com Playwright real e grava
 * `qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json`.
 *
 * Este módulo é a ponte: permite ao mesh CONSUMIR a evidência operacional
 * fresca em vez de falhar a jornada por incapacidade do executor. Sem
 * evidência válida o comportamento de falha é mantido (nunca mascara).
 *
 * Frescor segue a convenção do projeto (requireFreshReplayDays = 7 em
 * qaWavesOperationalService): evidência com mais de 168h é STALE.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DEFAULT_EVIDENCE_PATH = path.join(
  ROOT_DIR, 'qa', 'smoke', 'prod-like', 'qa-waves-operational-prod-like-smoke.json',
);
const DEFAULT_MAX_AGE_HOURS = 168; // 7 dias — convenção requireFreshReplayDays=7

function resolveEvidencePath(options = {}) {
  return options.evidencePath
    || process.env.MESH_BLOCKING_EVIDENCE_PATH
    || DEFAULT_EVIDENCE_PATH;
}

function resolveMaxAgeHours(options = {}) {
  const raw = options.maxAgeHours !== undefined
    ? options.maxAgeHours
    : process.env.MESH_BLOCKING_EVIDENCE_MAX_AGE_HOURS;
  const hours = Number(raw);
  return Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_MAX_AGE_HOURS;
}

/**
 * Avalia a evidência operacional de uma jornada blocking.
 *
 * @param {string} journeyId id da jornada (ex.: 'support_ticket_flow')
 * @param {object} [options]
 * @param {string} [options.evidencePath] caminho do JSON de evidência (testes)
 * @param {number} [options.maxAgeHours] idade máxima aceitável em horas
 * @param {number} [options.now] timestamp ms injetável (testes)
 * @returns {{ status: 'valid'|'missing'|'invalid'|'stale'|'not_go', ... }}
 *   `valid` somente quando: arquivo existe, generatedAt fresco, a jornada
 *   consta com replay GO + audit válido + governança estrita GO + ao menos
 *   um screenshot (prova de browser real, regra das jornadas blocking).
 */
function loadBlockingJourneyEvidence(journeyId, options = {}) {
  const evidencePath = resolveEvidencePath(options);
  const maxAgeHours = resolveMaxAgeHours(options);
  const now = Number.isFinite(options.now) ? options.now : Date.now();

  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  } catch {
    return { status: 'missing', journeyId, evidencePath };
  }

  const generatedAtMs = Date.parse(summary.generatedAt || '');
  if (!Number.isFinite(generatedAtMs)) {
    return { status: 'invalid', journeyId, evidencePath, detail: 'generatedAt ausente ou inválido' };
  }

  const ageMs = now - generatedAtMs;
  const maxAgeMs = maxAgeHours * 3600 * 1000;
  if (ageMs > maxAgeMs || ageMs < 0) {
    return {
      status: 'stale',
      journeyId,
      evidencePath,
      generatedAt: summary.generatedAt,
      ageHours: Math.round(ageMs / 3600000),
      maxAgeHours,
    };
  }

  const flows = Array.isArray(summary.flows) ? summary.flows : [];
  const flow = flows.find((item) => item && item.journeyId === journeyId);
  if (!flow) {
    return { status: 'missing', journeyId, evidencePath, detail: 'jornada ausente na evidência operacional' };
  }

  const replayGo = flow.replay && flow.replay.status === 'GO';
  const auditValid = flow.audit && flow.audit.valid === true;
  const strictGo = flow.strictGovernance && flow.strictGovernance.status === 'GO';
  const screenshots = flow.replay && Array.isArray(flow.replay.screenshots)
    ? flow.replay.screenshots.length
    : 0;

  if (replayGo && auditValid && strictGo && screenshots > 0) {
    return {
      status: 'valid',
      journeyId,
      evidencePath,
      generatedAt: summary.generatedAt,
      replayId: flow.replay.id || null,
      screenshots,
    };
  }

  return {
    status: 'not_go',
    journeyId,
    evidencePath,
    generatedAt: summary.generatedAt,
    detail: { replayGo, auditValid, strictGo, screenshots },
  };
}

module.exports = {
  DEFAULT_EVIDENCE_PATH,
  DEFAULT_MAX_AGE_HOURS,
  resolveEvidencePath,
  resolveMaxAgeHours,
  loadBlockingJourneyEvidence,
};
