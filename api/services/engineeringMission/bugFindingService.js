'use strict';

/**
 * api/services/engineeringMission/bugFindingService.js
 *
 * REGISTRO, DEDUPLICAÇÃO, EVIDÊNCIA E CICLO DE VIDA de um bug detectado pelo RAP.
 *
 * Este serviço é o ÚNICO ponto de escrita do modelo de finding — nenhuma outra camada cria/edita
 * `engineering_bug_findings`. Todas as fontes de detecção (teste unitário/integração/E2E, gate de
 * release, exceção, crash, timeout, NO_PROGRESS, invariante, meta/adversarial reviewer, telemetria,
 * stale write, governança, relato humano) entram por `registerFinding` — nunca uma integração por
 * fonte.
 *
 * As REGRAS (quando confirmar, quando declarar FIXED, quando exigir aprovação humana, quando o ciclo
 * está fazendo greenwashing) vivem em `engine/engineeringMission/bugFinding/` e são apenas APLICADAS
 * aqui — o gate de governança lê o MESMO motor, então não existe uma segunda opinião sobre o ciclo.
 *
 * Persistência real via Sequelize, sem fallback em memória (convenção do projeto:
 * `persistence_required`).
 */

const getEngineeringBugFindingModel = require('../../db/models/EngineeringBugFinding');
const getEngineeringBugFindingEventModel = require('../../db/models/EngineeringBugFindingEvent');
const { Op } = require('sequelize');
const crypto = require('crypto');
const engine = require('../../../engine/engineeringMission/bugFinding');
const { emitMissionStage } = require('./missionEvents');
const logger = require('../../utils/logger');

const PLATFORM_TENANT_ID = 'system';
const MAX_EVIDENCE_REFS = 200;

function persistenceRequired(detail) {
  const err = new Error(`persistence_required: ${detail}`);
  err.code = engine.BUG_FAILURE_CODES.FINDING_PERSISTENCE_REQUIRED;
  return err;
}

function model() {
  const M = getEngineeringBugFindingModel();
  if (!M || typeof M.create !== 'function') throw persistenceRequired('EngineeringBugFinding indisponível');
  return M;
}

function eventModel() {
  const M = getEngineeringBugFindingEventModel();
  if (!M || typeof M.create !== 'function') throw persistenceRequired('EngineeringBugFindingEvent indisponível');
  return M;
}

