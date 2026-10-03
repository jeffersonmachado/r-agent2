'use strict';

/**
 * IntegrationIntent — camada PURA (decisão determinística).
 *
 * Cobre a matriz que a janela de crash exige, a regra de adoção de branch (rejeição do commit não
 * explicado) e a disposição de candidate stale. Nada aqui toca git ou banco: se a decisão estiver
 * certa, o I/O do serviço não tem como improvisar.
 */

const {
  INTEGRATION_STATUSES,
  TERMINAL_INTEGRATION_STATUSES,
  isTerminalIntegrationStatus,
  isBranchCommitExplained,
  classifyBranchAdoption,
  classifyIntegrationReconciliation,
  classifyStaleCandidateDisposition,
} = require('../../engine/engineeringMission/missionSource');

const A = 'a'.repeat(40); // base / esperado
const B = 'b'.repeat(40); // candidate
const X = 'c'.repeat(40); // commit desconhecido

describe('IntegrationIntent — máquina de fases', () => {
  it('declara as 7 fases do enunciado, incluindo RECOVERY_REQUIRED não-terminal', () => {
    expect(INTEGRATION_STATUSES).toEqual([
      'PREPARED', 'GIT_APPLIED', 'DB_APPLIED', 'COMMITTED', 'CONFLICT', 'ABORTED', 'RECOVERY_REQUIRED',
    ]);
    expect(TERMINAL_INTEGRATION_STATUSES).toEqual(['COMMITTED', 'CONFLICT', 'ABORTED']);
  });

  it('RECOVERY_REQUIRED não é terminal (precisa ser varrido pela reconciliação)', () => {
    expect(isTerminalIntegrationStatus('RECOVERY_REQUIRED')).toBe(false);
    expect(isTerminalIntegrationStatus('PREPARED')).toBe(false);
    expect(isTerminalIntegrationStatus('GIT_APPLIED')).toBe(false);
    expect(isTerminalIntegrationStatus('DB_APPLIED')).toBe(false);
    expect(isTerminalIntegrationStatus('COMMITTED')).toBe(true);
  });
});

describe('classifyIntegrationReconciliation — matriz determinística', () => {
  const base = { expectedMissionCommit: A, candidateCommit: B };

  it('PREPARED + branch=esperado + db=esperado → PROCEED (retry seguro, reaplica)', () => {
    const r = classifyIntegrationReconciliation({ ...base, status: 'PREPARED', branchCommit: A, dbCommit: A });
    expect(r.outcome).toBe('PROCEED');
    expect(r.reapply).toBe(true);
  });

  it('GIT_APPLIED + branch=candidate + db=esperado → FINISH_DB (NUNCA reaplica o git)', () => {
    const r = classifyIntegrationReconciliation({ ...base, status: 'GIT_APPLIED', branchCommit: B, dbCommit: A });
    expect(r.outcome).toBe('FINISH_DB');
    expect(r.reapply).toBe(false);
  });

  it('DB_APPLIED + branch=candidate + db=candidate → COMMIT_RECEIPT (sem reaplicar git)', () => {
    const r = classifyIntegrationReconciliation({ ...base, status: 'DB_APPLIED', branchCommit: B, dbCommit: B });
    expect(r.outcome).toBe('COMMIT_RECEIPT');
    expect(r.reapply).toBe(false);
  });

  it('branch em commit NÃO explicado → DIVERGENCE (não adota, não reaplica)', () => {
    const r = classifyIntegrationReconciliation({ ...base, status: 'PREPARED', branchCommit: X, dbCommit: A });
    expect(r.outcome).toBe('DIVERGENCE');
    expect(r.code).toBe('MISSION_SOURCE_DIVERGENCE');
    expect(r.reapply).toBe(false);
  });

  it('db=candidate com branch atrás → DB_AHEAD_OF_GIT (estado impossível por construção)', () => {
    const r = classifyIntegrationReconciliation({ ...base, status: 'GIT_APPLIED', branchCommit: A, dbCommit: B });
    expect(r.outcome).toBe('DB_AHEAD_OF_GIT');
    expect(r.reapply).toBe(false);
  });

  it('intent terminal → NOOP_ALREADY_COMMITTED (repetir o efeito é proibido)', () => {
    for (const status of TERMINAL_INTEGRATION_STATUSES) {
      const r = classifyIntegrationReconciliation({ ...base, status, branchCommit: B, dbCommit: B });
      expect(r.outcome).toBe('NOOP_ALREADY_COMMITTED');
      expect(r.reapply).toBe(false);
    }
  });

  it('controle negativo: NENHUM desfecho além de PROCEED autoriza reaplicar', () => {
    const cases = [
      ['GIT_APPLIED', B, A], ['DB_APPLIED', B, B], ['PREPARED', X, A],
      ['GIT_APPLIED', A, B], ['COMMITTED', B, B], ['RECOVERY_REQUIRED', X, X],
    ];
    for (const [status, branchCommit, dbCommit] of cases) {
      const r = classifyIntegrationReconciliation({ ...base, status, branchCommit, dbCommit });
      expect(r.outcome).not.toBe('PROCEED');
      expect(r.reapply).toBe(false);
    }
  });
});

