'use strict';

/**
 * engine/engineeringRouter/regressionPlan.js
 *
 * ER-V1-FINAL-006 — Real Regression.
 *
 * Achado real (confirmado por inspeção direta do código-fonte, não hipotético):
 * `regressionGovernanceService.js::checkRegression(attemptId)` só chamava
 * `listTestRuns(attemptId)` — relia os `EngineeringTestRun` já persistidos pela fase TESTING
 * (executada ANTES do REVIEW aprovar) e verificava se todos passaram. Nunca executava nenhum
 * comando novo. Isso é evidence revalidation (prova que algo passou no passado), não regression
 * execution (prova que o código, no estado ATUAL, ainda passa depois do REVIEW ter potencialmente
 * sugerido mudanças, e depois de qualquer mudança de ambiente entre TESTING e REGRESSION).
 *
 * Este módulo constrói o PLANO de regressão determinístico e proporcional ao risco — nunca
 * decide "rodar tudo sempre" sem justificativa. A execução real (runTestCommands) e a
 * persistência (EngineeringRegressionRun) ficam em regressionGovernanceService.js — este
 * módulo é puro (sem I/O), recebendo a lista de arquivos de teste candidatos já resolvida pelo
 * chamador (que tem acesso a fs), para permanecer testável e determinístico.
 *
 * Política por risco (RISK_LEVELS já é exatamente LOW/MEDIUM/HIGH/CRITICAL — reaproveitado
 * sem reimplementar um segundo enum paralelo):
 *   LOW:      targeted (testCommands do próprio Task Contract).
 *   MEDIUM:   targeted + testes cujo nome de arquivo relaciona com os caminhos tocados pelo patch.
 *   HIGH:     targeted + related + suíte completa do "subsistema" (diretório pai comum) afetado.
 *   CRITICAL: targeted + related + subsystem + o gate estrutural de governança canônico
 *             (scripts/governance/validate-engineering-router-v1.js — reaproveitado, nunca
 *             reimplementado em paralelo).
 *
 * Módulo puro (sem I/O).
 */

const { RISK_LEVELS } = require('./constants');

const RISK_SET = new Set(RISK_LEVELS);
const GOVERNANCE_GATE_COMMAND = 'node scripts/governance/validate-engineering-router-v1.js';

function basenameNoExt(filePath) {
  const parts = String(filePath || '').split('/');
  const last = parts[parts.length - 1] || '';
  return last.replace(/\.(test\.)?[jt]sx?$/i, '').replace(/\.(js|ts|jsx|tsx)$/i, '');
}

/**
 * Diretório "de subsistema" de um caminho — o penúltimo segmento antes do arquivo, quando
 * existe (ex.: `api/services/engineeringRouter/promotionService.js` -> `engineeringRouter`).
 * Caminhos rasos (sem diretório pai identificável) não contribuem com um subsistema.
 */
function subsystemOf(filePath) {
  const parts = String(filePath || '').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return parts[parts.length - 2];
}

/**
 * Testes cujo nome de arquivo contém o basename de pelo menos um caminho tocado — heurística
 * simples e determinística (convenção real já usada em todo o repositório: um teste de
 * `promotionService.js` se chama algo com "PromotionService" no nome), não um grafo de
 * dependência de imports.
 */
function findRelatedTestFiles(touchedPaths, availableTestFiles) {
  const basenames = (touchedPaths || []).map(basenameNoExt).filter(Boolean).map((b) => b.toLowerCase());
  if (basenames.length === 0) return [];
  return (availableTestFiles || []).filter((testFile) => {
    const lower = testFile.toLowerCase();
    return basenames.some((b) => lower.includes(b));
  });
}

/**
 * Testes cujo caminho contém o nome do subsistema (diretório pai) de pelo menos um caminho
 * tocado — regressão mais ampla que `findRelatedTestFiles`, escopada ao subsistema real
 * afetado (nunca a suíte inteira do repositório sem justificativa).
 */
function findSubsystemTestFiles(touchedPaths, availableTestFiles) {
  const subsystems = new Set((touchedPaths || []).map(subsystemOf).filter(Boolean));
  if (subsystems.size === 0) return [];
  return (availableTestFiles || []).filter((testFile) => {
    const lower = testFile.toLowerCase();
    return [...subsystems].some((s) => lower.includes(String(s).toLowerCase()));
  });
}

/**
 * @param {Object} params
 * @param {string[]} params.touchedPaths - caminhos tocados pelo patch validado.
 * @param {string[]} params.targetedCommands - testCommands do Task Contract (sempre incluídos).
 * @param {string} params.risk - LOW|MEDIUM|HIGH|CRITICAL.
 * @param {string[]} [params.availableTestFiles] - candidatos a teste relacionado/subsistema,
 *   já resolvidos pelo chamador (glob real do repositório) — ausente/vazio é seguro (o plano
 *   cai para só `targeted`, nunca lança).
 * @returns {{tier:string, commands:string[]}}
 */
function buildRegressionPlan({ touchedPaths = [], targetedCommands = [], risk, availableTestFiles = [] } = {}) {
  const tier = RISK_SET.has(risk) ? risk : 'LOW';
  const commands = [];
  const seen = new Set();
  const add = (cmd) => {
    if (!cmd || seen.has(cmd)) return;
    seen.add(cmd);
    commands.push(cmd);
  };

  for (const cmd of targetedCommands) add(cmd);

  if (tier === 'MEDIUM' || tier === 'HIGH' || tier === 'CRITICAL') {
    for (const testFile of findRelatedTestFiles(touchedPaths, availableTestFiles)) {
      add(`npx jest ${testFile}`);
    }
  }

  if (tier === 'HIGH' || tier === 'CRITICAL') {
    for (const testFile of findSubsystemTestFiles(touchedPaths, availableTestFiles)) {
      add(`npx jest ${testFile}`);
    }
  }

  if (tier === 'CRITICAL') {
    add(GOVERNANCE_GATE_COMMAND);
  }

  return { tier, commands };
}

module.exports = {
  GOVERNANCE_GATE_COMMAND,
  basenameNoExt,
  subsystemOf,
  findRelatedTestFiles,
  findSubsystemTestFiles,
  buildRegressionPlan,
};
