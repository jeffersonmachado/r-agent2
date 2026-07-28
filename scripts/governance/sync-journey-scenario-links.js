#!/usr/bin/env node
'use strict';

/**
 * sync-journey-scenario-links.js
 *
 * Gera `config/journey-scenario-links.json` — a DECLARAÇÃO versionada e
 * estável de ligação jornada → cenários usada pelo coverage gate
 * (`scripts/governance/validate-coverage-gate.js`).
 *
 * Por que este arquivo existe:
 * `qa-waves/journey-coverage/*.json` são artefatos GERADOS por
 * `tools/system/platform-readiness.js` (executado dentro de `npm run
 * zip:release`). Num checkout limpo (CI), sem `qa-mesh/meshRegistry.json` nem
 * o scenario store completo, o platform-readiness regenera esses arquivos com
 * conteúdo degradado (cenários `business-*` desaparecem), o que derrubava a
 * journeyCoverage do gate no CI. O gate não pode depender de arquivos
 * reescritos em runtime: seus inputs precisam ser determinísticos a partir do
 * checkout. Este script consolida a declaração rica (gerada localmente, com o
 * mesh completo) num config versionado que NUNCA é reescrito por nenhum
 * pipeline — só por execução manual deste script.
 *
 * Uso:
 *   npm run coverage-gate:links
 *
 * Rode-o apenas quando a ligação jornada → cenário mudar de verdade (novos
 * cenários de negócio, novas jornadas verticais) e revise o diff antes de
 * commitar. O gate falha fechado se o config estiver ausente/inválido.
 */

const fs = require('fs');
const path = require('path');
const { preserveManualEntries } = require('../../qa/coverage/journeyLinksManualPreserve');

const ROOT_DIR = path.join(__dirname, '..', '..');
const JOURNEY_COVERAGE_DIR = path.join(ROOT_DIR, 'qa-waves', 'journey-coverage');
const OUTPUT_PATH = path.join(ROOT_DIR, 'config', 'journey-scenario-links.json');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  if (!fs.existsSync(JOURNEY_COVERAGE_DIR)) {
    console.error(`[sync-links] diretório ausente: ${path.relative(ROOT_DIR, JOURNEY_COVERAGE_DIR)}`);
    process.exit(1);
  }

  const files = fs.readdirSync(JOURNEY_COVERAGE_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();

  const generatedVerticals = [];

  // Verticais marcadas como "manual": true no config existente são declarações
  // mantidas à mão (ex.: jornadas core fora das 6 verticais geradas pelo
  // platform-readiness) e precisam sobreviver à regeneração.
  let existing = null;
  try {
    existing = loadJson(OUTPUT_PATH);
  } catch {
    existing = null;
  }

  for (const name of files) {
    const data = loadJson(path.join(JOURNEY_COVERAGE_DIR, name));
    if (!data || !Array.isArray(data.journeys)) continue;
    const vertical = typeof data.vertical === 'string' && data.vertical.length > 0
      ? data.vertical
      : name.replace(/\.json$/, '');

    const journeys = [];
    for (const entry of data.journeys) {
      if (!entry || typeof entry.journey !== 'string' || entry.journey.length === 0) continue;
      const scenarios = (entry.scenarios || [])
        .filter((scenario) => scenario && typeof scenario.scenarioId === 'string')
        .map((scenario) => ({ scenarioId: scenario.scenarioId, status: scenario.status || 'approved' }));
      journeys.push({ journey: entry.journey, scenarios });
    }
    generatedVerticals.push({ vertical, journeys });
  }

  const { verticals, journeyCount, scenarioRefCount } = preserveManualEntries(generatedVerticals, existing);

  const output = {
    version: 1,
    description: 'Declaração versionada jornada → cenários para o coverage gate. '
      + 'Gerada por scripts/governance/sync-journey-scenario-links.js a partir de '
      + 'qa-waves/journey-coverage/*.json (artefatos do platform-readiness). '
      + 'Nunca reescrita em runtime; regenerar só com npm run coverage-gate:links. '
      + 'Verticais com "manual": true são mantidas à mão e preservadas pelo sync; '
      + 'jornadas com "manual": true dentro de verticais geradas também são preservadas.',
    generatedAt: new Date().toISOString(),
    source: 'qa-waves/journey-coverage/*.json',
    verticals,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`[sync-links] ${verticals.length} verticais, ${journeyCount} jornadas, `
    + `${scenarioRefCount} referências de cenário → ${path.relative(ROOT_DIR, OUTPUT_PATH)}`);
}

if (require.main === module) {
  main();
}

module.exports = { OUTPUT_PATH, JOURNEY_COVERAGE_DIR, preserveManualEntries };