describe('classifyBranchAdoption — commit não explicado nunca é adotado', () => {
  it('branch no commit esperado → adota', () => {
    const r = classifyBranchAdoption({ branchCommit: A, expectedMissionCommit: A, explainedCommits: [] });
    expect(r.adopt).toBe(true);
    expect(r.divergence).toBe(false);
  });

  it('branch explicada por integração registrada → adota', () => {
    const r = classifyBranchAdoption({ branchCommit: B, expectedMissionCommit: A, explainedCommits: [B] });
    expect(r.adopt).toBe(true);
    expect(r.divergence).toBe(false);
  });

  it('branch em commit arbitrário → MISSION_SOURCE_DIVERGENCE (o defeito real)', () => {
    const r = classifyBranchAdoption({ branchCommit: X, expectedMissionCommit: A, explainedCommits: [B] });
    expect(r.adopt).toBe(false);
    expect(r.code).toBe('MISSION_SOURCE_DIVERGENCE');
    expect(r.divergence).toBe(true);
  });

  it('branch inexistente → adota como vazio (materializa a partir da base)', () => {
    const r = classifyBranchAdoption({ branchCommit: null, expectedMissionCommit: A, explainedCommits: [] });
    expect(r.adopt).toBe(true);
    expect(r.divergence).toBe(false);
  });

  it('isBranchCommitExplained: base conta como explicado, estranho não', () => {
    expect(isBranchCommitExplained({ branchCommit: A, expectedMissionCommit: A, explainedCommits: [] })).toBe(true);
    expect(isBranchCommitExplained({ branchCommit: B, expectedMissionCommit: A, explainedCommits: [] })).toBe(false);
    expect(isBranchCommitExplained({ branchCommit: B, expectedMissionCommit: A, explainedCommits: [B] })).toBe(true);
    expect(isBranchCommitExplained({ branchCommit: '', expectedMissionCommit: A, explainedCommits: [B] })).toBe(false);
  });
});

describe('classifyStaleCandidateDisposition — stale NÃO vira bug de aplicação', () => {
  it('candidate derivado do commit corrente → APPLICABLE, integra direto', () => {
    const r = classifyStaleCandidateDisposition({ candidateBaseCommit: A, missionCurrentCommit: A });
    expect(r.disposition).toBe('APPLICABLE');
    expect(r.requiresReplan).toBe(false);
    expect(r.createsApplicationBug).toBe(false);
  });

  it('fonte avançou → SOURCE_STALE com replan, SEM abrir bug de aplicação', () => {
    const r = classifyStaleCandidateDisposition({ candidateBaseCommit: A, missionCurrentCommit: B });
    expect(r.disposition).toBe('SOURCE_STALE');
    expect(r.requiresReplan).toBe(true);
    expect(r.createsApplicationBug).toBe(false);
    expect(r.strategy).toBe('REANCHOR_AND_REAPPLY');
  });

  it('reaplicação conflitou → REPLAN_REQUIRED explícito (conflito nunca é mascarado)', () => {
    const r = classifyStaleCandidateDisposition({ candidateBaseCommit: A, missionCurrentCommit: B, reapplyConflicts: true });
    expect(r.disposition).toBe('REPLAN_REQUIRED');
    expect(r.strategy).toBe('CREATE_REPLAN_TASK');
    expect(r.createsApplicationBug).toBe(false);
  });

  it('controle negativo: em NENHUM cenário de stale a disposição abre bug de aplicação', () => {
    const scenarios = [
      { candidateBaseCommit: A, missionCurrentCommit: B },
      { candidateBaseCommit: A, missionCurrentCommit: B, reapplyConflicts: true },
      { candidateBaseCommit: null, missionCurrentCommit: B },
      { candidateBaseCommit: A, missionCurrentCommit: null },
    ];
    for (const s of scenarios) {
      expect(classifyStaleCandidateDisposition(s).createsApplicationBug).toBe(false);
    }
  });
});
