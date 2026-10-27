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
const { parseCommand } = require('../../../engine/engineeringRouter/commandPolicy');
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

/**
 * PROVENIÊNCIA REVERSA: dada uma task, qual finding ela existe para corrigir.
 *
 * O vínculo vive em `fix_task_id`, gravado por `linkFixTask` no momento da triagem. Sem esta
 * consulta o runtime de integração não tinha como saber que um candidate era um BUG FIX — e a
 * proveniência finding → task → candidate → integração ficava implícita e irrecuperável.
 */
async function findByFixTaskId(taskId) {
  if (!taskId) return null;
  const row = await model().findOne({ where: { fix_task_id: taskId } });
  return row ? toPlain(row) : null;
}

async function getFindingHistory(findingId) {
  const Event = eventModel();
  const rows = await Event.findAll({ where: { finding_id: findingId }, order: [['created_at', 'ASC']] });
  return rows.map(toPlain);
}

async function listFindings({
  missionId = null, status = null, severity = null, category = null,
  selfModification = null, fingerprint = null, ids = null, limit = 50, offset = 0,
} = {}) {
  const where = {};
  if (missionId) where.mission_id = missionId;
  if (status) where.status = Array.isArray(status) ? { [Op.in]: status } : status;
  if (severity) where.severity = Array.isArray(severity) ? { [Op.in]: severity } : severity;
  if (category) where.category = category;
  if (selfModification !== null) where.self_modification = Boolean(selfModification);
  if (fingerprint) where.fingerprint = fingerprint;
  if (Array.isArray(ids) && ids.length > 0) where.id = { [Op.in]: ids };
  // ESCOPO EXPLÍCITO NÃO É TRUNCADO: com `ids` o chamador já delimitou o conjunto, e cortar em
  // `limit` (default 50, teto 200) faria "escopo explícito" virar "escopo parcial silencioso".
  const escopoExplicito = Array.isArray(ids) && ids.length > 0;
  const limite = escopoExplicito ? ids.length : Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = await model().findAll({
    where,
    order: [['last_seen_at', 'DESC']],
    limit: limite,
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
async function transitionFinding(findingId, toStatus, { actor = null, reason = null, patch = {}, tenantId = null, lease = null } = {}) {
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
  // ── FENCING DO LEASE (defeito medido em 2026-10-26) ───────────────────────────────────────────
  // `lease_fence` era incrementado na aquisição e NUNCA validado por nenhuma escrita: um worker cujo
  // lease expirou e foi tomado por outro continuava gravando — "perdeu a posse, mas escreve". Quando
  // a escrita DECLARA posse, o fence corrente entra no MESMO `UPDATE` (predicado atômico, sem TOCTOU
  // entre checar e gravar): fence velho ⇒ 0 linhas ⇒ `FINDING_LEASE_LOST` nomeado.
  const fenceEsperado = lease && lease.fence !== undefined && lease.fence !== null ? Number(lease.fence) : null;
  const where = { id: findingId, version: expectedVersion };
  if (fenceEsperado !== null) where.lease_fence = fenceEsperado;

  const [affected] = await model().update(
    { status: toStatus, ...patch, version: expectedVersion + 1 },
    { where },
  );

  if (!affected) {
    const current = await getFinding(findingId);
    if (fenceEsperado !== null && current && Number(current.lease_fence) !== fenceEsperado) {
      const perdido = new Error(`posse perdida: o lease do finding ${findingId} avançou (fence ${fenceEsperado} ≠ ${current.lease_fence}) — escrita recusada`);
      perdido.code = 'FINDING_LEASE_LOST';
      perdido.detail = { findingId, fenceEsperado, fenceAtual: current.lease_fence ?? null, toStatus };
      logger.warn('[bugFindingService] escrita recusada: fence do lease não é mais o corrente', perdido.detail);
      throw perdido;
    }
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

async function markReproducing(findingId, { actor = null, plan = null, reproduction = null, lease = null } = {}) {
  // `reproduction` vem pronto quando o chamador já sabe mesclar a PROVENIÊNCIA (o plano derivado não
  // pode apagar `strategy`/`source` declarados pelo finding). Sem ele, o plano é gravado como antes.
  const patch = reproduction ? { reproduction } : (plan ? { reproduction: plan } : {});
  return transitionFinding(findingId, 'REPRODUCING', { actor, reason: 'tentativa de reprodução iniciada', patch, lease });
}

/**
 * CONFIRMA com BASE OBJETIVA + evidência. Sem base objetiva (suspeita de LLM, heurística, timout
 * isolado) recusa com `INSUFFICIENT_CONFIRMATION_BASIS` — nunca "confirma por narrativa".
 */
async function confirmFinding(findingId, { basis, evidence = [], actor = null, rootCause = null, reproduction = null, tenantId = null, lease = null, workerInstanceId = null } = {}) {
  // A CONFIRMAÇÃO inteira (SUSPECTED→REPRODUCING→CONFIRMED) roda sob o lease: sem isso a varredura
  // de outro processo pode devolver o finding para SUSPECTED entre as duas transições (defeito
  // medido em 2026-10-25). `lease` de quem já é dono evita reentrância e bump de fence.
  const dono = await withFindingLeaseOwned(findingId, { lease, workerInstanceId }, async ({ lease: meuLease }) => {
    const atual = await getFinding(findingId);
    if (!atual) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });
    return confirmarComLease(atual, meuLease);
  });
  if (dono && dono.skipped) return { skipped: true, outcome: 'SKIPPED_LEASE_HELD', lease: dono.lease, finding: null };
  return dono;

  async function confirmarComLease(finding, _lease) {
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

  if (finding.status === 'SUSPECTED') await transitionFinding(findingId, 'REPRODUCING', { actor, reason: 'confirmação com base objetiva', lease: _lease });
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
    lease: _lease,
  });
  return { finding: result.finding, basis, idempotent: result.idempotent === true };
  }
}

async function markNotReproduced(findingId, { actor = null, reason = null, evidence = [], plan = null, reproduction = null, lease = null } = {}) {
  const patch = { ...(reproduction ? { reproduction } : (plan ? { reproduction: plan } : {})) };
  return transitionFinding(findingId, 'NOT_REPRODUCED', { actor, reason: reason || 'reprodução executada sem manifestar a falha', patch, lease });
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

/**
 * REGISTRA que um CICLO de correção terminou sem GREEN, incrementando `fix_attempts`.
 *
 * DEFEITO REAL QUE ISTO ELIMINA (medido em 2026-10-20 no lote autoritativo):
 * `runFixLoop` executava as tentativas do Router e, ao terminar em `RED`/`READY_FOR_PROMOTION`,
 * apenas gravava um evento e retornava. NADA era contado de forma persistida — `fix_attempts` só
 * era incrementado em `linkFixTask`, uma única vez. Resultado: o worker global reexecutava o ciclo
 * de correção dos MESMOS findings em todo tick (302 ciclos em 900 s, `fixed=0`), consumindo o
 * runner compartilhado; a reprodução do finding NOVO da suíte falhava por concorrência
 * (INCONCLUSIVE) e a missão nunca era retomada. O laço parecia vivo e não produzia progresso.
 *
 * O contador é a base da guarda de NÃO-CONVERGÊNCIA do coordenador: sem número persistido não há
 * como distinguir "ainda vai convergir" de "vai repetir para sempre".
 */
async function recordFixNotGreen(findingId, {
  actor = null, taskStatus = null, attempts = [], reasonCode = null,
} = {}) {
  const finding = await getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });
  await model().increment({ fix_attempts: 1 }, { where: { id: findingId } });
  await recordEvent(findingId, 'COMMENT', {
    kind: 'FIX_NOT_GREEN', taskStatus, attempts, reasonCode,
  }, { actor });
  const refreshed = await getFinding(findingId);
  return { finding: refreshed, fixAttempts: (refreshed && refreshed.fix_attempts) || 0 };
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
 * REGISTRA que o fix está pronto mas BLOQUEADO por aprovação de governança — SEM mudar o status.
 *
 * DEFEITO QUE ISTO ELIMINA (2026-10-03): o coordenador chamava `markFixed` ANTES de verificar o
 * baseline de governança. O finding virava `FIXED` ("corrigido") enquanto ainda aguardava aval
 * humano — um estado que MENTE: `FIXED` afirma que o ciclo de correção terminou, e o fechamento
 * então era recusado por governança. Pior: `runBugLoopSweep` só seleciona CONFIRMED/FIXING, então o
 * finding FIXED ficava ÓRFÃO — a aprovação humana acontecia e nada nunca retomava o trabalho.
 *
 * A correção mantém o finding em `FIXING` (o trabalho de código está feito, o ciclo não terminou) e
 * persiste um motivo de bloqueio auditável. Com isso o worker assíncrono volta a selecioná-lo
 * sozinho e, após o aval, continua do CHECKPOINT (patch/testes/review já registrados em evidência)
 * — sem reexecutar o coder.
 */
async function markPendingGovernanceApproval(findingId, {
  actor = null, code = 'GOVERNANCE_APPROVAL_REQUIRED', reason = null, evidence = [], verification = null,
} = {}) {
  const finding = await getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });

  const blocked = {
    code,
    blockingReason: code,
    dependency: 'GOVERNANCE_APPROVAL',
    reason: reason || 'alteração das próprias regras de julgamento aguarda aval humano explícito',
    evidence: (Array.isArray(evidence) ? evidence : []).filter(Boolean).map(makeEvidence),
    verification: verification || null,
    // CHECKPOINT declarado: é o que permite continuar SEM reexecutar coder quando o aval chegar.
    checkpoint: {
      status: finding.status,
      fixTaskId: finding.fix_task_id || null,
      fixApplied: true,
      awaiting: 'GOVERNANCE_APPROVAL',
      at: nowIso(),
    },
    minimumHumanAction: 'aprovar explicitamente a alteração das regras de julgamento (POST /engineering/findings/:id/approve-self-modification com principal HUMANO, permissão engineering:approve_self_modification, governanceChangeApproved=true, reason e reviewer independente quando a política exigir)',
    at: nowIso(),
  };

  await model().update({ blocked }, { where: { id: findingId } });
  await recordEvent(findingId, 'COMMENT', { kind: 'PENDING_GOVERNANCE_APPROVAL', ...blocked }, { actor });
  logger.warn('[bugFindingService] fix pronto aguardando aval de governança (finding permanece FIXING, não FIXED)', {
    findingId, status: finding.status, code,
  });
  return getFinding(findingId);
}

