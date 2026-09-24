'use strict';

/**
 * engine/engineeringMission/missionSpec.js — MissionSpec versionada, imutável na intenção
 * original e auditável por hash.
 *
 * Regras estruturais desta camada (§6, §9, §13, §40):
 *   - `originalMission` é IMUTÁVEL. Nenhuma versão posterior pode alterá-lo — nem o próprio
 *     enriquecimento, nem a aprovação, nem execução. `assertOriginalMissionImmutable` é a
 *     autoridade que impede regressão silenciosa de intenção.
 *   - Toda alteração material gera uma NOVA versão (`createNextVersion`), nunca mutação in-place
 *     da versão aprovada.
 *   - Cada versão tem hash canônico próprio (`computeSpecHash`), usado pela aprovação e pela
 *     verificação de que a execução usou exatamente a versão aprovada.
 *
 * Módulo puro (sem I/O, sem banco, sem rede).
 */

const crypto = require('crypto');
const { MISSION_FAILURE_CODES, MISSION_TYPES } = require('./constants');

const IMMUTABLE_FIELDS = Object.freeze(['missionId', 'originalMission', 'repository']);

const ENRICHABLE_FIELDS = Object.freeze([
  'missionType',
  'objective',
  'constraints',
  'acceptanceCriteria',
  'derivedRequirements',
  'testStrategy',
  'assumptions',
  'contextSources',
  'subsystems',
  'risk',
  'confidence',
  'scope',
  'branch',
  'allowedPaths',
  'forbiddenPaths',
  'releaseBlocker',
  'explicitPolicyAuthorization',
  'testCommands',
  'maxIterations',
]);

const RISK_RANK = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 });

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * JSON canônico com chaves ordenadas recursivamente — dois specs semanticamente iguais produzem
 * o MESMO hash, independentemente da ordem de inserção das chaves.
 */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function normalizeList(value) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((v) => (typeof v === 'string' ? v.trim() : v)).filter((v) => v !== '' && v !== null && v !== undefined);
}

function normalizeRequirements(items) {
  return normalizeList(items).map((item) => {
    if (typeof item === 'string') return { id: null, text: item, source: null, enrichmentType: null, confidence: null, riskImpact: null };
    return {
      id: item.id || null,
      text: item.text,
      source: item.source || null,
      enrichmentType: item.enrichmentType || null,
      confidence: item.confidence === undefined ? null : item.confidence,
      riskImpact: item.riskImpact || null,
    };
  });
}

function buildSpecShape(input) {
  return {
    missionId: input.missionId,
    version: input.version,
    originalMission: input.originalMission,
    missionType: input.missionType || null,
    objective: input.objective || null,
    repository: input.repository || null,
    branch: input.branch || null,
    scope: input.scope || null,
    constraints: normalizeList(input.constraints),
    acceptanceCriteria: normalizeRequirements(input.acceptanceCriteria),
    derivedRequirements: normalizeRequirements(input.derivedRequirements),
    testStrategy: normalizeList(input.testStrategy),
    assumptions: normalizeList(input.assumptions),
    contextSources: normalizeList(input.contextSources),
    subsystems: normalizeList(input.subsystems),
    allowedPaths: normalizeList(input.allowedPaths),
    forbiddenPaths: normalizeList(input.forbiddenPaths),
    // Contrato de execução propagado à EngineeringTask. `explicitPolicyAuthorization` nasce
    // SEMPRE false (fail-closed do Router para allowedPaths vazio): autorizá-lo é decisão
    // deliberada e, por política, exige aprovação humana — nunca autoaprovação.
    releaseBlocker: input.releaseBlocker === true,
    explicitPolicyAuthorization: input.explicitPolicyAuthorization === true,
    testCommands: normalizeList(input.testCommands),
    maxIterations: Number.isInteger(input.maxIterations) ? input.maxIterations : null,
    risk: input.risk || null,
    confidence: typeof input.confidence === 'number' ? input.confidence : null,
    enrichmentPolicyVersion: input.enrichmentPolicyVersion || null,
  };
}

/**
 * Cria a versão 1 (ou uma versão arbitrária, para reconciliação/import) de uma MissionSpec.
 * Congelada profundamente: mutação posterior é erro de programação, não um caminho suportado.
 */
function createSpec(input) {
  if (!input || typeof input !== 'object') throw fail(MISSION_FAILURE_CODES.ENRICHMENT_FAILED, 'MissionSpec: input ausente');
  if (!input.missionId) throw fail(MISSION_FAILURE_CODES.ENRICHMENT_FAILED, 'MissionSpec: missionId é obrigatório');
  if (!input.originalMission || !String(input.originalMission).trim()) {
    throw fail(MISSION_FAILURE_CODES.ORIGINAL_MISSION_MUTATED, 'MissionSpec: originalMission é obrigatório e não pode ser vazio');
  }
  if (input.missionType && !MISSION_TYPES.includes(input.missionType)) {
    throw fail(MISSION_FAILURE_CODES.ENRICHMENT_FAILED, `MissionSpec: missionType inválido "${input.missionType}"`);
  }
  if (input.risk && !Object.prototype.hasOwnProperty.call(RISK_RANK, input.risk)) {
    throw fail(MISSION_FAILURE_CODES.ENRICHMENT_FAILED, `MissionSpec: risk inválido "${input.risk}"`);
  }
  const shape = buildSpecShape({ version: 1, ...input });
  const spec = Object.freeze({ ...shape, specHash: sha256(canonicalize(shape)) });
  return spec;
}

