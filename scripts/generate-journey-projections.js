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
 *   node scripts/generate-journey-projections.js --check   # não escreve; falha se divergir
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

function main() {
  const checkOnly = process.argv.includes('--check');
  const { artifact, skipped } = buildProjections();

  const serialized = serializeProjections(artifact);

  if (checkOnly) {
    const exists = fs.existsSync(OUTPUT_PATH);
    const current = exists ? fs.readFileSync(OUTPUT_PATH, 'utf8') : null;
    // Ausência NÃO é obsolescência. O artefato é DERIVADO e não versionado
    // (`reports/*` é ignorado no .gitignore; só `tenant-isolation-report.json` é
    // exceção), então num checkout limpo ele simplesmente não existe. Reprovar
    // aqui transformava este gate numa pré-condição manual oculta ("rode npm run
    // journey:projections") que derrubava o `validate:governance-enforcement`
    // sem que houvesse nada obsoleto — o mesmo defeito já corrigido no
    // `ensureProjectionsFresh()` do Ask AI. Geramos deterministicamente.
    if (!exists) {
      fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
      fs.writeFileSync(OUTPUT_PATH, serialized);
      console.log('✅ Projeções operacionais ausentes — geradas a partir das entradas atuais.');
      return;
    }
    // Presente porém divergente = obsolescência REAL (as entradas mudaram e o
    // artefato não foi regenerado). Isso continua sendo falha.
    if (current !== serialized) {
      console.error('❌ Projeções operacionais desatualizadas. Rode: npm run journey:projections');
      process.exit(1);
    }
    console.log('✅ Projeções operacionais atualizadas e limpas.');
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
  OUTPUT_PATH,
  COVERAGE_DIR,
  CATALOG_PATH,
};
