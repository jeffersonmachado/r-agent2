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
  'DIVERGENCE',        // a branch está num commit que NENHUM intent/receipt explica
  'RECOVERY_REQUIRED', // estado inconsistente (ex.: banco à frente do git) que exige reconciliação
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

/**
 * Tipos de integração (bug fix usa o MESMO caminho da task — não há caminho privilegiado).
 *
 * `MISSION_SOURCE_INITIALIZATION` é o tipo do intent que AUTORIZA a criação da branch de fonte de
 * uma missão. DEFEITO QUE ELE ELIMINA (2026-10-03): a inicialização fazia `git branch` e SÓ DEPOIS
 * persistia a missão. Um processo morto entre as duas operações deixava uma branch de missão no
 * repositório que NENHUM registro autorizava — e o boot seguinte a classificava como divergência
 * (tamper) ou, pior, a adotava. Reutiliza o MESMO mecanismo de IntegrationIntent (tabela, fases,
 * chave única) em vez de criar um subsistema paralelo.
 */
const INTEGRATION_TYPES = Object.freeze(['TASK_CANDIDATE', 'BUG_FIX_CANDIDATE', 'MISSION_SOURCE_INITIALIZATION']);

/** Tipo de intent que autoriza a criação da branch de fonte (não tem task: a identidade é a missão). */
const INITIALIZATION_INTEGRATION_TYPE = 'MISSION_SOURCE_INITIALIZATION';

/**
 * FASES DURÁVEIS de uma integração (IntegrationIntent).
 *
 * DEFEITO QUE ESTE VOCABULÁRIO ELIMINA (confirmado no código em 2026-10-03): o avanço da fonte
 * executava `git update-ref` ANTES de persistir qualquer coisa, e o registro da trilha era escrito
 * só no fim. A janela real era:
 *
 *   git update-ref OK  →  PROCESSO MORRE  →  DB ainda no commit anterior  →  receipt inexistente
 *
 * Nessa janela não havia NADA no banco que explicasse a branch ter avançado: a retomada caía em
 * `CONCURRENT_SOURCE_UPDATE` ou `STALE_CANDIDATE`, e a mesma operação podia ou travar ou ser
 * reaplicada. Agora a intenção é persistida ANTES de tocar na ref git, e cada efeito é confirmado
 * numa transição de fase. A janela deixa de existir: qualquer morte é reconciliável a partir do
 * intent que já está no banco.
 */
const INTEGRATION_STATUSES = Object.freeze([
  'PREPARED',          // intent persistido; a ref git ainda NÃO foi tocada
  'GIT_APPLIED',       // `git update-ref` confirmado; o DB ainda não foi atualizado
  'DB_APPLIED',        // CAS do banco confirmado; o receipt/evidência final ainda não foi gravado
  'COMMITTED',         // estado terminal de sucesso: git + banco + receipt coerentes
  'CONFLICT',          // estado terminal: conflito explícito, exige resolução humana/task própria
  'ABORTED',           // estado terminal: operação abandonada de forma deliberada e auditável
  'RECOVERY_REQUIRED', // não terminal: estado divergente que exige reconciliação determinística
]);

/** Estados terminais: não são varridos pela reconciliação de boot. */
const TERMINAL_INTEGRATION_STATUSES = Object.freeze(['COMMITTED', 'CONFLICT', 'ABORTED']);

/** A fase é terminal (nenhum efeito futuro pendente)? */
function isTerminalIntegrationStatus(status) {
  return TERMINAL_INTEGRATION_STATUSES.includes(String(status || '').trim());
}

/**
 * Desfechos possíveis de uma reconciliação de intent.
 *
 * Vocabulário FECHADO: o chamador decide por código, nunca por texto. `PROCEED` é o único desfecho
 * que autoriza reaplicar o efeito; todos os outros são estados seguros que NÃO reaplicam nada.
 */
