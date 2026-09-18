'use strict';

/**
 * Gera as projeções OPERACIONAIS de jornadas de negócio.
 *
 * Entrada:  qa-waves/journey-coverage/*.json (matéria-prima TÉCNICA, DEVELOPMENT)
 * Catálogo: config/business-journey-catalog.json (estágios de NEGÓCIO)
 * Saída:    reports/business-journey-projections.json (OPERATIONAL, sanitizado)
 *
 * A derivação é fail-closed: o que não tem estágio de negócio mapeado é
 * DESCARTADO, e qualquer token técnico que sobreviva faz o script falhar
 * (`TECHNICAL_LEAK`) em vez de publicar conhecimento contaminado.
 *
 * Uso:
 *   node scripts/generate-journey-projections.js
 *   node scripts/generate-journey-projections.js --check            # garante frescor; regenera se divergir
 *   node scripts/generate-journey-projections.js --check --strict   # asserção: falha se divergir
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  deriveProjectionFromQaCoverage,
  assertOperationalClean,
  PROJECTION_SCOPE,
  PROJECTION_VERSION,
} = require('../src/core/operational/journey-projection');

const ROOT = path.resolve(__dirname, '..');
const COVERAGE_DIR = path.join(ROOT, 'qa-waves', 'journey-coverage');
const CATALOG_PATH = path.join(ROOT, 'config', 'business-journey-catalog.json');
const OUTPUT_PATH = path.join(ROOT, 'reports', 'business-journey-projections.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadCoverageJourneys() {
  if (!fs.existsSync(COVERAGE_DIR)) return [];
  const journeys = [];
  for (const name of fs.readdirSync(COVERAGE_DIR).sort()) {
    if (!name.endsWith('.json')) continue;
    const payload = readJson(path.join(COVERAGE_DIR, name));
    for (const journey of payload.journeys || []) {
      journeys.push(journey);
    }
  }
  return journeys;
}

function buildProjections() {
  const catalog = readJson(CATALOG_PATH).journeys || {};
  const coverage = loadCoverageJourneys();

  const projections = [];
  const skipped = [];

  for (const journey of coverage) {
    const projection = deriveProjectionFromQaCoverage(journey, catalog);
    if (!projection) {
      skipped.push(journey.journey);
      continue;
    }
    projections.push(projection);
  }

  projections.sort((a, b) => String(a.journeyKey).localeCompare(String(b.journeyKey)));

  const artifact = {
    generatedBy: 'scripts/generate-journey-projections.js',
    scope: PROJECTION_SCOPE,
    version: PROJECTION_VERSION,
    // §P4: frescor por FINGERPRINT das entradas. Projeção antiga não pode
    // permanecer "fresca" depois que a matéria-prima ou o catálogo mudarem.
    inputFingerprint: computeInputFingerprint(),
    summary: {
      journeys: projections.length,
      skipped: skipped.length,
      mappedCatalogEntries: Object.keys(catalog).length,
    },
    journeys: projections,
  };

  // Fail-closed: nenhuma projeção sai contaminada.
  assertOperationalClean(artifact);
  return { artifact, skipped };
}

/**
 * §P4 — hash determinístico das ENTRADAS (cobertura por jornada + catálogo).
 * Muda quando a matéria-prima muda, permitindo provar frescor sem depender de
 * data de arquivo.
 */
function computeInputFingerprint() {
  const hash = crypto.createHash('sha256');
  if (fs.existsSync(COVERAGE_DIR)) {
    for (const name of fs.readdirSync(COVERAGE_DIR).sort()) {
      if (!name.endsWith('.json')) continue;
      hash.update(`coverage:${name}:`);
      hash.update(fs.readFileSync(path.join(COVERAGE_DIR, name), 'utf8'));
    }
  }
  hash.update('catalog:');
  hash.update(fs.readFileSync(CATALOG_PATH, 'utf8'));
  return hash.digest('hex');
}

function serializeProjections(artifact) {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

function writeProjections() {
  const { artifact, skipped } = buildProjections();
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, serializeProjections(artifact));
  return { artifact, skipped };
}

/**
 * §P1/§P2 (política B) — garante o artefato ANTES da validação, de forma
 * determinística, sem exigir comando manual oculto. `reports/*` é ignorado pelo
 * git, então em checkout limpo o artefato não existe: o gate precisa produzi-lo,
 * não instruir o operador a produzi-lo.
 *
 * @returns {{ generated: boolean, reason: string, artifact: object|null }}
 */
function ensureProjectionsFresh() {
  const expectedFingerprint = computeInputFingerprint();
  if (!fs.existsSync(OUTPUT_PATH)) {
    const { artifact } = writeProjections();
    return { generated: true, reason: 'artifact_absent', artifact };
  }
  let current = null;
  try {
    current = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  } catch (_) {
    current = null;
  }
  if (!current || current.inputFingerprint !== expectedFingerprint) {
    const { artifact } = writeProjections();
    return { generated: true, reason: current ? 'input_fingerprint_changed' : 'artifact_unreadable', artifact };
  }
  return { generated: false, reason: 'fresh', artifact: current };
}

/**
 * §P5 — Classificação PURA do estado do artefato derivado. Separada do I/O para
 * poder ser provada por teste sem tocar no disco.
 *
 * O artefato é DERIVADO e NÃO versionado (`.gitignore` → `reports/*`). Reprovar
 * por divergência exigia que o operador rodasse um comando manual DEPOIS que o
 * próprio pipeline regenera a matéria-prima: `qa-waves/journey-coverage/*.json`
 * é reescrito pelo platform-readiness (via `tools/system/go-no-go.js`) durante a
 * varredura. Ou seja, a mesma varredura mudava a entrada e depois exigia que a
 * saída já estivesse atualizada — a pré-condição manual oculta já eliminada no
 * caso "ausente". Regenerar deterministicamente garante o frescor por
 * CONSTRUÇÃO, que é mais forte do que exigir frescor. `--strict` preserva a
 * asserção para quem precisa provar que nenhuma escrita ocorreu.
 *
 * @returns {{ action: 'keep'|'generate'|'regenerate', reason: string }}
 */