/** Limpa o bloqueio de governança quando o aval é concedido (não deixa motivo de bloqueio obsoleto). */
async function clearGovernanceBlock(findingId, { actor = null } = {}) {
  const finding = await getFinding(findingId);
  if (!finding) return null;
  const blocked = finding.blocked || null;
  if (!blocked || blocked.blockingReason !== 'GOVERNANCE_APPROVAL_REQUIRED') return finding;
  await model().update({ blocked: null }, { where: { id: findingId } });
  await recordEvent(findingId, 'COMMENT', { kind: 'GOVERNANCE_APPROVAL_GRANTED', clearedBlock: blocked.code || null }, { actor });
  return getFinding(findingId);
}

/**
 * DECLARA FIXED. Exige as TRÊS provas (reprodução verde, testes direcionados verdes e parecer
 * aprovado). "Patch aplicado" NÃO é fix — é exatamente o que esta função recusa.
 */async function markFixed(findingId, {
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
  // ENGINEERING MEMORY — PREVENÇÃO DE REINCIDÊNCIA (2026-10-08). Um finding de SELF_MODIFICATION
  // (onde a ausência de prevenção permite afrouxar o próprio critério de julgamento) ou que já
  // REINCIDIU (prova de que a prevenção anterior falhou) não pode ser fechado sem um problema
  // conhecido COMPLETO — causa raiz, componentes, evidências, correção, REGRA PREVENTIVA, teste de
  // não regressão executável, versão de introdução/correção, estado de verificação e proveniência —
  // e sem que essa regra esteja ACTIVE, ou seja, verificada por execução. Antes, a memory de
  // engenharia era puramente aditiva: nada obrigava a registrar o que impede a volta da falha.
  const prevention = engine.assertPreventionBeforeClose({
    record: (finding.triage && finding.triage.knownProblem) || null,
    selfModification: finding.self_modification === true,
    recurrenceCount: finding.recurrence_count || 0,
  });
  if (prevention.required && !prevention.allowed) {
    throw Object.assign(new Error(prevention.reason), {
      code: prevention.code,
      detail: {
        findingId,
        missing: prevention.missing || null,
        minimumHumanAction:
          'registrar o problema conhecido (buildKnownProblem) e ativá-lo após REGRESSION_VALIDATED '
          + '(engine.activate) — ou aprovar explicitamente a dispensa da regra preventiva',
      },
    });
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
  // SEGUNDA BARREIRA (a primeira é na ESCRITA, em `bugLoopCoordinatorService`).
  //
  // Esta memória é PERSISTENTE: um registro ruim gravado ontem volta hoje. Como ela é injetada em
  // `test_commands` do contrato de correção, um valor que não é comando (medido: um UUID gravado em
  // 2026-09-30) faz `parseCommand` rejeitar ⇒ `TEST_BLOCKED` ⇒ task RED ⇒ o laço nunca fecha, com o
  // sintoma longe da causa.
  //
  // A barreira na escrita já impede a entrada de novos valores ruins; esta garante que o HISTÓRICO
  // ruim não continue se propagando enquanto não é limpo. Descarte aqui é silencioso de propósito:
  // o registro antigo não é um produtor ativo, é dado legado — quem precisa gritar é a escrita.
  const isExecutableCommand = (value) => {
    const candidate = String(value || '').trim();
    if (candidate === '') return false;
    try {
      return parseCommand(candidate).allowed === true;
    } catch (_) {
      return false;
    }
  };
  const regressionCommands = Array.from(new Set(
    priorFindings.flatMap((row) => [
      ...(Array.isArray(row.regression_test_refs) ? row.regression_test_refs : []),
      ...(Array.isArray(row.regression_runs) ? row.regression_runs.flatMap((run) => (Array.isArray(run.commands) ? run.commands : [])) : []),
    ]).filter(Boolean).filter(isExecutableCommand),
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
/**
 * LEASE DO FINDING — DEFINIÇÃO ÚNICA do ciclo de vida (aquisição, heartbeat, liberação).
 *
 * DEFEITO MEDIDO (checkout limpo de 2026-10-25): `reproduce()` e `confirmFinding()` NÃO tomavam o
 * lease; só a varredura (`runBugLoopSweep`) tomava. A varredura de outro processo pegava o mesmo
 * finding em REPRODUCING, rodava a própria tentativa, recebia INCONCLUSIVE e o devolvia a SUSPECTED
 * no meio da tentativa em curso — que então falhava no CAS (`transição concorrente rejeitada …
 * SUSPECTED (tentativa REPRODUCING → CONFIRMED)`). Passava isolado, falhava sob carga.
 *
 * Regra: quem MUTA o ciclo de reprodução/confirmação é dono do lease. Lease de outro worker ⇒ a
 * operação é RECUSADA explicitamente (`SKIPPED_LEASE_HELD`), nunca executada em paralelo.
 *
 * @param {string} findingId
 * @param {{ workerInstanceId?:string, lease?:object|null, ttlMs?:number }} opcoes
 * @param {(ctx:{lease:object|null, owned:boolean}) => Promise<any>} fn
 */
async function withFindingLeaseOwned(findingId, opcoes, fn) {
  const { workerInstanceId = null, lease = null, ttlMs = null } = opcoes || {};
  if (lease && lease.token) {
    // O lease herdado tem de ser DESTE finding: aceitar qualquer `{ token }` deixaria a operação
    // rodar sem posse nenhuma (o token de outro finding nunca é validado pela escrita dos findings).
    if (lease.findingId && lease.findingId !== findingId) {
      const mismatch = new Error(`lease de ${lease.findingId} não pode ser usado no finding ${findingId}`);
      mismatch.code = 'FINDING_LEASE_MISMATCH';
      mismatch.detail = { findingId, leaseFindingId: lease.findingId };
      throw mismatch;
    }
    return fn({ lease, owned: false });
  }

  // Identidade POR OPERAÇÃO quando o chamador não declara uma. `pid:<pid>` faria duas operações
  // concorrentes do MESMO processo se enxergarem como o mesmo dono (a aquisição aceita reentrada do
  // mesmo worker) e o lease não excluiria nada. Reentrada legítima (reproduce → confirmFinding)
  // passa o `lease` adiante explicitamente, que é o caminho que precisa ser reentrante.
  const worker = workerInstanceId || `${process.pid}:${crypto.randomUUID()}`;
  let adquirido;
  try {
    adquirido = await acquireFindingLease(findingId, { workerInstanceId: worker, ...(ttlMs ? { ttlMs } : {}) });
  } catch (err) {
    if (err.code === 'FINDING_LEASE_HELD_BY_OTHER_WORKER') {
      return { skipped: true, code: err.code, lease: err.lease };
    }
    throw err;
  }
  const ttl = ttlMs || DEFAULT_LEASE_TTL_MS;
  const heartbeat = setInterval(() => {
    heartbeatFindingLease(findingId, { token: adquirido.token, ttlMs: ttl }).catch((err) => {
      logger.warn('[bugFindingService] heartbeat do lease do finding falhou', { findingId, code: err.code || null });
    });
  }, Math.max(5000, Math.floor(ttl / 3)));
  if (typeof heartbeat.unref === 'function') heartbeat.unref();
  try {
    return await fn({ lease: adquirido, owned: true });
  } finally {
    clearInterval(heartbeat);
    await releaseFindingLease(findingId, { token: adquirido.token }).catch(() => {});
  }
}

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
    // Finding INEXISTENTE não é disputa de posse: o UPDATE casa 0 linhas nos dois casos, e rotular
    // ausência como `FINDING_LEASE_HELD_BY_OTHER_WORKER` transformava 404 em 409/200 com
    // `lease.worker: null` (medido em revisão adversarial de 2026-10-25).
    if (!current) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found', detail: { findingId } });
    const err = new Error(`finding ${findingId} está sob lease de outro worker`);
    err.code = 'FINDING_LEASE_HELD_BY_OTHER_WORKER';
    err.lease = {
      worker: current.lease_worker_instance_id || null,
      expiresAt: current.lease_expires_at || null,
    };
    throw err;
  }
  return { token: row.lease_token, fence: row.lease_fence, workerInstanceId, findingId, expiresAt: row.lease_expires_at };
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

/**
 * ENGINEERING MEMORY — persiste o PROBLEMA CONHECIDO no finding (`triage.knownProblem`).
 *
 * Escritor DEDICADO (não `transitionFinding`): aquele só aplica `patch` quando HÁ mudança de
 * estado — para o mesmo estado ele retorna cedo como idempotente e DESCARTA o patch. Registrar a
 * prevenção é ortogonal à transição (o finding já está em REGRESSION_VALIDATED quando a regra é
 * ativada), então precisa de escrita própria, com a MESMA proteção de versão (CAS) das demais.
 */
async function recordKnownProblem(findingId, knownProblem, { tenantId = null } = {}) {
  const finding = await getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });
  if (!knownProblem || typeof knownProblem !== 'object' || !knownProblem.knownProblemId) {
    const err = new Error('problema conhecido inválido: registro ausente ou sem knownProblemId');
    err.code = engine.PREVENTIVE_RULE_FAILURE_CODES.KNOWN_PROBLEM_INCOMPLETE;
    throw err;
  }
  const expectedVersion = Number(finding.version || 0);
  const triage = { ...(finding.triage || {}), knownProblem };
  const [affected] = await model().update(
    { triage, version: expectedVersion + 1 },
    { where: { id: findingId, version: expectedVersion } },
  );
  if (!affected) {
    const err = new Error(`conflito ao registrar o problema conhecido do finding ${findingId}`);
    err.code = 'FINDING_STATE_CONFLICT';
    err.detail = { findingId, expectedVersion };
    throw err;
  }
  void tenantId;
  return getFinding(findingId);
}

/**
 * ENGINEERING MEMORY — REGRAS PREVENTIVAS ATIVAS.
 *
 * § missão: "O Roteador Engenheiro deve consultar problemas conhecidos antes de implementar
 * correções". `activeRules()` existia no motor desde 2026-10-08 mas **não tinha chamador de
 * produção**: a regra era gravada como ACTIVE e nunca lida, o que na prática a tornava decorativa
 * (a "prevenção" só aparecia no fechamento). Aqui a regra é lida do MESMO registro que o ciclo
 * grava (`engineering_bug_findings.triage.knownProblem`) e entregue como contexto ANTES do
 * planejamento da correção.
 *
 * Somente `state === 'ACTIVE'` conta — PROPOSED não é obrigação (a ativação exige teste
 * preventivo EXECUTADO com procedência e causa raiz demonstrável; ver `preventiveRules`).
 */
async function getActivePreventiveRules({ category = null, limit = 50 } = {}) {
  const where = { status: ['REGRESSION_VALIDATED', 'CLOSED'] };
  if (category) where.category = String(category);
  const bounded = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = await model().findAll({ where, order: [['last_seen_at', 'DESC']], limit: bounded });
  return rows
    .map(toPlain)
    .map((row) => (row.triage && row.triage.knownProblem ? row.triage.knownProblem : null))
    .filter((rule) => rule && rule.state === 'ACTIVE')
    .map((rule) => ({
      knownProblemId: rule.knownProblemId || null,
      rootCause: rule.rootCause || null,
      preventiveRule: rule.preventiveRule || null,
      regressionTest: rule.regressionTest || null,
      fixedIn: rule.fixedIn || null,
      activatedAt: rule.activatedAt || null,
    }));
}

/**
 * EXPORTAÇÃO DO PROBLEMA CONHECIDO a partir do estado REAL do finding.
 *
 * Só o que o finding comprova entra no registro — nada é inventado. `preventiveRule` é a única
 * parte derivada por texto: a memória de engenharia exige a REGRA, não apenas a causa, e o laço de
 * bugs não recebe uma do modelo. Ela nomeia a classe de falha e o alvo do teste de não regressão.
 */
function buildKnownProblemFromFinding(finding, { actor = null, regressionRuns = [] } = {}) {
  const regressionCommands = Array.isArray(finding.regression_test_refs) ? finding.regression_test_refs : [];
  const affected = [
    ...(Array.isArray(finding.affected_files) ? finding.affected_files : []),
    ...(Array.isArray(finding.affected_subsystems) ? finding.affected_subsystems : []),
  ];
  // Fallbacks SEM invenção: quando o finding não registra arquivos/subsistemas, a ÁREA afetada é a
  // própria origem classificada do finding (`source`, ex.: MISSION_FAILURE/TELEMETRY), que é um
  // dado real da linha. Quando não há comando de regressão persistido, usa-se o comando de
  // REPRODUÇÃO (que foi executado de verdade) — nunca um comando fabricado.
  const affectedComponents = affected.length > 0 ? affected : [String(finding.source || 'unclassified')];
  const regressionCommand = regressionCommands.length > 0
    ? regressionCommands[0]
    : ((finding.reproduction && finding.reproduction.command) || null);

  // EXECUÇÃO DO TESTE PREVENTIVO (endurecido 2026-10-10).
  //
  // Antes, o registro só carregava o COMANDO — e o módulo de regras considerava
  // "teste executável" a mera existência de uma string. Uma regra preventiva podia
  // então virar OBRIGATÓRIA citando um teste que nunca rodou. Aqui a execução vem
  // do run de regressão REAL que passou nesta tentativa (`engineering_regression_runs`),
  // com a procedência (`source_fingerprint`) que liga a execução à árvore corrigida.
  const passingRun = (Array.isArray(regressionRuns) ? regressionRuns : [])
    .find((run) => run && (run.passed === true || String(run.result || run.status || '').toUpperCase() === 'PASS')) || null;
  const execution = passingRun
    ? {
      status: 'PASS',
      // Exit code REAL do run (todos os comandos do plano precisam ser zero para ser PASS).
      exitCode: Array.isArray(passingRun.exitCodes) && passingRun.exitCodes.length > 0
        ? (passingRun.exitCodes.every((code) => Number(code) === 0) ? 0 : 1)
        : 0,
      executedAt: passingRun.completed_at || passingRun.completedAt || null,
      sourceFingerprint: passingRun.source_fingerprint || passingRun.sourceFingerprint || null,
      attemptId: passingRun.attempt_id || null,
      commands: Array.isArray(passingRun.commands) ? passingRun.commands : [],
    }
    : null;

  // CAUSA RAIZ: declarada vence; sem declaração, deriva da evidência REAL desta ocorrência.
  // Sem isto o problema conhecido nascia INCOMPLETO (`KNOWN_PROBLEM_INCOMPLETE: rootCause`) e o
  // fechamento de todo finding de SELF_MODIFICATION era recusado — medido em 2026-10-10 no
  // `governanceApprovalFullWorkerE2E`, com a task já GREEN. A origem fica registrada na
  // proveniência para que auditoria distinga causa DECLARADA de causa DERIVADA (e de AUSENTE, caso
  // em que o registro continua recusado de propósito).
  const declaredRootCause = typeof finding.root_cause === 'string' && finding.root_cause.trim() !== '';
  const rootCause = engine.deriveRootCauseStatement(finding);

  return engine.buildKnownProblem({
    fingerprint: String(finding.fingerprint || ''),
    fingerprintVersion: String(engine.FINGERPRINT_VERSION || ''),
    rootCauseClass: String(finding.category || finding.classification || ''),
    rootCause,
    affectedComponents,
    occurrenceEvidence: Array.isArray(finding.evidence_refs) ? finding.evidence_refs : [],
    fix: finding.fix_task_id ? `fix task ${finding.fix_task_id} (status=${finding.status})` : null,
    preventiveRule: `impedir reincidência de ${finding.category || 'falha'} em ${affectedComponents[0]}: `
      + `manter a correção de "${String(finding.title || finding.id).slice(0, 120)}" sob teste de não regressão`,
    regressionTest: regressionCommand ? { command: regressionCommand, execution } : null,
    introducedIn: finding.first_seen_at ? String(finding.first_seen_at) : null,
    fixedIn: finding.resolved_at ? String(finding.resolved_at) : null,
    verificationState: 'VERIFIED',
    provenance: {
      source: 'bugLoopCoordinatorService.runFixLoop',
      findingId: finding.id,
      actor,
      rootCauseSource: declaredRootCause ? 'DECLARED' : (rootCause ? 'DERIVED_FROM_OCCURRENCE' : 'ABSENT'),
    },
  });
}

module.exports = {
  PLATFORM_TENANT_ID,
  makeEvidence,
  appendEvidence,
  recordEvent,
  registerFinding,
  getFinding,
  findByFixTaskId,
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
  recordFixNotGreen,
  markPendingGovernanceApproval,
  clearGovernanceBlock,
  markFixed,
  markRegressionValidated,
  recordKnownProblem,
  buildKnownProblemFromFinding,
  closeFinding,
  blockFinding,
  getFindingMemory,
  getActivePreventiveRules,
  summarizeFindings,
  // Posse durável + dedup consultável (worker do laço)
  findNonTerminalFinding,
  withFindingLeaseOwned,
  acquireFindingLease,
  heartbeatFindingLease,
  releaseFindingLease,
  DEFAULT_LEASE_TTL_MS,
};