function toPlain(row) {
  return row && row.get ? row.get({ plain: true }) : row;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Normaliza uma evidência. Toda evidência precisa de TIPO conhecido e de uma REFERÊNCIA real
 * (artefato, run, relatório, invariante) — "achei que era bug" não é evidência.
 */
function makeEvidence(input = {}) {
  const type = String(input.type || '').toUpperCase();
  if (!engine.EVIDENCE_TYPES.includes(type)) {
    throw Object.assign(new Error(`tipo de evidência inválido: ${input.type}`), { code: 'INVALID_EVIDENCE_TYPE' });
  }
  const ref = input.ref || input.reference || null;
  if (!ref && !input.detail) {
    throw Object.assign(new Error('evidência exige `ref` ou `detail`'), { code: 'INVALID_EVIDENCE' });
  }
  return {
    id: input.id || `ev-${crypto.randomUUID()}`,
    type,
    ref,
    checksum: input.checksum || null,
    source: input.source || null,
    detail: input.detail || null,
    at: input.at || nowIso(),
  };
}

function appendEvidence(existing, incoming) {
  const list = Array.isArray(existing) ? existing : [];
  const merged = [...list, ...incoming];
  return merged.length > MAX_EVIDENCE_REFS ? merged.slice(merged.length - MAX_EVIDENCE_REFS) : merged;
}

async function recordEvent(findingId, type, payload = {}, { actor = null } = {}) {
  if (!engine.FINDING_EVENT_TYPES.includes(type)) {
    throw Object.assign(new Error(`tipo de evento de finding inválido: ${type}`), { code: 'INVALID_FINDING_EVENT_TYPE' });
  }
  const Event = eventModel();
  return toPlain(await Event.create({ finding_id: findingId, type, actor, payload }));
}

async function getFinding(findingId) {
  const row = await model().findByPk(findingId);
  return row ? toPlain(row) : null;
}

async function getFindingHistory(findingId) {
  const Event = eventModel();
  const rows = await Event.findAll({ where: { finding_id: findingId }, order: [['created_at', 'ASC']] });
  return rows.map(toPlain);
}

async function listFindings({
  missionId = null, status = null, severity = null, category = null,
  selfModification = null, fingerprint = null, limit = 50, offset = 0,
} = {}) {
  const where = {};
  if (missionId) where.mission_id = missionId;
  if (status) where.status = Array.isArray(status) ? { [Op.in]: status } : status;
  if (severity) where.severity = Array.isArray(severity) ? { [Op.in]: severity } : severity;
  if (category) where.category = category;
  if (selfModification !== null) where.self_modification = Boolean(selfModification);
  if (fingerprint) where.fingerprint = fingerprint;
  const rows = await model().findAll({
    where,
    order: [['last_seen_at', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
    offset: Math.max(Number(offset) || 0, 0),
  });
  return rows.map(toPlain);
}

function emitFindingStage(tenantId, finding, stage, { status = 'info', message, meta = null } = {}) {
  if (!finding?.mission_id) return;
  emitMissionStage(tenantId || PLATFORM_TENANT_ID, finding.mission_id, {
    stage,
    status,
    phase: 'BUG_LOOP',
    message: message || `finding ${finding.id} → ${finding.status}`,
    meta: { findingId: finding.id, severity: finding.severity, category: finding.category, ...(meta || {}) },
  });
}

/**
 * REGISTRA um finding. Sempre nasce SUSPECTED: nem a fonte mais forte (invariante violado) confirma
 * aqui — quem confirma é `confirmFinding`, com base objetiva + evidência (BUG-02/03/04).
 *
 * DEDUPLICAÇÃO (BUG-05): mesmo fingerprint e mesmo escopo de missão, com finding NÃO terminal, não
 * cria um segundo registro — incrementa `occurrences`, atualiza `last_seen_at` e anexa evidências.
 * REINCIDÊNCIA (BUG-17/18): finding já FIXED/REGRESSION_VALIDATED/CLOSED que reaparece volta para
 * CONFIRMED com `recurrence_count` incrementado e severidade escalada.
 */
/** Busca o finding NÃO terminal do mesmo escopo (fingerprint + missão quando declarada). */
async function findNonTerminalFinding({ fingerprint, missionId = null }) {
  const rows = await model().findAll({
    where: { fingerprint, ...(missionId ? { mission_id: missionId } : {}) },
    order: [['last_seen_at', 'DESC']],
    limit: 5,
  });
  return rows.map(toPlain).find((row) => row.status !== 'DUPLICATE') || null;
}

/** Violação de unicidade do Postgres/Sequelize (a corrida de deduplicação). */
function isUniqueViolation(err) {
  return err?.name === 'SequelizeUniqueConstraintError'
    || err?.parent?.code === '23505'
    || /duplicate key value violates unique constraint/i.test(String(err?.message || ''));
}

/**
 * Agrega uma NOVA entrega ao finding existente do mesmo escopo.
 *
 * Duas saídas, nunca achatadas:
 *   - REINCIDÊNCIA: a falha já havia sido resolvida e voltou ⇒ reabre o MESMO registro, escalando
 *     severidade e incrementando `recurrence_count` (a base objetiva da confirmação anterior fica);
 *   - OCORRÊNCIA: o ciclo ainda está em andamento ⇒ só acumula ocorrências/evidência.
 */
async function applyToExisting(existing, { evidence = [], assessment = {}, actor = null, tenantId = null } = {}) {
  if (engine.isRecurrence(existing.status)) {
    const previousStatus = existing.status;
    const recurrence = engine.applyRecurrence({
      previousStatus,
      severity: existing.severity,
      recurrenceCount: existing.recurrence_count,
      now: nowIso(),
    });
    const updated = await model().update({
      status: recurrence.status,
      severity: recurrence.severity,
      recurrence_count: recurrence.recurrenceCount,
      occurrences: existing.occurrences + 1,
      last_seen_at: nowIso(),
      resolved_at: null,
      version: Number(existing.version || 0) + 1,
      // A base objetiva da confirmação anterior permanece: é a MESMA falha, já confirmada com
      // evidência; a reincidência acrescenta a ocorrência nova e o histórico (BUG-18).
      confirmation_basis: existing.confirmation_basis,
      evidence_refs: appendEvidence(existing.evidence_refs, evidence),
      severity_signals: Array.from(new Set([...(existing.severity_signals || []), ...(assessment.signals || [])])),
    }, { where: { id: existing.id, version: Number(existing.version || 0) } });
    void updated;
    const refreshed = await getFinding(existing.id);
    await recordEvent(existing.id, 'RECURRENCE', {
      previousStatus,
      recurrenceCount: recurrence.recurrenceCount,
      severityFrom: existing.severity,
      severityTo: recurrence.severity,
      evidenceCount: evidence.length,
    }, { actor });
    logger.warn('[bugFindingService] reincidência de finding', { findingId: existing.id, previousStatus, recurrenceCount: recurrence.recurrenceCount });
    emitFindingStage(tenantId, refreshed, 'BUG_RECURRENCE', {
      status: 'error',
      message: `reincidência #${recurrence.recurrenceCount} do finding ${existing.id} (severidade ${existing.severity} → ${recurrence.severity})`,
    });
    return { finding: refreshed, deduplicated: false, recurrence: true, previousStatus };
  }

  // OCORRÊNCIA: incremento ATÔMICO no banco. Ler `occurrences` e regravar (o padrão anterior)
  // perdia atualizações sob concorrência — medido: 7 entregas simultâneas agregadas deixavam
  // `occurrences = 2`. Aqui o contador e o append de evidência/sinais são feitos pelo próprio SQL.
  const [occurrenceRows] = await model().sequelize.query(
    `UPDATE engineering_bug_findings
        SET occurrences = occurrences + 1,
            last_seen_at = :now,
            evidence_refs = CASE
              WHEN jsonb_typeof(evidence_refs) = 'array' THEN evidence_refs || :evidence::jsonb
              ELSE evidence_refs
            END,
            severity_signals = CASE
              WHEN jsonb_typeof(severity_signals) = 'array'
                THEN COALESCE((SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements_text(severity_signals || :signals::jsonb)), '[]'::jsonb)
              ELSE severity_signals
            END,
            updated_at = :now
      WHERE id = :id
      RETURNING occurrences`,
    {
      replacements: {
        id: existing.id,
        now: nowIso(),
        evidence: JSON.stringify(evidence || []),
        signals: JSON.stringify(assessment.signals || []),
      },
    },
  );
  const occurrenceRow = Array.isArray(occurrenceRows) ? occurrenceRows[0] : occurrenceRows;
  const refreshed = await getFinding(existing.id);
  await recordEvent(existing.id, 'OCCURRENCE', {
    occurrences: occurrenceRow?.occurrences ?? refreshed?.occurrences ?? null,
    evidenceCount: (evidence || []).length,
  }, { actor });
  return { finding: refreshed, deduplicated: true, recurrence: false };
}

async function registerFinding(input = {}, { actor = null, tenantId = null } = {}) {
  const title = String(input.title || '').trim();
  if (title === '') throw Object.assign(new Error('finding exige `title`'), { code: 'INVALID_FINDING' });
  const source = String(input.source || '').toUpperCase();
  if (!engine.FINDING_SOURCES.includes(source)) {
    throw Object.assign(new Error(`fonte de finding inválida: ${input.source}`), { code: 'INVALID_FINDING_SOURCE' });
  }

  const fingerprint = input.fingerprint || engine.computeFingerprint({ ...input, source, title });
  if (!fingerprint) {
    throw Object.assign(new Error('não foi possível derivar fingerprint: informe ao menos um identificador (erro, teste, rota, símbolo, invariante ou título)'), { code: 'FINDING_FINGERPRINT_UNAVAILABLE' });
  }

  const assessment = engine.assessSeverity({ ...input, source, title });
  const missionId = input.missionId || null;
  const evidence = (Array.isArray(input.evidenceRefs) ? input.evidenceRefs : []).map(makeEvidence);

  // ESCOPO DA DEDUPLICAÇÃO: mesmo fingerprint; mesma missão quando declarada (uma falha idêntica em
  // missões distintas é rastreada por missão); nunca reaproveitar um finding já CLOSED como
  // "ocorrência" — esse caso é REINCIDÊNCIA e tem caminho próprio.
  const existing = await findNonTerminalFinding({ fingerprint, missionId });
  if (existing) return applyToExisting(existing, { evidence, assessment, actor, tenantId });

  let created = null;
  try {
    created = await model().create({
    mission_id: missionId,
    mission_version: input.missionVersion ?? null,
    mission_spec_hash: input.missionSpecHash ?? null,
    task_id: input.taskId || null,
    source,
    category: assessment.category,
    severity: assessment.severity,
    severity_signals: assessment.signals,
    advisory_severity: assessment.advisorySeverity,
    status: 'SUSPECTED',
    title,
    description: input.description || null,
    expected_behavior: input.expectedBehavior || null,
    observed_behavior: input.observedBehavior || null,
    root_cause: input.rootCause || null,
    reproduction: input.reproduction || {},
    reproduction_steps: input.reproductionSteps || [],
    evidence_refs: evidence,
    fingerprint,
    fingerprint_parts: engine.fingerprintParts({ ...input, source, title }),
    affected_subsystems: input.affectedSubsystems || [],
    affected_files: input.affectedFiles || [],
    related_findings: input.relatedFindings || [],
    self_modification: input.selfModification === true,
    // ORIGEM: qual porta do sistema entregou a observação (review, telemetria, hook de missão...).
    // É o que permite auditar de onde o ciclo de bug tirou cada item, sem inferência.
    origin: input.origin || null,
    depth: Number.isFinite(input.depth) ? input.depth : 0,
    parent_finding_id: input.parentFindingId || null,
    triage: {
      advisorySeverity: assessment.advisorySeverity,
      advisoryOnly: assessment.advisoryOnly,
      detectedAt: nowIso(),
      detectionSignals: assessment.signals,
      // PROCEDÊNCIA: quem originou a observação. `WORK` é trabalho de engenharia real;
      // `VERIFICATION` é missão de prova/gate — o finding é registrado igual, mas a varredura do
      // laço não o converte em item de correção (ver `bugLoopCoordinatorService.runBugLoopSweep`).
      provenance: input.provenance === 'VERIFICATION' ? 'VERIFICATION' : 'WORK',
    },
    classification: 'DEVELOPMENT',
    created_by: actor,
    idempotency_key: input.idempotencyKey || null,
    first_seen_at: nowIso(),
    last_seen_at: nowIso(),
    });
  } catch (err) {
    // DEDUPLICAÇÃO ATÔMICA: o índice único parcial do banco é a AUTORIDADE. Perder a corrida não
    // é erro — é a MESMA entrega chegando duas vezes (dois workers/duas retentativas): a ocorrência
    // é agregada ao finding canônico em vez de nascer um segundo registro.
    if (isUniqueViolation(err)) {
      const raced = await findNonTerminalFinding({ fingerprint, missionId });
      if (raced) {
        logger.info('[bugFindingService] deduplicação atômica: corrida resolvida pelo banco', { findingId: raced.id, fingerprint });
        return applyToExisting(raced, { evidence, assessment, actor, tenantId });
      }
    }
    throw err;
  }

  const finding = toPlain(created);
  await recordEvent(finding.id, 'REGISTERED', { source, category: finding.category, severity: finding.severity, fingerprint }, { actor });
  await recordEvent(finding.id, 'EVIDENCE_ADDED', { count: evidence.length }, { actor }).catch(() => {});
  logFinding(finding, 'registrado');
  emitFindingStage(tenantId, finding, 'BUG_FINDING_REGISTERED', {
    status: 'warning',
    message: `bug ${finding.severity} detectado (${source}): ${finding.title}`,
  });
  return { finding, deduplicated: false, recurrence: false };
}

function logFinding(finding, action) {
  logger.info('[bugFindingService] finding', {
    findingId: finding.id,
    action,
    status: finding.status,
    severity: finding.severity,
    category: finding.category,
    selfModification: finding.self_modification,
  });
}

/** Anexa evidência a um finding existente (dedupe por `ref`+`type`). */
async function addEvidence(findingId, evidenceInput, { actor = null, tenantId = null } = {}) {
  const finding = await getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });
  const evidence = makeEvidence(evidenceInput);
  const list = Array.isArray(finding.evidence_refs) ? finding.evidence_refs : [];
  const already = list.some((e) => e.ref && evidence.ref && e.ref === evidence.ref && e.type === evidence.type);
  if (already) return { finding, added: false };
  await model().update({ evidence_refs: appendEvidence(list, [evidence]) }, { where: { id: findingId } });
  await recordEvent(findingId, 'EVIDENCE_ADDED', { type: evidence.type, ref: evidence.ref }, { actor });
  const refreshed = await getFinding(findingId);
  emitFindingStage(tenantId, refreshed, 'BUG_EVIDENCE_ADDED', { message: `evidência ${evidence.type} anexada ao finding ${findingId}`, meta: { evidenceRef: evidence.ref } });
  return { finding: refreshed, added: true, evidence };
}

/** Transição crua (validada). Preferir os helpers semânticos abaixo. */
async function transitionFinding(findingId, toStatus, { actor = null, reason = null, patch = {}, tenantId = null } = {}) {
  const finding = await getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });
  const check = engine.assertTransition(finding.status, toStatus);
  if (check.idempotent) return { finding, idempotent: true };

  // ── CAS OTIMISTA (§ concorrência de estado) ────────────────────────────────────────────────
  // A versão lida é a CONDIÇÃO da escrita: se outra transição venceu no meio, `affected = 0` e o
  // estado atual é reexaminado em vez de sobrescrever. Sem isto, Worker A (CONFIRMED→FIXING) e
  // Worker B (CONFIRMED→BLOCKED, com a mesma leitura antiga) escreviam as duas — a última vencia
  // sem detecção.
  const expectedVersion = Number(finding.version || 0);
  const [affected] = await model().update(
    { status: toStatus, ...patch, version: expectedVersion + 1 },
    { where: { id: findingId, version: expectedVersion } },
  );

  if (!affected) {
    const current = await getFinding(findingId);
    // Concorrência convergente: outra transação já levou o finding ao MESMO destino ⇒ idempotente.
    if (current && current.status === toStatus) return { finding: current, idempotent: true, concurrent: true };
    const err = new Error(`transição concorrente rejeitada: finding ${findingId} está em ${current?.status || 'desconhecido'} (tentativa ${finding.status} → ${toStatus})`);
    err.code = 'FINDING_STATE_CONFLICT';
    err.detail = {
      findingId,
      from: finding.status,
      to: toStatus,
      currentStatus: current?.status || null,
      expectedVersion,
      currentVersion: current?.version ?? null,
    };
    logger.warn('[bugFindingService] conflito de versão na transição', err.detail);
    throw err;
  }

  await recordEvent(findingId, 'STATUS_CHANGED', { from: finding.status, to: toStatus, reason }, { actor });
  const refreshed = await getFinding(findingId);
  logFinding(refreshed, `→ ${toStatus}`);
  emitFindingStage(tenantId, refreshed, `BUG_${toStatus}`, {
    status: toStatus === 'CONFIRMED' || toStatus === 'REPRODUCING' ? 'warning' : (toStatus === 'FIXED' || toStatus === 'REGRESSION_VALIDATED' ? 'success' : 'info'),
    message: `finding ${findingId}: ${finding.status} → ${toStatus}${reason ? ` (${reason})` : ''}`,
  });
  return { finding: refreshed, idempotent: false, from: finding.status };
}