const INTEGRATION_RECONCILIATIONS = Object.freeze([
  'PROCEED',                // nada foi aplicado ainda: a operação pode seguir (retry seguro)
  'FINISH_DB',              // o git já está no candidate; falta só o CAS do banco
  'COMMIT_RECEIPT',         // git e banco já no candidate; falta só finalizar metadata/receipt
  'NOOP_ALREADY_COMMITTED', // já terminal: repetir a operação é proibido (idempotência)
  'DIVERGENCE',             // branch não explicada por nenhum intent/receipt: NÃO adotar
  'DB_AHEAD_OF_GIT',        // banco à frente da ref: estado impossível por construção → recovery
  'BLOCKED_REQUIRES_REPAIR',// não terminal e não reconciliável automaticamente
]);

/**
 * Uma branch commit é EXPLICADA quando existe um intent autoritativo que a justifica.
 *
 * `commits explicados` = o commit esperado (base) + todos os `mission_commit_after` já registrados
 * como INTEGRATED na trilha. Um commit da branch que não esteja nessa lista foi escrito por fora do
 * caminho auditável (push manual, rebase, force, outro worktree) e NÃO pode ser adotado.
 */
function isBranchCommitExplained({ branchCommit, expectedMissionCommit = null, explainedCommits = [] } = {}) {
  const commit = String(branchCommit || '').trim();
  if (commit === '') return false;
  const expected = String(expectedMissionCommit || '').trim();
  if (expected !== '' && commit === expected) return true;
  return (Array.isArray(explainedCommits) ? explainedCommits : [])
    .map((c) => String(c || '').trim())
    .filter(Boolean)
    .includes(commit);
}

/**
 * Decide se o HEAD da branch de missão pode ser ADOTADO como commit corrente da fonte.
 *
 * REGRA (elimina o defeito "branch existe → adotar HEAD"): a adoção só é permitida quando o commit
 * é explicado — é o próprio commit esperado, ou é o `mission_commit_after` de uma integração
 * registrada. Qualquer outro commit produz `MISSION_SOURCE_DIVERGENCE`, e o serviço NÃO adota,
 * NÃO continua tasks e NÃO promove.
 */
function classifyBranchAdoption({ branchCommit, expectedMissionCommit = null, explainedCommits = [] } = {}) {
  const commit = String(branchCommit || '').trim();
  const expected = String(expectedMissionCommit || '').trim();

  if (commit === '') {
    return { adopt: true, code: null, reason: 'branch ainda não existe: nada a adotar, materializar a partir da base', divergence: false };
  }
  if (commit === expected) {
    return { adopt: true, code: null, reason: 'branch no commit esperado pela missão', divergence: false };
  }
  if (isBranchCommitExplained({ branchCommit: commit, expectedMissionCommit: expected, explainedCommits })) {
    return { adopt: true, code: null, reason: `branch no commit ${commit.slice(0, 12)} explicado por uma integração registrada`, divergence: false };
  }
  return {
    adopt: false,
    code: 'MISSION_SOURCE_DIVERGENCE',
    divergence: true,
    reason: `branch em ${commit.slice(0, 12)} sem intent/receipt que explique o avanço (esperado ${expected === '' ? '(ausente)' : expected.slice(0, 12)}) — adoção recusada`,
  };
}

/**
 * Matriz DETERMINÍSTICA de reconciliação (fase do intent × ref git × commit do banco).
 *
 * Sem improviso e sem heurística: cada combinação tem exatamente um desfecho. É esta função — pura,
 * sem I/O — que o serviço consulta ao retomar após um crash, de modo que a decisão possa ser
 * provada por teste sem tocar em git nem em banco.
 */
