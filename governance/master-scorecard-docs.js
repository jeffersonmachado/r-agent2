'use strict';

const fs = require('fs');
const path = require('path');

function cell(value) {
  return String(value == null ? '' : value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

function requirementSummary(dimension) {
  const mandatory = dimension.requirements.filter((item) => item.mandatory);
  const passed = mandatory.filter((item) => item.status === 'PASS').length;
  return `${passed}/${mandatory.length}`;
}

function topGap(dimension) {
  const gap = dimension.gaps[0];
  return gap ? `${gap.id}: ${gap.rootCause}` : 'Nenhum';
}

function renderMasterScorecard(scorecard) {
  const lines = [
    '# RAP Master Scorecard',
    '',
    '> Arquivo gerado por `governance/revalidate-master-scorecard.js`. Não editar manualmente.',
    '',
    `- Generated at: ${scorecard.generatedAt}`,
    `- Run ID: ${scorecard.runId || 'MISSING'}`,
    `- Source fingerprint: ${scorecard.sourceFingerprint || 'MISSING'}`,
    `- Scorecard fingerprint: ${scorecard.scorecardFingerprint || 'MISSING'}`,
    `- Overall status: **${scorecard.overallStatus}**`,
    `- Dimensions: ${scorecard.summary.totalDimensions}`,
    `- 10/10: ${scorecard.summary.dimensionsAt10}`,
    `- Below 10: ${scorecard.summary.dimensionsBelow10}`,
    `- Open gaps: ${scorecard.summary.openGaps}`,
    `- Open blockers: ${scorecard.summary.openBlockers}`,
    '',
    '## Dimensões',
    '',
    '| ID | Dimensão | Score | Status | Mandatory PASS | Gaps | Blockers |',
    '|---|---|---:|---|---:|---:|---:|',
  ];
  for (const dimension of scorecard.dimensions) {
    lines.push(`| ${cell(dimension.id)} | ${cell(dimension.name)} | ${dimension.score}/10 | ${cell(dimension.status)} | ${requirementSummary(dimension)} | ${dimension.gaps.length} | ${dimension.blockers.length} |`);
  }
  lines.push('', '## Contrato de 10/10', '');
  lines.push('Uma dimensão só recebe 10 quando todos os requisitos obrigatórios são `PASS`, sem gap ou blocker aberto, no mesmo `runId` e `sourceFingerprint`. Artifact ausente, sem lineage, stale ou de outro run nunca conta como prova.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderProgress(scorecard) {
  const lines = [
    '# RAP 10/10 — Progresso derivado',
    '',
    '> Arquivo gerado por `governance/revalidate-master-scorecard.js`. Não editar manualmente.',
    '',
    `- Total dimensions: ${scorecard.summary.totalDimensions}`,
    `- 10/10: ${scorecard.summary.dimensionsAt10}`,
    `- Below 10: ${scorecard.summary.dimensionsBelow10}`,
    `- Open gaps: ${scorecard.summary.openGaps}`,
    `- Open blockers: ${scorecard.summary.openBlockers}`,
    `- Mandatory requirement failures: ${scorecard.summary.mandatoryGateFailures}`,
    `- Stale requirements/artifacts: ${scorecard.summary.staleArtifacts}`,
    `- Invalid requirements/artifacts: ${scorecard.summary.invalidArtifacts}`,
    `- Insufficient evidence: ${scorecard.summary.insufficientEvidence}`,
    '',
    '## Ordem de dependência',
    '',
  ];
  scorecard.dependencyOrder.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  lines.push('', '## Dimensões abaixo de 10', '');
  lines.push('| ID | Dimensão | Score | Status | Primeiro gap factual |');
  lines.push('|---|---|---:|---|---|');
  for (const dimension of scorecard.dimensions.filter((item) => item.score < 10)) {
    lines.push(`| ${cell(dimension.id)} | ${cell(dimension.name)} | ${dimension.score}/10 | ${cell(dimension.status)} | ${cell(topGap(dimension))} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function writeGeneratedDocs(scorecard, rootDir) {
  const architectureDir = path.join(rootDir, 'docs', 'architecture');
  fs.mkdirSync(architectureDir, { recursive: true });
  const masterPath = path.join(architectureDir, 'RAP_MASTER_SCORECARD.md');
  const progressPath = path.join(architectureDir, 'RAP_10_OF_10_PROGRESS.md');
  fs.writeFileSync(masterPath, renderMasterScorecard(scorecard), 'utf8');
  fs.writeFileSync(progressPath, renderProgress(scorecard), 'utf8');
  return { masterPath, progressPath };
}

module.exports = {
  renderMasterScorecard,
  renderProgress,
  writeGeneratedDocs,
};
