#!/usr/bin/env node
'use strict';

/**
 * derive-fitness-inventory-baselines.js — GERADOR dos baselines canônicos de
 * inventário do sample Fitness (`config/benchmarks/fitness.json`).
 *
 * Por que existe (2026-09-15): o eixo de capabilities tinha baseline canônico
 * (`canonicalInventoryBaseline: 12`, derivado de `config/canonical-capabilities.json`),
 * mas os eixos de JORNADA e REGRA DE NEGÓCIO ficavam `NOT_MEASURABLE` por
 * ausência de inventário canônico — e o holdout ficava legalmente bloqueado.
 * Os baselines NUNCA podem ser digitados à mão: são DERIVADOS dos inventários
 * canônicos reais da plataforma, com proveniência por item.
 *
 * Fontes canônicas (todas versionadas no repositório):
 *   - capabilities:   config/canonical-capabilities.json  (kind === 'business')
 *   - jornadas:       config/business-journey-catalog.json (ids com prefixo
 *                     `<vertical>_` — as jornadas que a plataforma declara
 *                     operar para a vertical), enriquecidas com a criticidade
 *                     declarada em config/journey-criticality.json;
 *   - regras:         config/benchmark-normalization.json (rules com
 *                     kind === 'businessRule' — o vocabulário canônico
 *                     versionado de regras de negócio da vertical).
 *
 * Não existe outro registry de regras de negócio no repositório (verificado em
 * 2026-09-15: nenhum catálogo sob config/ nem serviço sob api/services). O
 * vocabulário de normalização é a ÚNICA fonte canônica real de regras de
 * negócio da vertical fitness — é ele que decide se um achado do concorrente é
 * confirmação ou novidade, então é também o inventário que a plataforma conhece.
 *
 * Fail-closed:
 *   - fonte canônica ausente/inválida → erro `baseline_source_missing`, nada
 *     é escrito (um baseline "derivado" de nada seria denominador fabricado);
 *   - fonte presente porém VAZIA para a vertical → erro
 *     `baseline_source_empty` (nunca escrever baseline 0 por omissão);
 *   - `--check` compara as seções geradas com o arquivo e falha em drift.
 *
 * Uso:
 *   node scripts/benchmark/derive-fitness-inventory-baselines.js          # escreve
 *   node scripts/benchmark/derive-fitness-inventory-baselines.js --check  # só verifica
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');

const ERROR_CODES = Object.freeze({
  SOURCE_MISSING: 'baseline_source_missing',
  SOURCE_EMPTY: 'baseline_source_empty',
  VERTICAL_MISMATCH: 'baseline_vertical_mismatch',
  DRIFT: 'baseline_drift_detected',
});

const DEFAULT_SOURCES = Object.freeze({
  sample: 'config/benchmarks/fitness.json',
  capabilities: 'config/canonical-capabilities.json',
  journeys: 'config/business-journey-catalog.json',
  journeyCriticality: 'config/journey-criticality.json',
  normalization: 'config/benchmark-normalization.json',
});

function generatorError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function readJson(absPath, sourceId) {
  if (!fs.existsSync(absPath)) {
    throw generatorError(ERROR_CODES.SOURCE_MISSING, `${sourceId} ausente em ${path.relative(ROOT_DIR, absPath)}`);
  }
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (error) {
    throw generatorError(ERROR_CODES.SOURCE_MISSING, `${sourceId} inválido (${error.message})`);
  }
}

function sortedKeys(object) {
  return Object.keys(object && typeof object === 'object' ? object : {}).sort();
}

/**
 * Deriva os três baselines a partir das fontes canônicas. Puro e determinístico:
 * mesmas fontes → mesma saída, sem relógio nem rede.
 *
 * @param {object} args
 * @param {string} args.vertical
 * @param {object} args.capabilities  conteúdo de canonical-capabilities.json
 * @param {object} args.journeys      conteúdo de business-journey-catalog.json
 * @param {object} args.journeyCriticality conteúdo de journey-criticality.json
 * @param {object} args.normalization conteúdo de benchmark-normalization.json
 * @param {object} [args.sourcePaths] caminhos relativos usados na proveniência
 */
