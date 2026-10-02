'use strict';

/**
 * engine/engineeringMission/missionSource.js
 *
 * MISSION SOURCE AUTHORITY — a fonte de código sobre a qual uma Engineering Mission executa.
 *
 * GAP QUE ESTE MÓDULO FECHA (confirmado no código em 2026-10-02):
 *
 *   `patchApplyService.createWorkspace` materializava o worktree de TODA tentativa a partir de
 *   `git rev-parse HEAD` do ROOT — ou seja, da `main`. Como o fix do Bug Loop nasce numa branch
 *   candidate PRÓPRIA (`engineering-router/candidates/<taskId>`) e a task seguinte da missão
 *   voltava a nascer da `main`, o patch corrigido NUNCA entrava no caminho de execução da missão.
 *   Resultado observado: mission → task A → bug → fix GREEN em candidate → resume → replacement
 *   task criada a partir da main → **bug reaparece**. A recorrência era artefato de o fix nunca ter
 *   entrado na source usada — não de o bug ter voltado.
 *
 * MODELO CORRETO (e o que este módulo declara):
 *
 *   main (M0, INTOCADA durante toda a missão)
 *     └── engineering/missions/<missionId>   ← fonte isolada da missão
 *           ├── task A candidate → integra → M2
 *           ├── bug fix candidate → integra → M3
 *           └── task B nasce de M3 (vê o fix)
 *
 * Invariantes que o módulo expressa (e que o serviço de I/O faz valer):
 *
 *   1. MAIN INTOCADA: nenhuma integração escreve na main. A promoção continua sendo um ato
 *      SEPARADO e explícito, fora do self-engineering normal.
 *   2. FONTE POR MISSÃO: nunca uma branch global compartilhada entre missões — a branch carrega o
 *      `missionId`, e duas missões jamais convergem sobre a mesma ref.
 *   3. HERANÇA: toda task de uma missão declara o commit da fonte da missão no momento em que foi
 *      criada (`sourceCommit`). Task sem herança declarada é um defeito, não um default.
 *   4. CANDIDATE NÃO ENTRA POR TERMINAR: a integração exige pré-condições objetivas (task GREEN,
 *      testes, review, regressão, posse vigente, integridade do candidate). Coder terminar não é
 *      autoridade para integrar.
 *   5. CANDIDATE OBSOLETO NÃO É APLICADO CEGAMENTE: se `candidateBaseCommit` difere do
 *      `missionCurrentCommit` corrente da missão, a integração é recusada como STALE — nunca um
 *      merge/rebase silencioso.
 *   6. AVANÇO ATÔMICO: o `missionCurrentCommit` só avança por CAS
 *      (`expectedCommit` + `expectedFence`). Um avanço concorrente perde e recebe
 *      `CONCURRENT_MISSION_SOURCE_UPDATE` — nunca sobrescreve o trabalho do outro.
 *   7. CONFLITO É EXPLÍCITO: um conflito de integração NÃO é resolvido silenciosamente; vira
 *      `MISSION_INTEGRATION_CONFLICT` com os arquivos envolvidos, para o Router tratar como uma
 *      EngineeringTask própria.
 *
 * Módulo PURO: sem I/O, sem git, sem banco. Toda decisão é determinística e auditável.
 */

/** Estados observáveis da fonte de uma missão. */
const MISSION_SOURCE_STATES = Object.freeze([
  'PENDING',   // missão executável ainda sem branch de integração materializada
  'READY',     // fonte materializada, pronta para receber tasks
  'CONFLICT',  // última integração encontrou conflito — exige resolução explícita
  'STALE',     // candidate apresentado não deriva do commit corrente da fonte
]);

/** Desfechos possíveis de uma tentativa de integração (vocabulário fechado, auditável). */
const INTEGRATION_RESULTS = Object.freeze([
  'INTEGRATED',              // o candidate entrou na fonte da missão e o commit avançou
  'ALREADY_INTEGRATED',      // idempotência: o mesmo (missionId, taskId, candidateCommit) já entrou
  'PRECONDITION_FAILED',     // faltou alguma pré-condição objetiva (task/tests/review/regressão/posse)
  'STALE_CANDIDATE',         // candidateBaseCommit != missionCurrentCommit
  'CONCURRENT_SOURCE_UPDATE',// CAS perdido: outro avanço aconteceu antes
  'CONFLICT',                // merge/cherry-pick conflitou — exige resolução explícita
  'INTEGRITY_FAILED',        // candidate não existe / árvore divergente do patch validado
]);