async function markReproducing(findingId, { actor = null, plan = null } = {}) {
  return transitionFinding(findingId, 'REPRODUCING', { actor, reason: 'tentativa de reprodução iniciada', patch: plan ? { reproduction: plan } : {} });
}

/**
 * CONFIRMA com BASE OBJETIVA + evidência. Sem base objetiva (suspeita de LLM, heurística, timout
 * isolado) recusa com `INSUFFICIENT_CONFIRMATION_BASIS` — nunca "confirma por narrativa".
 */
async function confirmFinding(findingId, { basis, evidence = [], actor = null, rootCause = null, reproduction = null, tenantId = null } = {}) {
  const finding = await getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });

  const merged = appendEvidence(
    Array.isArray(finding.evidence_refs) ? finding.evidence_refs : [],
    (Array.isArray(evidence) ? evidence : [evidence]).filter(Boolean).map(makeEvidence),
  );
  const assessment = engine.assessConfirmation({ confirmationBasis: basis, evidenceRefs: merged, source: finding.source });
  if (!assessment.confirmed) {
    throw Object.assign(new Error(assessment.reason), {
      code: assessment.code,
      detail: { findingId, basis, evidenceCount: merged.length, source: finding.source },
    });
  }

  if (finding.status === 'SUSPECTED') await transitionFinding(findingId, 'REPRODUCING', { actor, reason: 'confirmação com base objetiva' });
  const patch = {
    confirmation_basis: basis,
    evidence_refs: merged,
    ...(rootCause ? { root_cause: rootCause } : {}),
    ...(reproduction ? { reproduction } : {}),
  };
  const result = await transitionFinding(findingId, 'CONFIRMED', {
    actor,
    reason: `base objetiva ${basis}`,
    patch,
    tenantId,
  });
  return { finding: result.finding, basis, idempotent: result.idempotent === true };
}