function deriveBaselines({
  vertical,
  capabilities,
  journeys,
  journeyCriticality,
  normalization,
  sourcePaths = {},
}) {
  const verticalId = String(vertical || '').trim();
  if (!verticalId) throw generatorError(ERROR_CODES.VERTICAL_MISMATCH, 'vertical é obrigatória');

  const paths = { ...DEFAULT_SOURCES, ...sourcePaths };

  // ── Capabilities (eixo já existente — agora com inventário nominado) ──────
  const businessCapabilities = sortedKeys(capabilities?.capabilities)
    .filter((id) => capabilities.capabilities[id]?.kind === 'business');
  if (businessCapabilities.length === 0) {
    throw generatorError(ERROR_CODES.SOURCE_EMPTY, `${paths.capabilities} sem capabilities de negócio`);
  }
  const capabilityInventory = businessCapabilities.map((id) => ({
    id,
    name: capabilities.capabilities[id].name || null,
    domain: capabilities.capabilities[id].domain || null,
    provenance: { source: paths.capabilities, id, version: capabilities.version || null },
  }));

  // ── Jornadas da vertical ─────────────────────────────────────────────────
  // Regra de aplicabilidade: a jornada canônica pertence ao inventário da
  // vertical quando o id carrega o prefixo `<vertical>_` no catálogo
  // operacional. Jornadas cross-vertical genéricas (checkin, billing…) NÃO
  // entram: não existe artefato que declare a aplicabilidade delas por
  // vertical, e incluí-las seria inventar denominador.
  const prefix = `${verticalId}_`;
  const criticality = journeyCriticality?.journeys && typeof journeyCriticality.journeys === 'object'
    ? journeyCriticality.journeys
    : {};
  const journeyIds = sortedKeys(journeys?.journeys).filter((id) => id.startsWith(prefix));
  if (journeyIds.length === 0) {
    throw generatorError(ERROR_CODES.SOURCE_EMPTY, `${paths.journeys} sem jornadas com prefixo "${prefix}"`);
  }
  const journeyInventory = journeyIds.map((id) => ({
    id,
    title: journeys.journeys[id]?.title || null,
    stages: Array.isArray(journeys.journeys[id]?.stages) ? journeys.journeys[id].stages.length : 0,
    criticality: criticality[id]?.criticality || null,
    provenance: {
      source: paths.journeys,
      id,
      version: journeys.version ?? null,
      ...(criticality[id] ? { criticalitySource: paths.journeyCriticality } : {}),
    },
  }));

  // ── Regras de negócio da vertical ────────────────────────────────────────
  const ruleEntries = (Array.isArray(normalization?.rules) ? normalization.rules : [])
    .filter((rule) => rule && rule.kind === 'businessRule' && typeof rule.canonicalId === 'string');
  const seenRules = new Set();
  const ruleInventory = [];
  for (const rule of ruleEntries) {
    if (seenRules.has(rule.canonicalId)) continue;
    seenRules.add(rule.canonicalId);
    ruleInventory.push({
      id: rule.canonicalId,
      terms: Array.isArray(rule.terms) ? rule.terms.length : 0,
      provenance: { source: paths.normalization, id: rule.canonicalId, version: normalization.version || null },
    });
  }
  ruleInventory.sort((a, b) => a.id.localeCompare(b.id));
  if (ruleInventory.length === 0) {
    throw generatorError(ERROR_CODES.SOURCE_EMPTY, `${paths.normalization} sem regras canônicas (kind=businessRule)`);
  }

  return {
    canonicalInventoryBaseline: businessCapabilities.length,
    canonicalInventorySource: `${paths.capabilities} (${businessCapabilities.length} capabilities de negócio, ${sortedKeys(capabilities?.technicalCapabilities).length} técnicas)`,
    canonicalCapabilityInventory: capabilityInventory,
    canonicalJourneyInventoryBaseline: journeyInventory.length,
    canonicalJourneyInventorySource: `${paths.journeys} (${journeyInventory.length} jornadas com prefixo "${prefix}", criticidade de ${paths.journeyCriticality})`,
    canonicalJourneyInventory: journeyInventory,
    canonicalBusinessRuleInventoryBaseline: ruleInventory.length,
    canonicalBusinessRuleInventorySource: `${paths.normalization} (${ruleInventory.length} regras canônicas kind=businessRule)`,
    canonicalBusinessRuleInventory: ruleInventory,
    inventoryBaselineProvenance: {
      generator: 'scripts/benchmark/derive-fitness-inventory-baselines.js',
      vertical: verticalId,
      rule: 'baselines derivados dos inventários canônicos da plataforma; nunca digitados à mão',
      sources: {
        capabilities: { path: paths.capabilities, version: capabilities?.version || null },
        journeys: { path: paths.journeys, version: journeys?.version ?? null },
        journeyCriticality: { path: paths.journeyCriticality, version: journeyCriticality?.version ?? null },
        businessRules: { path: paths.normalization, version: normalization?.version || null },
      },
    },
    _inventoryBaselines: '§8/§9/§10: os três baselines canônicos são DERIVADOS por '
      + '`npm run benchmark:derive-fitness-baselines` (scripts/benchmark/derive-fitness-inventory-baselines.js) '
      + 'dos inventários canônicos reais da plataforma — capabilities de '
      + '`config/canonical-capabilities.json`, jornadas da vertical em '
      + '`config/business-journey-catalog.json` (prefixo fitness_) e regras de negócio de '
      + '`config/benchmark-normalization.json` (kind=businessRule). Cada item carrega proveniência '
      + '(arquivo + id + versão). Sem os baselines os eixos ficam NOT_MEASURABLE; com eles a taxa de '
      + 'novidade de cada eixo é medida sobre o denominador canônico correto. Nunca editar estes '
      + 'campos à mão: `--check` detecta drift.',
  };
}