function computeSpecHash(spec) {
  const { specHash, ...rest } = spec || {};
  return sha256(canonicalize(rest));
}

/**
 * A intenção original nunca muda. Chamado em TODA transição de versão antes de persistir.
 */
function assertOriginalMissionImmutable(previousSpec, nextSpec) {
  if (!previousSpec) return true;
  if (previousSpec.originalMission !== nextSpec.originalMission) {
    throw fail(
      MISSION_FAILURE_CODES.ORIGINAL_MISSION_MUTATED,
      'originalMission é imutável: o enriquecimento deve ficar em campos derivados, nunca reescrever a intenção do usuário',
    );
  }
  if (previousSpec.missionId !== nextSpec.missionId) {
    throw fail(MISSION_FAILURE_CODES.ORIGINAL_MISSION_MUTATED, 'missionId não pode mudar entre versões');
  }
  return true;
}

/**
 * Diff campo a campo entre duas versões. Nunca classifica materialidade (isso é
 * `materiality.js`); apenas reporta o que mudou, com o valor anterior e o novo.
 */
function diffSpecs(previousSpec, nextSpec) {
  const changes = [];
  if (!previousSpec) {
    for (const field of ENRICHABLE_FIELDS) {
      const value = nextSpec?.[field];
      if (value === null || value === undefined) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      changes.push({ field, previousValue: null, nextValue: value });
    }
    return changes;
  }
  for (const field of ENRICHABLE_FIELDS) {
    const before = previousSpec[field] ?? (Array.isArray(previousSpec[field]) ? [] : null);
    const after = nextSpec[field] ?? (Array.isArray(nextSpec[field]) ? [] : null);
    if (canonicalize(before) !== canonicalize(after)) {
      changes.push({ field, previousValue: before, nextValue: after });
    }
  }
  if ((nextSpec.originalMission ?? null) !== (previousSpec.originalMission ?? null)) {
    changes.push({ field: 'originalMission', previousValue: previousSpec.originalMission, nextValue: nextSpec.originalMission, forbidden: true });
  }
  return changes;
}

/**
 * Cria a próxima versão a partir de um patch de enriquecimento.
 *
 * `originalMission` NÃO pode ser alterado por enriquecimento — e uma tentativa explícita de
 * alterá-lo FALHA ALTO, nunca é ignorada em silêncio (silêncio aqui significaria que o chamador
 * acredita ter mudado a intenção do usuário quando nada mudou, ou pior, que a plataforma aceita
 * reescrever a intenção original).
 */
function createNextVersion(previousSpec, patch) {
  if (!previousSpec) throw fail(MISSION_FAILURE_CODES.ENRICHMENT_FAILED, 'createNextVersion: versão anterior ausente');
  const patchObj = patch || {};
  if (patchObj.originalMission !== undefined && patchObj.originalMission !== previousSpec.originalMission) {
    throw fail(
      MISSION_FAILURE_CODES.ORIGINAL_MISSION_MUTATED,
      'originalMission é imutável: enriquecimento não pode reescrever a intenção do usuário (use campos derivados)',
    );
  }
  if (patchObj.missionId !== undefined && patchObj.missionId !== previousSpec.missionId) {
    throw fail(MISSION_FAILURE_CODES.ORIGINAL_MISSION_MUTATED, 'missionId não pode mudar entre versões');
  }
  const candidate = buildSpecShape({
    ...previousSpec,
    ...patchObj,
    missionId: previousSpec.missionId,
    originalMission: previousSpec.originalMission,
    version: Number(previousSpec.version) + 1,
  });
  assertOriginalMissionImmutable(previousSpec, candidate);
  return Object.freeze({ ...candidate, specHash: sha256(canonicalize(candidate)) });
}

/**
 * Verificação usada ANTES de iniciar/continuar execução: só a versão aprovada pode executar.
 * Nenhuma versão "mais nova" pode executar sem aprovação própria (§13, §40 TEST 40).
 */
function assertExecutableVersion({ mission, approval, currentSpec }) {
  if (!approval || !approval.specVersion) {
    throw fail(MISSION_FAILURE_CODES.MISSION_APPROVAL_NOT_FOUND, 'nenhuma aprovação registrada para esta mission');
  }
  if (approval.state !== 'APPROVED' && approval.state !== 'AUTO_APPROVED') {
    throw fail(MISSION_FAILURE_CODES.MISSION_SPEC_NOT_APPROVED, `aprovação em estado "${approval.state}" não autoriza execução`);
  }
  if (approval.missionId !== mission.id) {
    throw fail(MISSION_FAILURE_CODES.MISSION_APPROVAL_NOT_FOUND, 'aprovação pertence a outra mission');
  }
  if (approval.specVersion !== currentSpec.version) {
    throw fail(
      MISSION_FAILURE_CODES.MISSION_STALE_VERSION,
      `execução bloqueada: versão corrente é v${currentSpec.version} mas a versão aprovada é v${approval.specVersion}`,
    );
  }
  if (approval.specHash !== currentSpec.specHash) {
    throw fail(
      MISSION_FAILURE_CODES.MISSION_STALE_VERSION,
      'execução bloqueada: hash da versão corrente diverge do hash aprovado (MissionSpec alterada após aprovação)',
    );
  }
  return true;
}

module.exports = {
  IMMUTABLE_FIELDS,
  ENRICHABLE_FIELDS,
  RISK_RANK,
  canonicalize,
  sha256,
  createSpec,
  computeSpecHash,
  assertOriginalMissionImmutable,
  diffSpecs,
  createNextVersion,
  assertExecutableVersion,
  normalizeRequirements,
};
