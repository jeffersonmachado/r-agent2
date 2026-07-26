'use strict';

/**
 * Regressão — watch do nodemon cobre o código do QA Mesh sem observar
 * artefatos de runtime.
 *
 * Falha observada (2026-07-26): o scheduler do mesh roda dentro do processo
 * da API (nodemon). Como `nodemon.json` observava apenas api/, engine/ e
 * src/, mudanças em `qa-mesh/` (ex.: consumo de evidência operacional de
 * jornadas blocking, commit a7f6592) não recarregavam o processo. O
 * scheduler executou com código stale e marcou a jornada blocking
 * `support_ticket_flow` como FAILED
 * (`blocking_journey_requires_browser_operational_runner`), derrubando o
 * coverage gate para NO_GO com evidência operacional válida e fresca em
 * disco.
 *
 * Comportamento correto:
 * 1. `qa-mesh/` deve estar no watch (é código carregado pela API).
 * 2. Todo artefato de runtime escrito pelo mesh/scheduler deve estar no
 *    ignore — caso contrário cada execução do scheduler reiniciaria a API.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function loadNodemonConfig() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'nodemon.json'), 'utf8'));
}

/**
 * Um ignore cobre um artefato quando, removendo sufixos de glob (`/**`, `/*`),
 * o caminho do artefato é igual ao padrão ou está dentro dele. Padrões com
 * curinga intermediário (ex.: qa-mesh/meshRegistry*.json) são avaliados com
 * minimatch, mesma engine do nodemon.
 */
function isIgnored(ignoreRules, artifactPath) {
  const minimatch = require('minimatch');
  return ignoreRules.some((rule) => {
    const base = rule.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
    if (base === artifactPath || artifactPath.startsWith(`${base}/`)) return true;
    return minimatch(artifactPath, rule) || minimatch(artifactPath, base);
  });
}

// Artefatos que o mesh/scheduler escreve em execução (não são código-fonte).
const RUNTIME_ARTIFACTS = [
  'qa-mesh/meshHistory',
  'qa-mesh/meshEvidence',
  'qa-mesh/intelligence',
  'qa-mesh/meshRegistry.json',
  'qa-mesh/meshRegistry.backup-1780109160341.json',
  'qa-mesh/baseline.json',
  'qa-mesh/canonical-promotion.json',
  'qa-mesh/go-no-go-report.json',
  'qa-mesh/meshReport.json',
  'qa-mesh/metrics.json',
  'qa-mesh/repairPlan.json',
  'qa-mesh/release-gate-report.json',
  'qa-mesh/scheduler-state.json',
  'qa-mesh/scheduler-activity.log',
];

describe('nodemon watch do QA Mesh (regressão: scheduler stale derrubou o gate)', () => {
  it('observa qa-mesh/ (código carregado pelo processo da API)', () => {
    const config = loadNodemonConfig();
    expect(config.watch).toContain('qa-mesh');
  });

  it.each(RUNTIME_ARTIFACTS)('ignora artefato de runtime %s', (artifact) => {
    const config = loadNodemonConfig();
    expect(isIgnored(config.ignore, artifact)).toBe(true);
  });

  it('artefatos de runtime existem de fato em qa-mesh/ (guarda contra lista fictícia)', () => {
    for (const artifact of RUNTIME_ARTIFACTS) {
      expect(fs.existsSync(path.join(ROOT, artifact))).toBe(true);
    }
  });
});