/** Chaves do sample gerenciadas por este gerador (apenas estas são tocadas). */
const MANAGED_KEYS = Object.freeze([
  '_inventoryBaselines',
  'canonicalInventoryBaseline',
  'canonicalInventorySource',
  'canonicalCapabilityInventory',
  'canonicalJourneyInventoryBaseline',
  'canonicalJourneyInventorySource',
  'canonicalJourneyInventory',
  'canonicalBusinessRuleInventoryBaseline',
  'canonicalBusinessRuleInventorySource',
  'canonicalBusinessRuleInventory',
  'inventoryBaselineProvenance',
]);

function loadSources(paths = {}) {
  const resolved = { ...DEFAULT_SOURCES, ...paths };
  const abs = (rel) => path.join(ROOT_DIR, rel);
  return {
    resolved,
    capabilities: readJson(abs(resolved.capabilities), 'capabilities'),
    journeys: readJson(abs(resolved.journeys), 'journeys'),
    journeyCriticality: readJson(abs(resolved.journeyCriticality), 'journeyCriticality'),
    normalization: readJson(abs(resolved.normalization), 'normalization'),
  };
}

/**
 * Aplica os baselines ao sample. Retorna o NOVO objeto (não muta o original).
 * Só as chaves MANAGED_KEYS são escritas; todo o resto do sample é preservado.
 */
function applyBaselines(sample, baselines) {
  const next = JSON.parse(JSON.stringify(sample));
  for (const key of MANAGED_KEYS) {
    if (baselines[key] === undefined) delete next[key];
    else next[key] = baselines[key];
  }
  return next;
}

function sectionsEqual(sample, baselines) {
  return MANAGED_KEYS.every((key) => JSON.stringify(sample[key] ?? null) === JSON.stringify(baselines[key] ?? null));
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const sources = loadSources();
  const samplePath = path.join(ROOT_DIR, sources.resolved.sample);
  const sample = readJson(samplePath, 'sample');
  const vertical = sample.vertical || 'fitness';

  const baselines = deriveBaselines({
    vertical,
    capabilities: sources.capabilities,
    journeys: sources.journeys,
    journeyCriticality: sources.journeyCriticality,
    normalization: sources.normalization,
  });

  if (checkOnly) {
    if (!sectionsEqual(sample, baselines)) {
      const drifted = MANAGED_KEYS.filter(
        (key) => JSON.stringify(sample[key] ?? null) !== JSON.stringify(baselines[key] ?? null),
      );
      process.stderr.write(`[derive-fitness-baselines] DRIFT: ${drifted.join(', ')}\n`);
      process.exit(1);
    }
    process.stdout.write('[derive-fitness-baselines] OK: baselines em sincronia com as fontes canônicas\n');
    return;
  }

  const next = applyBaselines(sample, baselines);
  fs.writeFileSync(samplePath, `${JSON.stringify(next, null, 2)}\n`);
  process.stdout.write(
    `[derive-fitness-baselines] ${sources.resolved.sample}: capabilities=${baselines.canonicalInventoryBaseline} `
    + `journeys=${baselines.canonicalJourneyInventoryBaseline} businessRules=${baselines.canonicalBusinessRuleInventoryBaseline}\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[derive-fitness-baselines] ${error.code || 'error'}: ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  ERROR_CODES,
  MANAGED_KEYS,
  DEFAULT_SOURCES,
  deriveBaselines,
  applyBaselines,
  sectionsEqual,
};