async function markNotReproduced(findingId, { actor = null, reason = null, evidence = [], plan = null } = {}) {
  const patch = { ...(plan ? { reproduction: plan } : {}) };
  return transitionFinding(findingId, 'NOT_REPRODUCED', { actor, reason: reason || 'reprodução executada sem manifestar a falha', patch });
}

async function markDuplicate(findingId, duplicateOfFindingId, { actor = null, reason = null } = {}) {
  if (!duplicateOfFindingId) throw Object.assign(new Error('duplicata exige `duplicateOfFindingId`'), { code: 'INVALID_DUPLICATE' });
  const result = await transitionFinding(findingId, 'DUPLICATE', {
    actor,
    reason: reason || `duplicata de ${duplicateOfFindingId}`,
    patch: { duplicate_of: duplicateOfFindingId },
  });
  const original = await getFinding(duplicateOfFindingId);
  if (original) {
    const related = Array.from(new Set([...(original.related_findings || []), findingId]));
    await model().update({ related_findings: related }, { where: { id: duplicateOfFindingId } });
  }
  return result;
}

async function linkFixTask(findingId, taskId, { actor = null, taskContract = null, tenantId = null } = {}) {
  const finding = await getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });
  if (finding.fix_task_id && finding.fix_task_id !== taskId) {
    throw Object.assign(new Error(`finding ${findingId} já possui task de correção ${finding.fix_task_id}`), {
      code: engine.BUG_FAILURE_CODES.FINDING_TASK_ALREADY_LINKED,
      detail: { findingId, existingTaskId: finding.fix_task_id, taskId },
    });
  }
  await model().update({
    fix_task_id: taskId,
    fix_attempts: (finding.fix_attempts || 0) + 1,
    triage: { ...(finding.triage || {}), fixTaskContract: taskContract || (finding.triage || {}).fixTaskContract || null, taskLinkedAt: nowIso() },
  }, { where: { id: findingId } });
  await recordEvent(findingId, 'FIX_TASK_LINKED', { taskId, taskContract }, { actor });
  if (finding.status === 'CONFIRMED') await transitionFinding(findingId, 'FIXING', { actor, reason: `task de correção ${taskId}`, tenantId });
  const refreshed = await getFinding(findingId);
  emitFindingStage(tenantId, refreshed, 'BUG_FIX_TASK_LINKED', { message: `task ${taskId} vinculada ao finding ${findingId}`, meta: { taskId } });
  return refreshed;
}