function classifyIntegrationReconciliation({
  status,
  branchCommit = null,
  dbCommit = null,
  expectedMissionCommit = null,
  candidateCommit = null,
} = {}) {
  const phase = String(status || '').trim();
  const branch = String(branchCommit || '').trim();
  const db = String(dbCommit || '').trim();
  const expected = String(expectedMissionCommit || '').trim();
  const candidate = String(candidateCommit || '').trim();

  if (isTerminalIntegrationStatus(phase)) {
    return { outcome: 'NOOP_ALREADY_COMMITTED', code: null, reason: `intent já terminal em ${phase} — repetir o efeito é proibido`, reapply: false };
  }

  // Banco à frente do git: por construção o git é aplicado ANTES do banco, então isto só ocorre com
  // mutação externa do banco. Não é reconciliável em silêncio.
  if (db !== '' && db === candidate && branch !== candidate) {
    return { outcome: 'DB_AHEAD_OF_GIT', code: 'MISSION_SOURCE_DB_AHEAD_OF_GIT', reason: 'banco aponta para o candidate mas a ref git não — estado impossível por construção, exige reparo', reapply: false };
  }

  // Nada aplicado: intent PREPARED, branch na base esperada, banco na base esperada → retry seguro.
  if (branch === expected && (db === expected || db === '')) {
    return { outcome: 'PROCEED', code: null, reason: 'intent persistido e nenhum efeito aplicado — retry seguro', reapply: true };
  }

  // Git aplicado, banco atrás: completar o CAS do banco de forma determinística (sem reaplicar git).
  if (branch === candidate && (db === expected || db === '')) {
    return { outcome: 'FINISH_DB', code: null, reason: 'git já no candidate (efeito autorizado pelo intent) — completar o CAS do banco', reapply: false };
  }

  // Git e banco no candidate: só falta o receipt/evidência final.
  if (branch === candidate && db === candidate) {
    return { outcome: 'COMMIT_RECEIPT', code: null, reason: 'git e banco já no candidate — finalizar metadata/receipt sem reaplicar git', reapply: false };
  }

  // Branch em commit que nenhum intent explica: divergência.
  if (branch !== '' && branch !== expected && branch !== candidate) {
    return { outcome: 'DIVERGENCE', code: 'MISSION_SOURCE_DIVERGENCE', reason: `branch em ${branch.slice(0, 12)} não explicada pelo intent (esperado ${expected.slice(0, 12) || '(ausente)'} / candidate ${candidate.slice(0, 12) || '(ausente)'})`, reapply: false };
  }

  return { outcome: 'BLOCKED_REQUIRES_REPAIR', code: 'MISSION_SOURCE_RECOVERY_REQUIRED', reason: `combinação não reconciliável automaticamente (fase=${phase}, branch=${branch.slice(0, 12) || '-'}, db=${db.slice(0, 12) || '-'})`, reapply: false };
}


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
 * Chave de idempotência da INICIALIZAÇÃO da fonte de uma missão.
 *
 * A identidade do efeito aqui é a MISSÃO (não há task): existe no máximo UMA inicialização
 * autorizada por missão. A unicidade da chave no banco é o CAS que impede dois workers de criarem
 * duas branches de fonte concorrentes para a mesma missão.
 */
function buildInitializationKey({ missionId }) {
  const id = String(missionId || '').trim();
  if (id === '') {
    throw Object.assign(new Error('initializationKey exige missionId'), { code: 'MISSION_SOURCE_ID_REQUIRED' });
  }
  return `mission-source-init:${id}`;
}

/**
 * A branch de fonte pode ser RECRIADA no commit corrente da missão?
 *
 * DEFEITO QUE ESTA DECISÃO ELIMINA (2026-10-03): quando a branch de fonte era apagada (gc, prune,
 * limpeza manual), `ensureMissionSource` caía no caminho de criação e recriava a fonte a partir da
 * ORIGEM (`main`, M0) — a missão voltava para trás e perdia TODAS as integrações, sem nenhum erro.
 * O resultado observado era o bug "reaparecer": a source voltara a ser a main.
 *
 * A recriação só é legítima quando a PROVENIÊNCIA prova que o commit corrente é autoritativo:
 *   - o commit corrente É a base (nenhuma integração aconteceu) ⇒ recriar na base;
 *   - ou o commit corrente é o `missionCommitAfter` de uma integração INTEGRADA registrada
 *     (receipt) ⇒ recriar nele.
 * Nos demais casos não se inventa source: `MISSION_SOURCE_RECOVERY_REQUIRED`.
 */