/** Tipos de integração (bug fix usa o MESMO caminho da task — não há caminho privilegiado). */
const INTEGRATION_TYPES = Object.freeze(['TASK_CANDIDATE', 'BUG_FIX_CANDIDATE']);

/** Prefixo canônico das branches de missão. NUNCA uma ref global compartilhada. */
const MISSION_BRANCH_PREFIX = 'engineering/missions';

/**
 * Nome canônico da branch de integração de uma missão.
 *
 * Declarado aqui (e não no serviço de I/O) para que qualquer auditor possa recalcular a ref a
 * partir do `missionId` — a ref é derivável, não um dado opaco guardado em algum lugar.
 */
function buildIntegrationBranchName(missionId) {
  const id = String(missionId || '').trim();
  if (id === '') {
    throw Object.assign(new Error('missionId é obrigatório para derivar a branch de integração'), {
      code: 'MISSION_SOURCE_ID_REQUIRED',
    });
  }
  return `${MISSION_BRANCH_PREFIX}/${id}`;
}

/** A ref pertence a uma branch de missão? (guarda contra tratar `main` como fonte de missão.) */
function isMissionBranch(ref) {
  return String(ref || '').trim().startsWith(`${MISSION_BRANCH_PREFIX}/`);
}

/** Branch de fonte é proibida de ser a main: a main é a ORIGEM, nunca a fonte de execução. */
function isForbiddenSourceRef(ref) {
  const value = String(ref || '').trim();
  return value === 'main' || value === 'master' || value === 'HEAD';
}

/**
 * Chave de idempotência de uma integração.
 *
 * `(missionId, taskId, candidateCommit)` é a identidade REAL do efeito: a mesma tríade nunca pode
 * produzir dois commits na fonte da missão. É o que torna a integração crash-safe — o processo pode
 * morrer entre "commit criado" e "estado persistido", e a retomada reconhece o que já entrou
 * porque a chave é derivada do conteúdo, não de um contador.
 */
function buildIntegrationKey({ missionId, taskId, candidateCommit }) {
  const parts = [missionId, taskId, candidateCommit].map((v) => String(v || '').trim());
  if (parts.some((p) => p === '')) {
    throw Object.assign(new Error('integrationKey exige missionId, taskId e candidateCommit'), {
      code: 'MISSION_SOURCE_KEY_INCOMPLETE',
    });
  }
  return `mission-integration:${parts.join(':')}`;
}

/**
 * O candidate deriva do commit corrente da fonte da missão?
 *
 * Esta é a guarda contra aplicar cegamente um patch produzido sobre uma base que já avançou — o
 * caso real de duas tasks concorrentes: A e B começam em M1; A integra (fonte vai a M2); B termina
 * baseada em M1. Aplicar B sobre M2 seria aplicar um patch cuja base não existe mais.
 *
 * @returns {{stale:boolean, code:string|null, reason:string}}
 */
function classifyCandidateStaleness({ candidateBaseCommit = null, missionCurrentCommit = null } = {}) {
  const base = String(candidateBaseCommit || '').trim();
  const current = String(missionCurrentCommit || '').trim();

  if (base === '' || current === '') {
    return {
      stale: true,
      code: 'MISSION_SOURCE_COMMIT_UNKNOWN',
      reason: 'commit base do candidate e/ou commit corrente da fonte ausentes — não há como provar que o patch se aplica à base atual',
    };
  }
  if (base !== current) {
    return {
      stale: true,
      code: 'STALE_CANDIDATE',
      reason: `candidate derivado de ${base.slice(0, 12)} mas a fonte da missão já está em ${current.slice(0, 12)} — rebase/revalidação necessária, aplicação cega é proibida`,
    };
  }
  return { stale: false, code: null, reason: 'candidate derivado exatamente do commit corrente da fonte da missão' };
}