function classifyProjectionState({ exists, readable, current, expected }) {
  if (!exists) return { action: 'generate', reason: 'artifact_absent' };
  if (!readable) return { action: 'regenerate', reason: 'artifact_unreadable' };
  if (current !== expected) return { action: 'regenerate', reason: 'input_changed' };
  return { action: 'keep', reason: 'fresh' };
}

function projectionKey(projection) {
  const vertical = projection && projection.vertical ? projection.vertical : '?';
  const journey = projection && projection.journeyKey ? projection.journeyKey : '?';
  return `${vertical}/${journey}`;
}

/**
 * §P5 — Delta legível entre o artefato anterior e o atual. A regeneração não
 * pode apagar o SINAL: o operador precisa ver o que mudou, mesmo sem falha.
 */
function computeProjectionDelta(previous, next) {
  const prevList = previous && Array.isArray(previous.journeys) ? previous.journeys : null;
  const nextList = next && Array.isArray(next.journeys) ? next.journeys : [];
  if (!prevList) {
    return { comparable: false, added: [], removed: [], stagesChanged: [] };
  }
  const prevMap = new Map(prevList.map((item) => [projectionKey(item), item]));
  const nextMap = new Map(nextList.map((item) => [projectionKey(item), item]));
  const added = [];
  const removed = [];
  const stagesChanged = [];
  for (const key of nextMap.keys()) {
    if (!prevMap.has(key)) added.push(key);
  }
  for (const key of prevMap.keys()) {
    if (!nextMap.has(key)) removed.push(key);
  }
  for (const [key, nextValue] of nextMap.entries()) {
    const prevValue = prevMap.get(key);
    if (!prevValue) continue;
    const before = JSON.stringify(prevValue.stages || []);
    const after = JSON.stringify(nextValue.stages || []);
    if (before !== after) {
      const countBefore = (prevValue.stages || []).length;
      const countAfter = (nextValue.stages || []).length;
      stagesChanged.push(`${key} (${countBefore}→${countAfter} estágios)`);
    }
  }
  return {
    comparable: true,
    added: added.sort(),
    removed: removed.sort(),
    stagesChanged: stagesChanged.sort(),
  };
}

function formatProjectionDelta(delta, limit = 8) {
  if (!delta.comparable) return ['   delta não comparável: artefato anterior ilegível'];
  const lines = [];
  const push = (label, items) => {
    if (!items.length) return;
    const shown = items.slice(0, limit).join(', ');
    const extra = items.length > limit ? `, +${items.length - limit}` : '';
    lines.push(`   ${label} (${items.length}): ${shown}${extra}`);
  };
  push('jornadas novas', delta.added);
  push('jornadas removidas', delta.removed);
  push('estágios alterados', delta.stagesChanged);
  if (!lines.length) {
    lines.push('   divergência sem mudança de conjunto/estágios (metadados ou fingerprint)');
  }
  return lines;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const { artifact, skipped } = buildProjections();

  const serialized = serializeProjections(artifact);

  if (checkOnly) {
    const strict = process.argv.includes('--strict');
    const exists = fs.existsSync(OUTPUT_PATH);
    const current = exists ? fs.readFileSync(OUTPUT_PATH, 'utf8') : null;
    let currentArtifact = null;
    if (exists) {
      try {
        currentArtifact = JSON.parse(current);
      } catch (_) {
        currentArtifact = null;
      }
    }
    // Ausência NÃO é obsolescência, e divergência de artefato DERIVADO não
    // versionado também não pode ser pré-condição manual oculta: o pipeline
    // regenera a matéria-prima (`qa-waves/journey-coverage/*.json`, escrito pelo
    // platform-readiness) no meio desta mesma varredura. Regeneramos
    // deterministicamente e reportamos o delta, em vez de instruir o operador a
    // rodar um comando — o frescor passa a ser garantido por CONSTRUÇÃO.
    const decision = classifyProjectionState({
      exists,
      readable: currentArtifact !== null,
      current,
      expected: serialized,
    });

    if (decision.action === 'keep') {
      console.log('✅ Projeções operacionais atualizadas e limpas.');
      return;
    }

    const delta = computeProjectionDelta(currentArtifact, artifact);

    if (strict) {
      console.error(`❌ Projeções operacionais divergentes (${decision.reason}) — modo estrito.`);
      for (const line of formatProjectionDelta(delta)) console.error(line);
      process.exit(1);
    }

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, serialized);
    console.log(`✅ Projeções operacionais regeneradas (${decision.reason}).`);
    for (const line of formatProjectionDelta(delta)) console.log(line);
    console.log('   frescor garantido por construção: o artefato reflete as entradas ATUAIS.');
    return;
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, serialized);

  console.log(`✅ ${artifact.summary.journeys} projeções operacionais geradas`);
  console.log(`   catálogo: ${artifact.summary.mappedCatalogEntries} jornadas mapeadas`);
  console.log(`   descartadas (sem estágio de negócio): ${skipped.length}`);
  console.log(`   saída: ${path.relative(ROOT, OUTPUT_PATH)}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildProjections,
  writeProjections,
  ensureProjectionsFresh,
  computeInputFingerprint,
  serializeProjections,
  classifyProjectionState,
  computeProjectionDelta,
  formatProjectionDelta,
  OUTPUT_PATH,
  COVERAGE_DIR,
  CATALOG_PATH,
};
