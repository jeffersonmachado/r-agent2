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

function main() {
  const checkOnly = process.argv.includes('--check');
  const { artifact, skipped } = buildProjections();

  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;

  if (checkOnly) {
    const current = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, 'utf8') : null;
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

main();