async function markFixApplied(findingId, { actor = null, taskId = null, attemptId = null, evidence = [], promotion = null } = {}) {
  const finding = await getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });
  const merged = appendEvidence(
    Array.isArray(finding.evidence_refs) ? finding.evidence_refs : [],
    (Array.isArray(evidence) ? evidence : []).map(makeEvidence),
  );
  await model().update({ evidence_refs: merged }, { where: { id: findingId } });
  await recordEvent(findingId, 'FIX_APPLIED', { taskId: taskId || finding.fix_task_id, attemptId, promotion }, { actor });
  return getFinding(findingId);
}

/**
 * DECLARA FIXED. Exige as TRÊS provas (reprodução verde, testes direcionados verdes e parecer
 * aprovado). "Patch aplicado" NÃO é fix — é exatamente o que esta função recusa.
 */
async function markFixed(findingId, {
  actor = null, reproductionPassed = false, targetedTestsPassed = false, reviewPassed = false,
  reproduction = null, review = null, tenantId = null,
} = {}) {
  const finding = await getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });
  const gate = engine.canDeclareFixed({ finding, reproductionPassed, targetedTestsPassed, reviewPassed });
  if (!gate.allowed) {
    throw Object.assign(new Error(gate.reason), { code: gate.code, detail: { findingId, missing: gate.missing || [] } });
  }
  const patch = { resolved_at: nowIso() };
  if (reproduction) patch.reproduction = reproduction;
  if (review) patch.triage = { ...(finding.triage || {}), fixReview: review };
  const result = await transitionFinding(findingId, 'FIXED', { actor, reason: 'reprodução verde + testes direcionados + parecer aprovado', patch, tenantId });
  if (review?.regressionCommands) {
    await model().update({ regression_test_refs: review.regressionCommands }, { where: { id: findingId } });
  }
  return result;
}