function classifyBranchDeletionRecovery({
  missionCurrentCommit = null,
  missionBaseCommit = null,
  provenanceCommits = [],
} = {}) {
  const current = String(missionCurrentCommit || '').trim();
  const base = String(missionBaseCommit || '').trim();
  const proven = (Array.isArray(provenanceCommits) ? provenanceCommits : [])
    .map((c) => String(c || '').trim()).filter(Boolean);

  if (current === '') {
    return {
      recoverable: false,
      code: 'MISSION_SOURCE_RECOVERY_REQUIRED',
      reason: 'a branch de fonte foi apagada e a missão não registra commit corrente — não há source autoritativa a recriar',
    };
  }
  if (base !== '' && current === base) {
    return {
      recoverable: true,
      commit: current,
      code: 'MISSION_SOURCE_REANCHORED_TO_BASE',
      reason: `branch apagada: nenhuma integração havia acontecido — recriada no commit base ${current.slice(0, 12)} (NUNCA a origem/main)`,
    };
  }
  if (proven.includes(current)) {
    return {
      recoverable: true,
      commit: current,
      code: null,
      reason: `branch apagada: recriada no commit autoritativo ${current.slice(0, 12)}, provado por receipt de integração registrado`,
    };
  }
  return {
    recoverable: false,
    code: 'MISSION_SOURCE_RECOVERY_REQUIRED',
    reason: `branch de fonte apagada e o commit corrente ${current.slice(0, 12)} não é provado por receipt/integration — recriar seria inventar source (voltar para a main é proibido)`,
  };
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

/**
 * Disposição determinística de um candidate STALE.
 *
 * DEFEITO QUE ESTA POLÍTICA ELIMINA (confirmado no código em 2026-10-03): um stale candidate — que é
 * um problema de COORDENAÇÃO DE FONTE — caía em `hookMissionFailure` com `source=EXCEPTION`, era
 * classificado como `BUG` por `inferCategory` e `requiresApplicationFix(true)` abria uma fix task
 * de aplicação. Ou seja: o sistema tratava "a fonte avançou enquanto você codava" como "existe um
 * bug no produto", e ainda gastava um ciclo autônomo inteiro de coder+review+regressão nisso.
 *
 * Stale por padrão NÃO é bug de aplicação: é `SOURCE_STALE` com replan obrigatório.
 *
 * @returns {{disposition:string, requiresReplan:boolean, createsApplicationBug:boolean, strategy:string, code:string, reason:string}}
 */
function classifyStaleCandidateDisposition({
  candidateBaseCommit = null,
  missionCurrentCommit = null,
  reapplyConflicts = false,
} = {}) {
  const staleness = classifyCandidateStaleness({ candidateBaseCommit, missionCurrentCommit });
  if (!staleness.stale) {
    return {
      disposition: 'APPLICABLE',
      requiresReplan: false,
      createsApplicationBug: false,
      strategy: 'INTEGRATE_DIRECTLY',
      code: null,
      reason: 'candidate derivado do commit corrente — segue o caminho normal de integração',
    };
  }

  // Reaplicação conflitou: não mascarar. Vira trabalho EXPLÍCITO de replan/reanchor.
  if (reapplyConflicts) {
    return {
      disposition: 'REPLAN_REQUIRED',
      requiresReplan: true,
      createsApplicationBug: false,
      strategy: 'CREATE_REPLAN_TASK',
      code: 'MISSION_SOURCE_REPLAN_REQUIRED',
      reason: 'reaplicação automática do patch sobre a fonte atual conflitou — exige task de replan/reanchor explícita (nunca resolver em silêncio)',
    };
  }

  return {
    disposition: 'SOURCE_STALE',
    requiresReplan: true,
    createsApplicationBug: false,
    strategy: 'REANCHOR_AND_REAPPLY',
    code: 'STALE_CANDIDATE',
    reason: 'a fonte da missão avançou desde a base do candidate — reancorar na fonte corrente e reaplicar o patch; NÃO é bug de aplicação',
  };
}

/**
 * PROVENIÊNCIA DA INTEGRAÇÃO — um candidate nasce de uma task GENÉRICA ou de uma task criada
 * para corrigir um finding da Bug Autonomous Loop.
 *
 * DEFEITO ELIMINADO (2026-10-03): o runtime de promoção chamava a integração com o tipo FIXO
 * `TASK_CANDIDATE` e sem `findingId`, embora `integrateTaskCandidate` já aceitasse o parâmetro e a
 * tabela já tivesse as colunas `finding_id`/`integration_type`. Um candidate nascido de um bug
 * encontrado autonomamente era assim integrado como trabalho genérico: a cadeia
 * finding → task → candidate → integração ficava IRRECUPERÁVEL depois, e não havia como responder
 * "que bug este commit corrige?". O tipo tem de ser HONESTO, nunca presumido.
 *
 * Função pura: recebe o finding (ou null) e devolve exatamente o que o runtime deve persistir.
 */
function resolveIntegrationProvenance(finding = null) {
  const hasFinding = Boolean(finding && finding.id);
  if (!hasFinding) {
    return {
      integrationType: INTEGRATION_TYPES[0],
      findingId: null,
      isBugFix: false,
      evidence: {},
    };
  }
  return {
    integrationType: INTEGRATION_TYPES[1],
    findingId: finding.id,
    isBugFix: true,
    // Contexto do finding vai para a EVIDÊNCIA da integração: severidade/categoria explicam POR QUE
    // o candidate foi aceito, e o fingerprint liga a integração ao defeito canônico observado.
    evidence: {
      findingId: finding.id,
      findingSeverity: finding.severity || null,
      findingCategory: finding.category || null,
      findingFingerprint: finding.fingerprint || null,
      findingStatus: finding.status || null,
    },
  };
}

/**
 * FALHA DA CAMADA DE FONTE ≠ BUG DE APLICAÇÃO.
 *
 * DEFEITO ELIMINADO (2026-10-03): o hook de falha de missão abria finding com `source:'EXCEPTION'`
 * para QUALQUER não-GREEN. `inferCategory` mapeia EXCEPTION → BUG e `requiresApplicationFix('BUG')`
 * é verdadeiro, então "a fonte da missão avançou enquanto a task codava" virava fix task de
 * APLICAÇÃO — um ciclo inteiro de coder+review+regressão gasto em algo que não é defeito do produto.
 * `classifyStaleCandidateDisposition` já descrevia exatamente isto e nunca foi ligada ao hook.
 *
 * O prefixo `MISSION_SOURCE_` é, por construção, vocabulário da própria camada de fonte: nenhum
 * código com esse prefixo significa "o produto tem defeito". Os dois códigos sem prefixo são
 * igualmente de fonte, e não de produto.
 *
 * CONSERVADOR DE PROPÓSITO: `PRECONDITION_FAILED` fica FORA. É um wrapper que também carrega
 * condições de QUALIDADE do trabalho (sem test run, sem review, sem regressão) — tratá-lo como
 * "não é problema de código" silenciaria trabalho que precisa acontecer de verdade.
 */
const SOURCE_FAILURE_CODES = Object.freeze([
  'STALE_CANDIDATE',
  'CONCURRENT_MISSION_SOURCE_UPDATE',
]);

/** Códigos com prefixo de fonte que NÃO são falha (no-op/duplicidade) — não podem pedir replan. */
const SOURCE_NON_FAILURE_CODES = Object.freeze([
  'MISSION_SOURCE_UNCHANGED',
  'ALREADY_INTEGRATED',
]);

function classifySourceFailure({
  reasonCode = null,
  candidateBaseCommit = null,
  missionCurrentCommit = null,
  reapplyConflicts = false,
} = {}) {
  const code = typeof reasonCode === 'string' ? reasonCode.trim() : '';
  const isSourceFailure = code !== ''
    && !SOURCE_NON_FAILURE_CODES.includes(code)
    && (code.startsWith('MISSION_SOURCE_') || SOURCE_FAILURE_CODES.includes(code));

  if (!isSourceFailure) {
    return {
      isSourceFailure: false,
      disposition: null,
      requiresReplan: false,
      createsApplicationBug: true,
      strategy: null,
      category: null,
      code: code || null,
      reason: code
        ? `código ${code} não é falha da camada de fonte — segue o caminho normal`
        : 'sem código de falha declarado — não é possível afirmar que a origem é a fonte da missão',
    };
  }

  // Commits conhecidos ⇒ a decisão de stale é DELEGADA à função pura que já existe, nunca a um
  // segundo classificador em paralelo.
  if (candidateBaseCommit || missionCurrentCommit) {
    const stale = classifyStaleCandidateDisposition({
      candidateBaseCommit,
      missionCurrentCommit,
      reapplyConflicts,
    });
    if (stale.requiresReplan) {
      return { ...stale, isSourceFailure: true, category: 'MISSION_SOURCE', code: stale.code || code };
    }
  }

  // Sem commits conhecidos, o PRÓPRIO CÓDIGO é a autoridade sobre qual condição ocorreu — ele foi
  // emitido por quem tinha o dado em mãos. `STALE_CANDIDATE` significa stale (reancorar e
  // reaplicar); conflito na reaplicação e replan explícito escalam para task de replan. Nos dois
  // casos `requiresReplan` é verdadeiro: nenhuma das duas condições se resolve com código de produto.
  const disposition = (code === 'STALE_CANDIDATE' && reapplyConflicts !== true)
    ? 'SOURCE_STALE'
    : 'REPLAN_REQUIRED';
  const strategy = disposition === 'SOURCE_STALE' ? 'REANCHOR_AND_REAPPLY' : 'CREATE_REPLAN_TASK';

  return {
    isSourceFailure: true,
    disposition,
    requiresReplan: true,
    createsApplicationBug: false,
    strategy,
    category: 'MISSION_SOURCE',
    code,
    reason: disposition === 'SOURCE_STALE'
      ? `a fonte da missão avançou desde a base do candidate (${code}) — reancorar e reaplicar o patch; NÃO é bug de aplicação`
      : `a fonte da missão não aceitou o candidate (${code}) — exige replan/reancoragem, não correção de código de aplicação`,
  };
}

/**
 * POLÍTICA DE REPLAN DE FONTE — LIMITADA, e a decisão é PURA.
 *
 * DEFEITO ELIMINADO (2026-10-03): `classifySourceFailure` já devolvia `requiresReplan: true` e
 * `strategy: REANCHOR_AND_REAPPLY`, mas NINGUÉM consumia isso para AGIR. Como `MISSION_SOURCE` está
 * em `NON_APPLICATION_CATEGORIES`, nenhuma fix task de aplicação era aberta — e nada replanejava.
 * Resultado medido: a task ficava `READY_FOR_PROMOTION` com `reasonCode=STALE_CANDIDATE`, a missão
 * seguia `EXECUTING` e NENHUMA atividade acontecia. A classificação estava certa; o comportamento
 * não existia.
 *
 * O replan REUSA o caminho canônico já provado (`resumeOriginalMission`: task substituta ancorada no
 * `missionCurrentCommit` + execução pelo Router) — nenhum executor de rebase paralelo. O que esta
 * função acrescenta é o CONTROLE: quantas vezes já se replanejou e quando PARAR.
 *
 * Sem o limite, "stale → substituta → stale → substituta" é laço infinito (um avanço de fonte que
 * acontece a cada execução reancora para sempre). Com o limite, o esgotamento é um estado DECLARADO
 * (`MISSION_SOURCE_REPLAN_EXHAUSTED`) que exige decisão humana — nunca silêncio.
 *
 * Módulo PURO: sem I/O, sem relógio. Toda decisão é determinística e auditável.
 *
 * @returns {{action:string, attempt:number|null, maxAttempts:number, code:string|null, reason:string}}
 */
const SOURCE_REPLAN_POLICY = Object.freeze({
  // 2 = uma reaplicação automática + uma segunda tentativa após novo avanço de fonte. Além disso o
  // problema deixou de ser coordenação e passou a ser sistemático: exige gente.
  maxAttempts: 2,
});

function planSourceReplan({
  requiresReplan = false,
  disposition = null,
  attempts = 0,
  maxAttempts = SOURCE_REPLAN_POLICY.maxAttempts,
  reapplyConflicts = false,
} = {}) {
  const limit = Number.isFinite(Number(maxAttempts)) && Number(maxAttempts) > 0
    ? Number(maxAttempts)
    : SOURCE_REPLAN_POLICY.maxAttempts;
  const done = Number.isFinite(Number(attempts)) && Number(attempts) > 0 ? Number(attempts) : 0;

  if (!requiresReplan) {
    return {
      action: 'NOT_APPLICABLE',
      attempt: null,
      maxAttempts: limit,
      code: null,
      reason: 'não é falha de fonte que exija replan — caminho normal de aplicação',
    };
  }

  // CONFLITO não se resolve reaplicando: reaplicar de novo produziria o mesmo conflito e mascararia
  // o problema atrás de um contador. Vira trabalho EXPLÍCITO (task de resolução), declarado.
  if (reapplyConflicts === true || String(disposition || '') === 'REPLAN_REQUIRED') {
    return {
      action: 'CONFLICT_TASK',
      attempt: done,
      maxAttempts: limit,
      code: 'MISSION_SOURCE_REPLAN_CONFLICT',
      reason: 'a reaplicação do patch sobre a fonte atual conflitou — exige task de resolução explícita; reaplicar de novo só repetiria o conflito',
    };
  }

  if (done >= limit) {
    return {
      action: 'BLOCKED_MAX_ATTEMPTS',
      attempt: done,
      maxAttempts: limit,
      code: 'MISSION_SOURCE_REPLAN_EXHAUSTED',
      reason: `replan de fonte esgotado após ${done} tentativa(s): a fonte continua avançando mais rápido do que a execução. Exige decisão humana — insistir seria laço infinito.`,
    };
  }

  return {
    action: 'REPLAN',
    attempt: done + 1,
    maxAttempts: limit,
    code: null,
    reason: `replan de fonte autorizado (tentativa ${done + 1} de ${limit}): nova task sobre o commit CORRENTE da fonte, reaplicando a mudança pretendida`,
  };
}

module.exports = {
  MISSION_SOURCE_STATES,
  INTEGRATION_RESULTS,
  INTEGRATION_TYPES,
  INTEGRATION_STATUSES,
  TERMINAL_INTEGRATION_STATUSES,
  INTEGRATION_RECONCILIATIONS,
  INITIALIZATION_INTEGRATION_TYPE,
  buildInitializationKey,
  classifyBranchDeletionRecovery,
  isTerminalIntegrationStatus,
  isBranchCommitExplained,
  classifyBranchAdoption,
  classifyIntegrationReconciliation,
  classifyStaleCandidateDisposition,
  resolveIntegrationProvenance,
  classifySourceFailure,
  SOURCE_REPLAN_POLICY,
  planSourceReplan,
  SOURCE_FAILURE_CODES,
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
