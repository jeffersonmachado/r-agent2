'use strict';

/**
 * archetypeDiscovery — descoberta e REVALIDAÇÃO de arquétipos de mercado com
 * evidência.
 *
 * Regra fundamental: os arquétipos históricos do config da vertical (ex.:
 * `config/benchmarks/fitness.json`) são INPUT DE REFERÊNCIA, não verdade. Um
 * arquétipo só é ACCEPTED quando carrega `sourceEvidence` real — itens com
 * `url` + (`evidenceRef` ou `contentHash`) obtidos por capabilities de
 * pesquisa governadas. Sem evidência o estado é EVIDENCE_REQUIRED; com
 * evidência que CONTRADIZ o arquétipo, REJECTED. Nada aqui remove arquétipo
 * para forçar PASS: rejeição é um FATO auditável, não uma limpeza.
 *
 * Este módulo é PURO (zero I/O): quem obtém a evidência é o supervisor, via
 * `research.*` do Canonical Tool Registry.
 */

const ARCHETYPE_STATES = Object.freeze({
  /** Declarado/descoberto, ainda sem evidência suficiente. */
  EVIDENCE_REQUIRED: 'EVIDENCE_REQUIRED',
  /** Aceito: evidência real e suficiente. */
  ACCEPTED: 'ACCEPTED',
  /** Rejeitado: evidência obtida CONTRADIZ a existência/relevância do arquétipo. */
  REJECTED: 'REJECTED',
});

const ARCHETYPE_IMPORTANCE = Object.freeze(['REQUIRED', 'RELEVANT', 'OPTIONAL']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeArchetypeKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Um item de evidência é VÁLIDO quando liga o arquétipo a uma fonte real:
 * URL da fonte + referência de evidência capturada OU hash do conteúdo obtido.
 * Texto livre ("o mercado tem disso") nunca é evidência.
 */
function isValidEvidenceItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (!isNonEmptyString(item.url)) return false;
  return isNonEmptyString(item.evidenceRef) || isNonEmptyString(item.contentHash);
}

function validEvidenceOf(archetype) {
  return list(archetype?.sourceEvidence).filter(isValidEvidenceItem);
}

/**
 * Veredito de aceitação de UM arquétipo. Saída auditável campo a campo —
 * nunca booleano solto.
 *
 * @returns {{accepted: boolean, state: string, reason: string, evidenceCount: number}}
 */
function evaluateArchetypeAcceptance(archetype) {
  if (!archetype || typeof archetype !== 'object') {
    return { accepted: false, state: ARCHETYPE_STATES.REJECTED, reason: 'archetype_record_missing', evidenceCount: 0 };
  }
  if (!isNonEmptyString(archetype.archetypeKey) && !isNonEmptyString(archetype.id)) {
    return { accepted: false, state: ARCHETYPE_STATES.REJECTED, reason: 'archetype_key_missing', evidenceCount: 0 };
  }
  if (!isNonEmptyString(archetype.name)) {
    return { accepted: false, state: ARCHETYPE_STATES.REJECTED, reason: 'archetype_name_missing', evidenceCount: 0 };
  }

  const evidence = validEvidenceOf(archetype);
  const declared = list(archetype.sourceEvidence).length;
  if (evidence.length === 0) {
    return {
      accepted: false,
      state: ARCHETYPE_STATES.EVIDENCE_REQUIRED,
      reason: declared > 0 ? 'archetype_evidence_invalid' : 'archetype_without_evidence',
      evidenceCount: 0,
    };
  }
  // Evidência de CONTRADIÇÃO: a pesquisa obteve prova de que o arquétipo não
  // existe/não é relevante neste mercado (ex.: categoria extinta, absorvida).
  if (evidence.every((item) => item.contradicts === true)) {
    return { accepted: false, state: ARCHETYPE_STATES.REJECTED, reason: 'archetype_contradicted_by_evidence', evidenceCount: evidence.length };
  }
  return { accepted: true, state: ARCHETYPE_STATES.ACCEPTED, reason: 'archetype_evidence_accepted', evidenceCount: evidence.length };
}

/**
 * Normaliza um registro de arquétipo para persistência, computando o estado a
 * partir da evidência (o chamador não escolhe o estado — a evidência escolhe).
 */
