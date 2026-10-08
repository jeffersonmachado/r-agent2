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
 *   CRITICAL: targeted + related + subsystem.
 *
 * DEPRECAÇÃO DO ROUTER V1 (2026-10-08) — o tier CRITICAL incluía o gate de selagem global
 * (`scripts/governance/validate-engineering-router-v1.js`), executado como MAIS UM comando do
 * plano. Isso não podia funcionar por construção: o plano roda com `cwd` = workspace isolado da
 * tentativa, e um gate de selagem escreve `reports/` relativo ao cwd. Medido ao vivo na task
 * 99ce6a35 (patch de 649B aprovado nos 3 test runs do contrato):
 *   EACCES: permission denied, open '<workspace>/reports/engineering-router-v1-report.json'
 *   -> exit 1 -> regressão FAIL.
 * A MESMA saída (stdout vazio, stderr byte a byte idêntico) apareceu em tasks DIFERENTES com
 * patches DIFERENTES: a reprovação media o ambiente, nunca o mérito do patch.
 *
 * Um gate de selagem certifica o REPOSITÓRIO (cwd = ROOT); ele não certifica o delta de uma task.
 * O gate V1 NÃO sai do enforcement: `regressionGovernanceService.checkGovernance` continua
 * executando o MESMO script em toda task, com `cwd: ROOT`, onde ele passa de verdade (183 checks,
 * 0 falhas). O que sai é apenas a execução DUPLICADA e no cwd errado — nenhuma cobertura foi
 * perdida, e a regressão volta a medir o patch.
 *
 * Módulo puro (sem I/O).
 */

const { RISK_LEVELS } = require('./constants');

const RISK_SET = new Set(RISK_LEVELS);

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
 * @returns {{tier:string, commands:string[], breakdown:{targeted:number, related:number,
 *   subsystem:number}, degraded:boolean}}
 */
function buildRegressionPlan({ touchedPaths = [], targetedCommands = [], risk, availableTestFiles = [] } = {}) {
  const tier = RISK_SET.has(risk) ? risk : 'LOW';
  const commands = [];
  const seen = new Set();
  // COMPOSIÇÃO DO PLANO, por origem. Achado medido (2026-10-08): um plano de tier CRITICAL executou
  // SOMENTE os testCommands do contrato (3 comandos) enquanto outro, no MESMO código, executou 43 —
  // e nada na evidência distinguia os dois casos. A composição passa a ser parte do retorno para que
  // o chamador possa registrar, e sinalizar, um plano degradado.
  const breakdown = { targeted: 0, related: 0, subsystem: 0 };
  const add = (cmd, bucket) => {
    if (!cmd || seen.has(cmd)) return false;
    seen.add(cmd);
    commands.push(cmd);
    breakdown[bucket] += 1;
    return true;
  };

  for (const cmd of targetedCommands) add(cmd, 'targeted');

  if (tier === 'MEDIUM' || tier === 'HIGH' || tier === 'CRITICAL') {
    for (const testFile of findRelatedTestFiles(touchedPaths, availableTestFiles)) {
      add(`npx jest ${testFile}`, 'related');
    }
  }

  if (tier === 'HIGH' || tier === 'CRITICAL') {
    for (const testFile of findSubsystemTestFiles(touchedPaths, availableTestFiles)) {
      add(`npx jest ${testFile}`, 'subsystem');
    }
  }

  // `degraded`: o tier promete amplitude ALÉM do contrato (HIGH/CRITICAL) e nada de related/subsystem
  // entrou. Não é erro por si só — um patch que só toca arquivos sem teste casável é legítimo — mas
  // deixar isso indistinguível foi exatamente o que escondeu o caso dos 3 comandos. O módulo apenas
  // DECLARA; quem decide registrar ou sinalizar é o chamador.
  const degraded = (tier === 'HIGH' || tier === 'CRITICAL')
    && breakdown.related === 0
    && breakdown.subsystem === 0;

  return { tier, commands, breakdown, degraded };
}

module.exports = {
  basenameNoExt,
  subsystemOf,
  findRelatedTestFiles,
  findSubsystemTestFiles,
  buildRegressionPlan,
};
