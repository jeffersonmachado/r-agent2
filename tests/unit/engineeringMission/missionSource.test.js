'use strict';

/**
 * tests/unit/engineeringMission/missionSource.test.js
 *
 * Prova as invariantes da FONTE DE CÓDIGO DE UMA ENGINEERING MISSION no nível da decisão (módulo
 * puro, sem I/O). O valor aqui é que cada invariante é DEMONSTRADA nos dois sentidos: o que deve
 * passar passa, e o que deve ser recusado é recusado com o código correto — uma guarda que nunca
 * recusa nada não é uma guarda.
 */

const source = require('../../../engine/engineeringMission/missionSource');

describe('missionSource — fonte isolada por missão', () => {
  describe('nome da branch de integração', () => {
    test('deriva de missionId e NUNCA é uma ref global compartilhada', () => {
      const a = source.buildIntegrationBranchName('mission-a');
      const b = source.buildIntegrationBranchName('mission-b');
      expect(a).toBe('engineering/missions/mission-a');
      expect(b).toBe('engineering/missions/mission-b');
      expect(a).not.toBe(b);
    });

    test('sem missionId não inventa uma ref — falha explícita', () => {
      expect(() => source.buildIntegrationBranchName('')).toThrow(/missionId é obrigatório/);
      expect(() => source.buildIntegrationBranchName(null)).toThrow(/missionId é obrigatório/);
    });

    test('reconhece branch de missão e proíbe main/master/HEAD como fonte', () => {
      expect(source.isMissionBranch('engineering/missions/x')).toBe(true);
      expect(source.isMissionBranch('main')).toBe(false);
      expect(source.isForbiddenSourceRef('main')).toBe(true);
      expect(source.isForbiddenSourceRef('master')).toBe(true);
      expect(source.isForbiddenSourceRef('HEAD')).toBe(true);
      expect(source.isForbiddenSourceRef('engineering/missions/x')).toBe(false);
    });
  });

  describe('chave de idempotência', () => {
    test('é derivada da tríade (missionId, taskId, candidateCommit)', () => {
      const key = source.buildIntegrationKey({ missionId: 'm1', taskId: 't1', candidateCommit: 'abc' });
      expect(key).toBe('mission-integration:m1:t1:abc');
    });

    test('tríade incompleta falha — não existe chave parcial', () => {
      expect(() => source.buildIntegrationKey({ missionId: 'm1', taskId: 't1' })).toThrow(/exige missionId, taskId e candidateCommit/);
      expect(() => source.buildIntegrationKey({ missionId: 'm1', candidateCommit: 'abc' })).toThrow(/exige/);
    });

    test('mesma tríade ⇒ mesma chave (é o que torna a retomada idempotente)', () => {
      const a = source.buildIntegrationKey({ missionId: 'm', taskId: 't', candidateCommit: 'c' });
      const b = source.buildIntegrationKey({ missionId: 'm', taskId: 't', candidateCommit: 'c' });
      expect(a).toBe(b);
    });
  });

  describe('obsolescência do candidate (stale)', () => {
    test('candidate derivado do commit corrente NÃO é stale', () => {
      const verdict = source.classifyCandidateStaleness({ candidateBaseCommit: 'aaa', missionCurrentCommit: 'aaa' });
      expect(verdict.stale).toBe(false);
      expect(verdict.code).toBeNull();
    });

    test('candidate derivado de base antiga É stale — e explica por quê', () => {
      const verdict = source.classifyCandidateStaleness({ candidateBaseCommit: 'aaa', missionCurrentCommit: 'bbb' });
      expect(verdict.stale).toBe(true);
      expect(verdict.code).toBe('STALE_CANDIDATE');
      expect(verdict.reason).toMatch(/rebase\/revalidação necessária, aplicação cega é proibida/);
    });

    test('commit desconhecido não vira permissão — é stale por falta de prova', () => {
      const verdict = source.classifyCandidateStaleness({ candidateBaseCommit: null, missionCurrentCommit: 'bbb' });
      expect(verdict.stale).toBe(true);
      expect(verdict.code).toBe('MISSION_SOURCE_COMMIT_UNKNOWN');
    });
  });

  describe('pré-condições de integração', () => {
    const full = {
      candidateGreen: true,
      hasTestRun: true,
      reviewVerdict: 'APPROVE',
      regressionStatus: 'PASS',
      ownershipValid: true,
      candidateIntegrityOk: true,
    };

    test('com todas as evidências objetivas, integra', () => {
      const verdict = source.assessIntegrationPreconditions(full);
      expect(verdict.eligible).toBe(true);
      expect(verdict.missing).toEqual([]);
    });

    test('coder terminar NÃO é autoridade: sem review aprovado não integra', () => {
      const verdict = source.assessIntegrationPreconditions({ ...full, reviewVerdict: null });
      expect(verdict.eligible).toBe(false);
      expect(verdict.missing).toContain('NO_REVIEW');
    });

    test('review REPROVADO não integra (evidência contrária, não ausência)', () => {
      const verdict = source.assessIntegrationPreconditions({ ...full, reviewVerdict: 'REJECT' });
      expect(verdict.eligible).toBe(false);
      expect(verdict.missing).toContain('REVIEW_NOT_APPROVED');
    });

    test('regressão não-PASS não integra', () => {
      const verdict = source.assessIntegrationPreconditions({ ...full, regressionStatus: 'FAIL' });
      expect(verdict.eligible).toBe(false);
      expect(verdict.missing).toContain('REGRESSION_NOT_PASS');
    });

    test('posse perdida não integra (quem perdeu o lease não integra)', () => {
      const verdict = source.assessIntegrationPreconditions({ ...full, ownershipValid: false });
      expect(verdict.eligible).toBe(false);
      expect(verdict.missing).toContain('OWNERSHIP_NOT_HELD');
    });

    test('sem teste executado não integra', () => {
      const verdict = source.assessIntegrationPreconditions({ ...full, hasTestRun: false });
      expect(verdict.eligible).toBe(false);
      expect(verdict.missing).toContain('NO_TEST_RUN');
    });

    test('candidate que não chegou a GREEN não integra', () => {
      const verdict = source.assessIntegrationPreconditions({ ...full, candidateGreen: false });
      expect(verdict.eligible).toBe(false);
      expect(verdict.missing).toContain('CANDIDATE_NOT_GREEN');
    });

    test('taskStatus GREEN continua aceito (caminho de retomada pós-crash)', () => {
      const verdict = source.assessIntegrationPreconditions({ ...full, candidateGreen: false, taskStatus: 'GREEN' });
      expect(verdict.eligible).toBe(true);
    });

    test('acumula TODAS as faltas, não só a primeira', () => {
      const verdict = source.assessIntegrationPreconditions({});
      expect(verdict.eligible).toBe(false);
      expect(verdict.missing).toEqual(expect.arrayContaining([
        'CANDIDATE_NOT_GREEN', 'NO_TEST_RUN', 'NO_REVIEW', 'NO_REGRESSION', 'OWNERSHIP_NOT_HELD', 'CANDIDATE_INTEGRITY_FAILED',
      ]));
    });
  });

  describe('avanço do commit corrente (CAS)', () => {
    test('CAS satisfeito autoriza o avanço', () => {
      const plan = source.planSourceAdvance({ expectedCommit: 'm1', currentCommit: 'm1', newCommit: 'm2' });
      expect(plan.allowed).toBe(true);
      expect(plan.fromCommit).toBe('m1');
      expect(plan.toCommit).toBe('m2');
    });

    test('avanço concorrente perde — nunca sobrescreve o trabalho do outro', () => {
      const plan = source.planSourceAdvance({ expectedCommit: 'm1', currentCommit: 'm2', newCommit: 'm3' });
      expect(plan.allowed).toBe(false);
      expect(plan.code).toBe('CONCURRENT_MISSION_SOURCE_UPDATE');
    });

    test('fence divergente perde mesmo com commit igual (posse mudou de dono)', () => {
      const plan = source.planSourceAdvance({ expectedCommit: 'm1', currentCommit: 'm1', newCommit: 'm2', expectedFence: 3, currentFence: 4 });
      expect(plan.allowed).toBe(false);
      expect(plan.code).toBe('CONCURRENT_MISSION_SOURCE_UPDATE');
    });

    test('avançar para o commit em que já se está é no-op idempotente, não conflito', () => {
      const plan = source.planSourceAdvance({ expectedCommit: 'm1', currentCommit: 'm1', newCommit: 'm1' });
      expect(plan.allowed).toBe(false);
      expect(plan.code).toBe('ALREADY_INTEGRATED');
    });

    test('sem commit de destino não há avanço a autorizar', () => {
      const plan = source.planSourceAdvance({ expectedCommit: 'm1', currentCommit: 'm1', newCommit: '' });
      expect(plan.allowed).toBe(false);
      expect(plan.code).toBe('MISSION_SOURCE_NEW_COMMIT_REQUIRED');
    });

    test('commit desconhecido não vira permissão silenciosa', () => {
      const plan = source.planSourceAdvance({ expectedCommit: '', currentCommit: '', newCommit: 'm2' });
      expect(plan.allowed).toBe(false);
      expect(plan.code).toBe('MISSION_SOURCE_COMMIT_UNKNOWN');
    });
  });

  describe('idempotência da retomada (crash-safe)', () => {
    const key = source.buildIntegrationKey({ missionId: 'm', taskId: 't', candidateCommit: 'c' });

    test('tríade já INTEGRATED é reconhecida — o patch NÃO é reaplicado', () => {
      const verdict = source.isIntegrationAlreadyRecorded({
        existingRecords: [{ integration_key: key, integration_result: 'INTEGRATED', mission_commit_after: 'm9' }],
        integrationKey: key,
      });
      expect(verdict.recorded).toBe(true);
      expect(verdict.record.mission_commit_after).toBe('m9');
    });

    test('REGRESSÃO — o campo é `integration_result`: ler `result` desligaria a proteção em silêncio', () => {
      // Defeito real medido em 2026-10-02: o código lia `record.result`, que NÃO existe na trilha
      // (a coluna é `integration_result`). O efeito era `recorded:false` sempre, e a retomada
      // reclassificava um candidate já integrado como STALE. Um registro com o campo certo tem de
      // ser reconhecido; um com o campo errado NÃO pode passar por reconhecido.
      const correct = source.isIntegrationAlreadyRecorded({
        existingRecords: [{ integration_key: key, integration_result: 'INTEGRATED' }],
        integrationKey: key,
      });
      expect(correct.recorded).toBe(true);

      const wrongFieldName = source.isIntegrationAlreadyRecorded({
        existingRecords: [{ integration_key: key, result: 'INTEGRATED' }],
        integrationKey: key,
      });
      expect(wrongFieldName.recorded).toBe(false);
    });

    test('registro de RECUSA não bloqueia uma tentativa futura legítima', () => {
      const verdict = source.isIntegrationAlreadyRecorded({
        existingRecords: [{ integration_key: key, integration_result: 'STALE_CANDIDATE' }],
        integrationKey: key,
      });
      expect(verdict.recorded).toBe(false);
    });

    test('tríade diferente não é confundida com a já integrada', () => {
      const other = source.buildIntegrationKey({ missionId: 'm', taskId: 't2', candidateCommit: 'c' });
      const verdict = source.isIntegrationAlreadyRecorded({
        existingRecords: [{ integration_key: key, integration_result: 'INTEGRATED' }],
        integrationKey: other,
      });
      expect(verdict.recorded).toBe(false);
    });
  });

  describe('exportação do candidate da missão', () => {
    test('fonte íntegra e avançada é exportável (o candidate é o commit da fonte, não a main)', () => {
      const verdict = source.assessMissionCandidateExport({ sourceState: 'READY', currentCommit: 'm3', baseCommit: 'm0' });
      expect(verdict.exportable).toBe(true);
      expect(verdict.commit).toBe('m3');
    });

    test('fonte em CONFLITO não exporta', () => {
      const verdict = source.assessMissionCandidateExport({ sourceState: 'CONFLICT', currentCommit: 'm3', baseCommit: 'm0' });
      expect(verdict.exportable).toBe(false);
      expect(verdict.code).toBe('MISSION_SOURCE_IN_CONFLICT');
    });

    test('fonte sem commit não exporta', () => {
      const verdict = source.assessMissionCandidateExport({ sourceState: 'PENDING', currentCommit: null, baseCommit: null });
      expect(verdict.exportable).toBe(false);
      expect(verdict.code).toBe('MISSION_SOURCE_NOT_MATERIALIZED');
    });

    test('missão sem nenhuma integração continua exportável, mas DECLARADA', () => {
      const verdict = source.assessMissionCandidateExport({ sourceState: 'READY', currentCommit: 'm0', baseCommit: 'm0' });
      expect(verdict.exportable).toBe(true);
      expect(verdict.code).toBe('MISSION_SOURCE_UNCHANGED');
    });
  });
});