function buildArchetypeRecord({
  vertical,
  archetypeKey = null,
  id = null,
  name,
  description = null,
  importance = 'RELEVANT',
  sourceEvidence = [],
  rationale = null,
  origin = 'research',
  validatedAt = null,
  metadata = {},
}) {
  const key = normalizeArchetypeKey(archetypeKey || id || name);
  const verdict = evaluateArchetypeAcceptance({ archetypeKey: key, name, sourceEvidence });
  return {
    vertical: String(vertical ?? '').trim(),
    archetypeKey: key,
    name: String(name ?? '').trim(),
    description: description ? String(description) : null,
    importance: ARCHETYPE_IMPORTANCE.includes(String(importance).toUpperCase())
      ? String(importance).toUpperCase()
      : 'RELEVANT',
    state: verdict.state,
    origin: origin === 'config' ? 'config' : 'research',
    sourceEvidence: list(sourceEvidence).map((item) => ({
      url: String(item?.url ?? ''),
      evidenceRef: item?.evidenceRef ? String(item.evidenceRef) : null,
      contentHash: item?.contentHash ? String(item.contentHash) : null,
      tier: Number.isFinite(Number(item?.tier)) ? Number(item.tier) : null,
      contradicts: item?.contradicts === true,
      note: item?.note ? String(item.note) : null,
    })),
    rationale: rationale ? String(rationale) : verdict.reason,
    validatedAt: verdict.state === ARCHETYPE_STATES.EVIDENCE_REQUIRED ? null : (validatedAt || null),
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  };
}

/**
 * REVALIDA os arquétipos declarados contra a evidência de pesquisa obtida
 * neste run. Nunca remove um declarado: sem evidência ele permanece com
 * estado EVIDENCE_REQUIRED (não vira ACCEPTED por confiança histórica); com
 * evidência contraditória vira REJECTED — e o motivo fica no registro.
 *
 * É esta função que revalida, na vertical fitness, os arquétipos
 * `financial-billing` e `student-digital-experience` (e qualquer outro): o
 * caminho de aceitação é o MESMO para todos — evidência, não exceção.
 *
 * @param {object} args
 * @param {Array}  args.declared          arquétipos do config da vertical
 * @param {Map|object} args.evidenceByArchetype  key → itens de evidência obtidos neste run
 * @param {Array}  [args.discovered]      arquétipos NOVOS sugeridos pela pesquisa
 * @returns {{records: Array, accepted: string[], evidenceRequired: string[], rejected: Array}}
 */
function revalidateArchetypes({ declared = [], evidenceByArchetype = {}, discovered = [] }) {
  const evidenceOf = (key) => {
    if (evidenceByArchetype instanceof Map) return list(evidenceByArchetype.get(key));
    return list(evidenceByArchetype?.[key]);
  };

  const records = [];
  const seen = new Set();

  for (const archetype of list(declared)) {
    const key = normalizeArchetypeKey(archetype?.id || archetype?.archetypeKey || archetype?.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const runEvidence = evidenceOf(key);
    const record = buildArchetypeRecord({
      vertical: archetype?.vertical,
      archetypeKey: key,
      name: archetype?.name || key,
      description: archetype?.description || null,
      importance: archetype?.importance || 'RELEVANT',
      // A evidência HISTÓRICA do config (texto livre) não é evidência válida:
      // só conta o que este run obteve via capabilities governadas.
      sourceEvidence: runEvidence,
      rationale: runEvidence.length > 0
        ? 'revalidado com evidência obtida neste run de descoberta'
        : 'declarado no config; aguardando evidência de pesquisa',
      origin: 'config',
      validatedAt: archetype?.validatedAt || null,
      metadata: { declaredEvidence: archetype?.evidence || null, declaredStatus: archetype?.status || null },
    });
    records.push(record);
  }

  for (const archetype of list(discovered)) {
    const key = normalizeArchetypeKey(archetype?.id || archetype?.archetypeKey || archetype?.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    records.push(buildArchetypeRecord({
      ...archetype,
      archetypeKey: key,
      origin: 'research',
      sourceEvidence: [...list(archetype?.sourceEvidence), ...evidenceOf(key)],
    }));
  }

  return {
    records,
    accepted: records.filter((r) => r.state === ARCHETYPE_STATES.ACCEPTED).map((r) => r.archetypeKey),
    evidenceRequired: records.filter((r) => r.state === ARCHETYPE_STATES.EVIDENCE_REQUIRED).map((r) => r.archetypeKey),
    rejected: records
      .filter((r) => r.state === ARCHETYPE_STATES.REJECTED)
      .map((r) => ({ archetypeKey: r.archetypeKey, rationale: r.rationale })),
  };
}

module.exports = {
  ARCHETYPE_STATES,
  ARCHETYPE_IMPORTANCE,
  normalizeArchetypeKey,
  isValidEvidenceItem,
  validEvidenceOf,
  evaluateArchetypeAcceptance,
  buildArchetypeRecord,
  revalidateArchetypes,
};
