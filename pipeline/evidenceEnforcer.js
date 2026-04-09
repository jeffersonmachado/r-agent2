'use strict';

/**
 * pipeline/evidenceEnforcer.js
 *
 * Módulo responsável por verificar o pacote mínimo de evidências.
 *
 * Toda execução oficial do pipeline DEVE gerar:
 *   - qa/reports/execution.json
 *   - qa/reports/stability.json
 *   - qa/reports/learn.json
 *   - qa/reports/checkpoints.json
 *
 * Se qualquer um estiver faltando ou corrompido, a execução falha.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'qa', 'reports');

const REQUIRED_ARTIFACTS = [
  { name: 'execution', file: 'execution.json', description: 'Resultado de execução das etapas do pipeline' },
  { name: 'stability', file: 'stability.json', description: 'Snapshot de estabilidade do sistema' },
  { name: 'learn', file: 'learn.json', description: 'Artefatos do pipeline de aprendizado adaptativo' },
  { name: 'checkpoints', file: 'checkpoints.json', description: 'Estado dos checkpoints por onda' },
];

/**
 * Verifica se um JSON é válido e não-vazio.
 */
function isValidJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    return parsed !== null && typeof parsed === 'object';
  } catch {
    return false;
  }
}

function hasKeys(value, keys) {
  return keys.every((key) => value && Object.prototype.hasOwnProperty.call(value, key));
}

function hasMeaningfulContent(artifactName, parsed) {
  if (!parsed || typeof parsed !== 'object') return false;

  if (artifactName === 'execution') {
    return hasKeys(parsed, ['generatedAt', 'stepCount', 'steps']) && Array.isArray(parsed.steps) && parsed.steps.length > 0;
  }

  if (artifactName === 'stability') {
    return Number.isFinite(parsed?.snapshot?.global?.stabilityScore ?? parsed?.score);
  }

  if (artifactName === 'learn') {
    return Boolean(parsed.generatedAt) && Boolean(parsed.learning || parsed.memory || parsed.notes || parsed.fixPlans || parsed.summary);
  }

  if (artifactName === 'checkpoints') {
    return Boolean(parsed.finalizedAt) && Array.isArray(parsed.failures) && typeof parsed.progress === 'object';
  }

  return true;
}

/**
 * Verifica os artefatos obrigatórios de evidência.
 *
 * @param {string} [reportsDir] - Diretório dos relatórios (padrão: qa/reports/)
 * @returns {{ passed: boolean, missing: string[], corrupted: string[], artifacts: object[] }}
 */
function verifyEvidencePackage(reportsDir = REPORTS_DIR) {
  const missing = [];
  const corrupted = [];
  const artifacts = [];

  for (const artifact of REQUIRED_ARTIFACTS) {
    const filePath = path.join(reportsDir, artifact.file);
    const exists = fs.existsSync(filePath);
    const parsed = exists && isValidJson(filePath)
      ? JSON.parse(fs.readFileSync(filePath, 'utf8'))
      : null;
    const valid = Boolean(parsed) && hasMeaningfulContent(artifact.name, parsed);

    artifacts.push({
      name: artifact.name,
      file: artifact.file,
      path: filePath,
      exists,
      valid,
      description: artifact.description,
    });

    if (!exists) missing.push(artifact.file);
    else if (!valid) corrupted.push(artifact.file);
  }

  return {
    passed: missing.length === 0 && corrupted.length === 0,
    missing,
    corrupted,
    artifacts,
    checkedAt: new Date().toISOString(),
    reportsDir,
  };
}

/**
 * Verifica evidências e lança erro se faltar algum artefato obrigatório.
 *
 * @param {string} [context] - Contexto do caller para mensagem de erro
 * @param {string} [reportsDir] - Diretório dos relatórios
 * @throws {Error} Se algum artefato obrigatório estiver faltando ou corrompido
 */
function assertEvidenceComplete(context = 'pipeline', reportsDir = REPORTS_DIR) {
  const result = verifyEvidencePackage(reportsDir);

  if (!result.passed) {
    const lines = [`[evidence] FALHA: Pacote mínimo de evidência incompleto em "${context}".`];
    if (result.missing.length > 0) lines.push(`  Faltando: ${result.missing.join(', ')}`);
    if (result.corrupted.length > 0) lines.push(`  Corrompidos: ${result.corrupted.join(', ')}`);
    lines.push(`  Diretório: ${reportsDir}`);
    lines.push(`  Execute o pipeline completo: npm run pipeline`);
    throw new Error(lines.join('\n'));
  }

  return result;
}

/**
 * Gera o relatório de enforcement de evidência.
 * Persiste em qa/reports/evidence-enforcement.json.
 */
function generateEvidenceReport(executionResult, reportsDir = REPORTS_DIR) {
  const verification = verifyEvidencePackage(reportsDir);
  const report = {
    generatedAt: new Date().toISOString(),
    passed: verification.passed,
    executionSuccess: executionResult?.success ?? null,
    missing: verification.missing,
    corrupted: verification.corrupted,
    artifacts: verification.artifacts,
    verdict: verification.passed && executionResult?.success
      ? 'EVIDENCE_COMPLETE'
      : verification.passed
      ? 'EVIDENCE_COMPLETE_BUT_EXECUTION_FAILED'
      : 'EVIDENCE_MISSING',
  };

  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, 'evidence-enforcement.json'), JSON.stringify(report, null, 2));
  return report;
}

module.exports = {
  REQUIRED_ARTIFACTS,
  verifyEvidencePackage,
  assertEvidenceComplete,
  generateEvidenceReport,
};
