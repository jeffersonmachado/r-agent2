'use strict';

const { exists, failIfNeeded, readText, statusFromIssues, writeReport } = require('./common');

const files = ['AI_MEMORY/operational-rules.md', 'AI_MEMORY/anti-patterns.md', 'AI_MEMORY/deployment-rules.md', 'AGENTS.md', 'CLAUDE.md'];

const requiredPatterns = [
  { code: 'docker_required_missing', pattern: /Docker/i, message: 'Docker requirement is not enforced in operational docs.' },
  { code: 'pm2_ban_missing', pattern: /PM2/i, message: 'PM2 prohibition is not documented/enforced.' },
  { code: 'dist_clean_missing', pattern: /dist/i, message: 'dist cleanliness is not documented/enforced.' },
  { code: 'browser_validation_missing', pattern: /browser/i, message: 'Browser validation is not documented/enforced.' },
  { code: 'qa_waves_missing', pattern: /QA Waves/i, message: 'QA Waves enforcement is missing.' },
  { code: 'replay_governance_missing', pattern: /Replay/i, message: 'Replay governance enforcement is missing.' },
];

/**
 * Marcadores de pendência não resolvida (`TODO`/`FIXME`) nos docs operacionais.
 *
 * PRECISÃO (2026-09-13): o padrão era `TODO|FIXME` SEM fronteira de palavra, e
 * passou a acusar a palavra portuguesa **TODOS** ("... TODOS na classe engine/")
 * — texto legítimo de documentação, não um marcador pendente. A fronteira de
 * palavra mantém a detecção exata dos marcadores reais e deixa de casar com
 * palavras que apenas COMEÇAM com eles. Contrato nos dois sentidos em
 * `tests/unit/governance/operationalRulesPendingMarker.test.js`.
 */
const PENDING_MARKER_PATTERN = /\bTODO\b|\bFIXME\b/;

function hasPendingMarker(text) {
  return PENDING_MARKER_PATTERN.test(String(text || ''));
}

/**
 * Avalia os docs operacionais e devolve o relatório (função PURA quanto a
 * efeitos: não escreve arquivo nem encerra o processo). O CLI faz o I/O.
 */
function evaluateOperationalRules() {
  const issues = [];
  const combined = files.filter(exists).map(readText).join('\n');
  for (const item of requiredPatterns) {
    if (!item.pattern.test(combined)) {
      issues.push({ code: item.code, message: item.message });
    }
  }
  if (hasPendingMarker(combined)) {
    issues.push({ code: 'pending_marker_present', message: 'Operational agent files contain unresolved pending markers.' });
  }
  return {
    name: 'validate-operational-rules',
    status: statusFromIssues(issues),
    files,
    issues,
    suggestions: issues.map((issue) => issue.message),
  };
}

module.exports = { evaluateOperationalRules, hasPendingMarker, PENDING_MARKER_PATTERN };

if (require.main === module) {
  const report = evaluateOperationalRules();
  writeReport('operational-rules-validation-report.json', report);
  failIfNeeded(report);
}