/** Valida a REGRESSÃO. Exige evidência de execuções reais — teste verde isolado não valida nada. */
async function markRegressionValidated(findingId, { actor = null, runs = [], tenantId = null } = {}) {
  const finding = await getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });
  const gate = engine.canDeclareRegressionValidated({ finding, regressionRuns: runs });
  if (!gate.allowed) {
    throw Object.assign(new Error(gate.reason), { code: gate.code, detail: { findingId } });
  }
  const refs = Array.from(new Set([
    ...(Array.isArray(finding.regression_test_refs) ? finding.regression_test_refs : []),
    ...runs.map((r) => r.id || r.command).filter(Boolean),
  ]));
  const result = await transitionFinding(findingId, 'REGRESSION_VALIDATED', {
    actor,
    reason: `${runs.length} execução(ões) de regressão aprovada(s)`,
    patch: { regression_runs: [...(finding.regression_runs || []), ...runs], regression_test_refs: refs },
    tenantId,
  });
  await recordEvent(findingId, 'REGRESSION_VALIDATED', { runs }, { actor });
  return result;
}

/**
 * Fecha o finding. ANTES de fechar, checa as formas de greenwashing conhecidas (fechar sem
 * reprodução, sem evidência, sem regressão executada) — o sistema não pode esconder um bug.
 */
async function closeFinding(findingId, { actor = null, reason = null, tenantId = null } = {}) {
  const finding = await getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });
  const events = await getFindingHistory(findingId);
  const violations = engine.detectGreenwashing({ finding, events });
  if (violations.length > 0) {
    throw Object.assign(new Error(`fechamento recusado: ${violations.map((v) => v.code).join(', ')}`), {
      code: 'FINDING_GREENWASHING_BLOCKED',
      detail: { findingId, violations },
    });
  }
  // SELF-MODIFICATION: fechar exige PROVAR que o próprio critério de julgamento não foi afrouxado.
  // A verificação é a comparação baseline (capturado antes da correção) × estado atual do disco,
  // produzida por bugTriageService.verifySelfModificationBaseline e persistida no finding. Sem
  // verificação, ou com violação, o fechamento é recusado — nunca "fecha e depois vê".
  if (finding.self_modification) {
    const verification = (finding.triage && finding.triage.ruleBaselineVerification) || null;
    if (!verification || verification.checked !== true) {
      throw Object.assign(new Error('fechamento recusado: verificação de baseline de governança ausente para finding de self-modification'), {
        code: engine.BUG_FAILURE_CODES.GOVERNANCE_BASELINE_UNVERIFIED,
        detail: {
          findingId,
          minimumHumanAction: 'executar a verificação de baseline (bugTriageService.verifySelfModificationBaseline) ou aprovar explicitamente a alteração das regras',
        },
      });
    }
    if (verification.ok !== true) {
      throw Object.assign(new Error(`fechamento recusado: ${verification.code || engine.BUG_FAILURE_CODES.GOVERNANCE_BASELINE_VIOLATION}`), {
        code: engine.BUG_FAILURE_CODES.GOVERNANCE_BASELINE_VIOLATION,
        detail: { findingId, diff: verification.diff || null, reason: verification.reason || null },
      });
    }
  }
  return transitionFinding(findingId, 'CLOSED', { actor, reason: reason || 'ciclo concluído', patch: { resolved_at: finding.resolved_at || nowIso() }, tenantId });
}