/**
 * Pré-condições de integração. Coder terminar NÃO entra nesta lista — é requisito de processo, não
 * de resultado. O que entra são evidências que já existem no sistema:
 *
 *   - o CANDIDATE chegou a GREEN (coder + testes + review + regressão + governança passaram de
 *     verdade — é o que a promoção significa);
 *   - houve execução de teste registrada (a mudança foi exercitada);
 *   - houve review registrado e APROVADO (alguém independente olhou);
 *   - houve regressão registrada e PASS (a mudança não quebrou o resto);
 *   - a posse (lease/fence) é vigente (quem integra é o dono);
 *   - o candidate existe e sua árvore confere (integridade — nada além do patch validado).
 *
 * `candidateGreen` é o nome honesto do que se exige aqui: a integração acontece ANTES de a task ser
 * marcada GREEN (se a integração falhar, a task NÃO vira GREEN). `taskStatus === 'GREEN'` continua
 * aceito como alias para os caminhos de RETOMADA, em que a task já foi marcada GREEN antes de uma
 * integração interrompida.
 *
 * @returns {{eligible:boolean, code:string|null, missing:string[], reason:string}}
 */
function assessIntegrationPreconditions({
  candidateGreen = false,
  taskStatus = null,
  hasTestRun = false,
  reviewVerdict = null,
  regressionStatus = null,
  ownershipValid = false,
  candidateIntegrityOk = false,
} = {}) {
  const missing = [];

  const green = candidateGreen === true || String(taskStatus || '').toUpperCase() === 'GREEN';
  if (!green) missing.push('CANDIDATE_NOT_GREEN');
  if (!hasTestRun) missing.push('NO_TEST_RUN');
  // Review ausente e review REPROVADO são coisas diferentes, mas ambas impedem a integração:
  // ausência de review é ausência de evidência; reprovação é evidência contrária.
  const verdict = reviewVerdict === null || reviewVerdict === undefined ? null : String(reviewVerdict).toUpperCase();
  if (verdict === null) missing.push('NO_REVIEW');
  else if (verdict !== 'APPROVE') missing.push('REVIEW_NOT_APPROVED');
  const regression = String(regressionStatus || '').toUpperCase();
  if (regression === '') missing.push('NO_REGRESSION');
  else if (regression !== 'PASS' && regression !== 'GREEN') missing.push('REGRESSION_NOT_PASS');
  if (!ownershipValid) missing.push('OWNERSHIP_NOT_HELD');
  if (!candidateIntegrityOk) missing.push('CANDIDATE_INTEGRITY_FAILED');

  if (missing.length > 0) {
    return {
      eligible: false,
      code: 'PRECONDITION_FAILED',
      missing,
      reason: `integração recusada: o candidate não satisfaz ${missing.join(', ')} — terminar de codificar não é autoridade para entrar na fonte da missão`,
    };
  }
  return {
    eligible: true,
    code: null,
    missing: [],
    reason: 'todas as pré-condições objetivas satisfeitas (candidate GREEN, testes, review aprovado, regressão PASS, posse, integridade)',
  };
}

/**
 * Avanço do commit corrente da fonte, por CAS.
 *
 * `expectedCommit` é o que QUEM INTEGRA leu antes de fazer o trabalho; `currentCommit` é o que está
 * persistido AGORA. Se divergiram, alguém avançou a fonte no meio do caminho e aplicar seria
 * perder esse avanço. Neste caso o retorno é `concurrent` — nunca um "avança mesmo assim".
 *
 * O fence entra pelo mesmo motivo que na task: um worker que perdeu a missão não pode avançar a
 * fonte mesmo que o commit ainda bata (posse vencida é posse perdida).
 */