async function blockFinding(findingId, { actor = null, dependency, evidence = [], minimumHumanAction, tenantId = null } = {}) {
  if (!dependency || !minimumHumanAction) {
    throw Object.assign(new Error('BLOCKED exige `dependency` e `minimumHumanAction`'), { code: 'INVALID_BLOCK' });
  }
  return transitionFinding(findingId, 'BLOCKED', {
    actor,
    reason: `dependência externa: ${dependency}`,
    patch: { blocked: { dependency, evidence, minimumHumanAction, at: nowIso() } },
    tenantId,
  });
}

/**
 * ENGINEERING MEMORY (§ missão: "Consultar bugs anteriores... evitar resolver o mesmo bug do zero").
 *
 * Recupera, pela MESMA identidade (fingerprint), o que já se sabe sobre esta classe de falha:
 * causa raiz anterior, base de confirmação, task de correção e as REGRESSÕES que já a cobriram. Não
 * é uma segunda fonte de verdade: é leitura do histórico que o próprio ciclo persistiu.
 *
 * A memória NUNCA confirma um finding novo (o fingerprint provar que já foi confirmado antes não é
 * base objetiva para a ocorrência ATUAL) — ela acelera a correção, não a confirmação.
 */
async function getFindingMemory(fingerprint, { excludeId = null } = {}) {
  if (!fingerprint) return { known: false, occurrences: 0, priorFindings: [] };
  const rows = await model().findAll({ where: { fingerprint }, order: [['last_seen_at', 'DESC']], limit: 20 });
  const priorFindings = rows.map(toPlain).filter((row) => row.id !== excludeId);
  if (priorFindings.length === 0) return { known: false, occurrences: 0, priorFindings: [] };

  const confirmed = priorFindings.filter((row) => row.confirmation_basis);
  const withFix = priorFindings.filter((row) => row.fix_task_id);
  const regressionCommands = Array.from(new Set(
    priorFindings.flatMap((row) => [
      ...(Array.isArray(row.regression_test_refs) ? row.regression_test_refs : []),
      ...(Array.isArray(row.regression_runs) ? row.regression_runs.flatMap((run) => (Array.isArray(run.commands) ? run.commands : [])) : []),
    ]).filter(Boolean),
  ));

  return {
    known: true,
    occurrences: priorFindings.reduce((acc, row) => acc + (row.occurrences || 1), 0),
    priorFindings: priorFindings.slice(0, 5).map((row) => ({
      id: row.id,
      status: row.status,
      severity: row.severity,
      occurrences: row.occurrences,
      recurrenceCount: row.recurrence_count,
      confirmationBasis: row.confirmation_basis,
      rootCause: row.root_cause,
      fixTaskId: row.fix_task_id,
      resolvedAt: row.resolved_at,
      lastSeenAt: row.last_seen_at,
    })),
    lastKnownRootCause: confirmed.find((row) => row.root_cause)?.root_cause || null,
    lastConfirmationBasis: confirmed[0]?.confirmation_basis || null,
    lastFixTaskId: withFix[0]?.fix_task_id || null,
    priorRegressionCommands: regressionCommands,
  };
}

/** Resumo auditável dos findings (usado pela UI interna e pelo relatório do gate). */async function summarizeFindings({ missionId = null } = {}) {
  const where = missionId ? { mission_id: missionId } : {};
  const rows = await model().findAll({ where, order: [['last_seen_at', 'DESC']], limit: 500 });
  const findings = rows.map(toPlain);
  const byStatus = {};
  const bySeverity = {};
  const byCategory = {};
  for (const f of findings) {
    byStatus[f.status] = (byStatus[f.status] || 0) + 1;
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
  }
  return {
    total: findings.length,
    byStatus,
    bySeverity,
    byCategory,
    openConfirmed: findings.filter((f) => f.status === 'CONFIRMED' || f.status === 'FIXING').length,
    selfModification: findings.filter((f) => f.self_modification).length,
    unresolvedCritical: findings.filter((f) => f.severity === 'CRITICAL' && !['CLOSED', 'DUPLICATE', 'NOT_REPRODUCED'].includes(f.status)).length,
    findings,
  };
}

/* ─────────────────────────────── POSSE DURÁVEL (LEASE/FENCE) ─────────────────────────────── */

const DEFAULT_LEASE_TTL_MS = (() => {
  const raw = Number(process.env.ENGINEERING_BUG_LOOP_LEASE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 120000;
})();

/**
 * Formato do token de posse (uuid gerado por `crypto.randomUUID`). Um token fora deste formato é
 * recusado ANTES de chegar ao banco — o UPDATE parametrizado em coluna `uuid` estoura
 * `invalid input syntax for type uuid`, transformando "posse perdida" (condição normal de corrida)
 * em erro de banco.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Adquire a posse do finding para um worker, por CAS no banco (não no código).
 * Só vence quem encontra: sem lease, lease EXPIRADO (o worker anterior morreu) ou lease próprio.
 * O `lease_fence` é monotônico — é o que permite REJEITAR a escrita de um worker antigo depois do
 * takeover, exatamente como mission/task já fazem.
 */
async function acquireFindingLease(findingId, { workerInstanceId, ttlMs = DEFAULT_LEASE_TTL_MS } = {}) {
  if (!workerInstanceId) throw Object.assign(new Error('lease exige `workerInstanceId`'), { code: 'INVALID_LEASE' });
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const [rows] = await model().sequelize.query(
    `UPDATE engineering_bug_findings
        SET lease_token = :token,
            lease_fence = lease_fence + 1,
            lease_worker_instance_id = :worker,
            lease_acquired_at = :now,
            lease_expires_at = :expiresAt,
            lease_heartbeat_at = :now,
            updated_at = :now
      WHERE id = :id
        AND (lease_token IS NULL OR lease_expires_at < :now OR lease_worker_instance_id = :worker)
      RETURNING id, lease_token, lease_fence, lease_worker_instance_id, lease_expires_at`,
    { replacements: { id: findingId, token, worker: workerInstanceId, now, expiresAt } },
  );
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) {
    const current = await getFinding(findingId).catch(() => null);
    const err = new Error(`finding ${findingId} está sob lease de outro worker`);
    err.code = 'FINDING_LEASE_HELD_BY_OTHER_WORKER';
    err.lease = {
      worker: current?.lease_worker_instance_id || null,
      expiresAt: current?.lease_expires_at || null,
    };
    throw err;
  }
  return { token: row.lease_token, fence: row.lease_fence, workerInstanceId, expiresAt: row.lease_expires_at };
}

/** Renova a posse (heartbeat). Exige o token: quem perdeu o lease não renova. */
async function heartbeatFindingLease(findingId, { token, ttlMs = DEFAULT_LEASE_TTL_MS } = {}) {
  if (!token) throw Object.assign(new Error('heartbeat exige `token`'), { code: 'INVALID_LEASE' });
  // DEFEITO MEDIDO (2026-09-30): um token que não é UUID chegava ao banco e estourava
  // `invalid input syntax for type uuid` — o heartbeat de um worker com token corrompido/forjado
  // falhava com erro de banco em vez de declarar POSSE PERDIDA. Recusar antes de consultar mantém
  // a semântica (`FINDING_LEASE_LOST`) e não transforma uma condição de corrida legítima em 500.
  if (!UUID_PATTERN.test(String(token))) {
    const invalid = new Error(`lease do finding ${findingId} não pertence mais a este worker`);
    invalid.code = 'FINDING_LEASE_LOST';
    invalid.detail = { reason: 'token_invalido' };
    throw invalid;
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const [rows] = await model().sequelize.query(
    `UPDATE engineering_bug_findings
        SET lease_heartbeat_at = :now, lease_expires_at = :expiresAt, updated_at = :now
      WHERE id = :id AND lease_token = :token
      RETURNING lease_fence, lease_expires_at`,
    { replacements: { id: findingId, token, now, expiresAt } },
  );
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) {
    const err = new Error(`lease do finding ${findingId} não pertence mais a este worker`);
    err.code = 'FINDING_LEASE_LOST';
    throw err;
  }
  return { fence: row.lease_fence, expiresAt: row.lease_expires_at };
}

/** Libera a posse (idempotente). Só o dono do token libera. */
async function releaseFindingLease(findingId, { token } = {}) {
  if (!token) return { released: false, reason: 'sem_token' };
  // Mesma razão do heartbeat: token fora do formato vai direto ao banco como uuid. Liberar posse é
  // idempotente, então um token inválido simplesmente não libera nada (nunca um erro de banco).
  if (!UUID_PATTERN.test(String(token))) return { released: false, reason: 'token_invalido', findingId };
  const [rows] = await model().sequelize.query(
    `UPDATE engineering_bug_findings
        SET lease_token = NULL,
            lease_worker_instance_id = NULL,
            lease_expires_at = NULL,
            lease_heartbeat_at = NULL,
            updated_at = NOW()
      WHERE id = :id AND lease_token = :token`,
    { replacements: { id: findingId, token } },
  );
  const affected = Array.isArray(rows) ? rows : rows?.rowCount;
  return { released: Boolean(affected), findingId };
}

module.exports = {
  PLATFORM_TENANT_ID,
  makeEvidence,
  appendEvidence,
  recordEvent,
  registerFinding,
  getFinding,
  getFindingHistory,
  listFindings,
  addEvidence,
  transitionFinding,
  markReproducing,
  confirmFinding,
  markNotReproduced,
  markDuplicate,
  linkFixTask,
  markFixApplied,
  markFixed,
  markRegressionValidated,
  closeFinding,
  blockFinding,
  getFindingMemory,
  summarizeFindings,
  // Posse durável + dedup consultável (worker do laço)
  findNonTerminalFinding,
  acquireFindingLease,
  heartbeatFindingLease,
  releaseFindingLease,
  DEFAULT_LEASE_TTL_MS,
};