function planSourceAdvance({
  expectedCommit = null,
  currentCommit = null,
  newCommit = null,
  expectedFence = null,
  currentFence = null,
} = {}) {
  const expected = String(expectedCommit || '').trim();
  const current = String(currentCommit || '').trim();
  const next = String(newCommit || '').trim();

  if (next === '') {
    return { allowed: false, code: 'MISSION_SOURCE_NEW_COMMIT_REQUIRED', reason: 'sem commit de destino não há avanço a aplicar' };
  }
  if (next === current) {
    // Integrar um candidate cujo conteúdo já é o corrente é um no-op idempotente, não um conflito.
    return { allowed: false, code: 'ALREADY_INTEGRATED', reason: `a fonte da missão já está em ${next.slice(0, 12)}` };
  }
  if (expected === '' || current === '') {
    return { allowed: false, code: 'MISSION_SOURCE_COMMIT_UNKNOWN', reason: 'CAS exige commit esperado e corrente conhecidos' };
  }
  if (expected !== current) {
    return {
      allowed: false,
      code: 'CONCURRENT_MISSION_SOURCE_UPDATE',
      reason: `avanço perdido: esperado ${expected.slice(0, 12)}, corrente ${current.slice(0, 12)} — outro integration avançou a fonte antes`,
      expectedCommit: expected,
      currentCommit: current,
    };
  }
  if (expectedFence !== null && currentFence !== null && String(expectedFence) !== String(currentFence)) {
    return {
      allowed: false,
      code: 'CONCURRENT_MISSION_SOURCE_UPDATE',
      reason: `fence divergente: esperado ${expectedFence}, corrente ${currentFence} — a posse da missão mudou de dono`,
      expectedFence,
      currentFence,
    };
  }
  return {
    allowed: true,
    code: null,
    reason: `CAS satisfeito: a fonte avança de ${current.slice(0, 12)} para ${next.slice(0, 12)}`,
    fromCommit: current,
    toCommit: next,
  };
}

/**
 * Uma integração já aconteceu para esta tríade? (idempotência de retomada.)
 *
 * O caso real: o processo morre entre o commit de integração e a persistência do novo commit
 * corrente. Na retomada não se pode reaplicar o patch (duplicaria o efeito) — reconhece-se pelo
 * registro persistido que aquela tríade já entrou.
 */
function isIntegrationAlreadyRecorded({ existingRecords = [], integrationKey = null } = {}) {
  const key = String(integrationKey || '').trim();
  if (key === '') return { recorded: false, record: null };
  const match = (Array.isArray(existingRecords) ? existingRecords : [])
    .find((record) => String(record && record.integration_key) === key);
  if (!match) return { recorded: false, record: null };
  // O CAMPO É `integration_result` (nome da coluna na trilha append-only), NUNCA `result`.
  // Ler o nome errado devolvia `undefined` ⇒ `recorded:false` ⇒ a retomada tentava integrar de novo
  // e o candidate, já integrado, era classificado como STALE. Defeito real medido em 2026-10-02:
  // silenciava exatamente a proteção contra reaplicar um patch duas vezes.
  const result = String(match.integration_result || '').toUpperCase();
  return { recorded: result === 'INTEGRATED' || result === 'ALREADY_INTEGRATED', record: match };
}

/**
 * A missão pode declarar GREEN sobre a fonte que ela mesma construiu?
 *
 * Só se a fonte existe, não está em conflito, e o commit final da fonte é conhecido — o artifact
 * candidato da missão é o `missionCurrentCommit`, não a main.
 */
function assessMissionCandidateExport({ sourceState = null, currentCommit = null, baseCommit = null } = {}) {
  const state = String(sourceState || '').toUpperCase();
  const commit = String(currentCommit || '').trim();
  const base = String(baseCommit || '').trim();

  if (!commit) {
    return { exportable: false, code: 'MISSION_SOURCE_NOT_MATERIALIZED', reason: 'fonte da missão sem commit corrente — não há candidate a exportar' };
  }
  if (state === 'CONFLICT') {
    return { exportable: false, code: 'MISSION_SOURCE_IN_CONFLICT', reason: 'fonte da missão em conflito de integração — resolva antes de exportar o candidate' };
  }
  if (commit === base) {
    // Nenhuma integração aconteceu: o candidate da missão é igual à base. Legítimo, mas declarado.
    return { exportable: true, code: 'MISSION_SOURCE_UNCHANGED', reason: 'nenhuma integração alterou a fonte — o candidate da missão coincide com a base', commit };
  }
  return { exportable: true, code: null, reason: 'fonte da missão íntegra e isolada — candidate exportável para promoção', commit };
}

module.exports = {
  MISSION_SOURCE_STATES,
  INTEGRATION_RESULTS,
  INTEGRATION_TYPES,
  MISSION_BRANCH_PREFIX,
  buildIntegrationBranchName,
  isMissionBranch,
  isForbiddenSourceRef,
  buildIntegrationKey,
  classifyCandidateStaleness,
  assessIntegrationPreconditions,
  planSourceAdvance,
  isIntegrationAlreadyRecorded,
  assessMissionCandidateExport,
};
