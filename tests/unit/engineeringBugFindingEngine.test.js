'use strict';

/**
 * Motor PURO do ciclo de bug (BUG-02, BUG-04, BUG-05, BUG-07, BUG-12, BUG-13, BUG-14, BUG-15,
 * BUG-16, BUG-17, BUG-18, BUG-19, BUG-20).
 *
 * Nenhum I/O, nenhum banco: aqui se prova que as REGRAS estão certas. A prova de que as regras
 * governam o runtime vive nos testes de serviço e no E2E — este arquivo não substitui nenhum deles.
 */

const engine = require('../../engine/engineeringMission/bugFinding');

describe('bugFinding engine — identidade e deduplicação (BUG-05, BUG-18)', () => {
  const base = {
    errorType: 'TypeError',
    stack: 'Error: boom\n    at foo (/srv/app/a/x.js:10:5)\n    at bar (/srv/app/b/y.js:22:1)',
    subsystem: 'ENGINEER_ROUTER',
    test: 'tests/unit/x.test.js',
  };

  test('BUG-05: fingerprint é estável para a MESMA falha e ignora linha/caminho/timestamp', () => {
    const a = engine.computeFingerprint(base);
    const b = engine.computeFingerprint({
      ...base,
      stack: 'Error: boom\n    at foo (/outro/root/a/x.js:987:5)\n    at bar (/outro/root/b/y.js:1234:1)',
    });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
  });

  test('BUG-05: falhas DIFERENTES não colidem (subsistema diferente muda a identidade)', () => {
    const a = engine.computeFingerprint(base);
    const b = engine.computeFingerprint({ ...base, subsystem: 'RELEASE_PIPELINE' });
    expect(b).not.toBe(a);
  });

  test('BUG-18: o fingerprint permite recuperar a ocorrência anterior (mesma identidade, nova execução)', () => {
    const first = engine.computeFingerprint({ ...base, executionId: 'run-aaa', at: '2026-01-01T00:00:00Z' });
    const later = engine.computeFingerprint({ ...base, executionId: 'run-bbb', at: '2026-09-29T10:00:00Z' });
    expect(later).toBe(first);
  });

  test('sem nenhum identificador não há fingerprint (não se inventa identidade)', () => {
    expect(engine.computeFingerprint({})).toBeNull();
  });
});

describe('bugFinding engine — confirmação (BUG-02, BUG-03, BUG-04, BUG-12, BUG-14)', () => {
  test('BUG-02: suspeita de LLM NUNCA confirma, mesmo com evidência anexada', () => {
    for (const basis of ['LLM_SUSPICION', 'HEURISTIC', 'TIMEOUT_ONLY']) {
      const result = engine.assessConfirmation({ confirmationBasis: basis, evidenceRefs: [{ type: 'x' }], source: 'META_REVIEW' });
      expect(result.confirmed).toBe(false);
      expect(result.code).toBe('INSUFFICIENT_CONFIRMATION_BASIS');
    }
  });

  test('BUG-02: sem evidência persistida, nem base objetiva confirma', () => {
    const result = engine.assessConfirmation({ confirmationBasis: 'REPRODUCED_TEST_FAILURE', evidenceRefs: [] });
    expect(result.confirmed).toBe(false);
    expect(result.reason).toMatch(/ao menos uma evidência/);
  });

  test('BUG-03: teste de reprodução que falha conforme esperado CONFIRMA (base objetiva)', () => {
    const plan = engine.buildReproductionPlan({ reproduction: { command: 'npx jest tests/x.test.js', expect: 'FAIL' } });
    const evaluation = engine.evaluateReproduction({
      plan,
      run: { allPass: false, outcome: 'FAIL', results: [{ command: plan.command, status: 'FAIL', exitCode: 1 }] },
    });
    expect(evaluation.outcome).toBe('REPRODUCED');
    expect(evaluation.basis).toBe('REPRODUCED_TEST_FAILURE');
    expect(engine.assessConfirmation({ confirmationBasis: evaluation.basis, evidenceRefs: [{ type: 'COMMAND_RUN', ref: 'r' }] }).confirmed).toBe(true);
  });

  test('BUG-04: reprodução que passa é NOT_REPRODUCED (não vira bug)', () => {
    const plan = engine.buildReproductionPlan({ reproduction: { command: 'npx jest tests/x.test.js' } });
    const evaluation = engine.evaluateReproduction({ plan, run: { allPass: true, outcome: 'PASS', results: [] } });
    expect(evaluation.outcome).toBe('NOT_REPRODUCED');
  });

  test('BUG-14: invariante determinístico violado é base objetiva de confirmação', () => {
    const plan = engine.buildReproductionPlan({ reproduction: { invariants: [{ id: 'TIMEOUT_ARCHITECTURE_CHILD_DIRECTION' }] } });
    const evaluation = engine.evaluateReproduction({
      plan,
      invariantResults: [{ id: 'TIMEOUT_ARCHITECTURE_CHILD_DIRECTION', violated: true, detail: 'TIMEOUT_ARCHITECTURE=NO_GO com FINAL_GOVERNANCE=GO' }],
    });
    expect(evaluation.outcome).toBe('REPRODUCED');
    expect(evaluation.basis).toBe('DETERMINISTIC_INVARIANT_VIOLATION');
  });

  test('BUG-14: invariante satisfeito NÃO confirma (não se inventa bug de governança)', () => {
    const plan = engine.buildReproductionPlan({ reproduction: { invariants: [{ id: 'X' }] } });
    const evaluation = engine.evaluateReproduction({ plan, invariantResults: [{ id: 'X', violated: false }] });
    expect(evaluation.outcome).toBe('NOT_REPRODUCED');
  });

  test('BUG-12: TIMEOUT isolado na reprodução é INCONCLUSIVE, nunca confirmado', () => {
    const plan = engine.buildReproductionPlan({ reproduction: { command: 'npx jest tests/x.test.js' } });
    const evaluation = engine.evaluateReproduction({ plan, run: { allPass: false, outcome: 'TIMEOUT', results: [] } });
    expect(evaluation.outcome).toBe('INCONCLUSIVE');
    expect(evaluation.code).toBe('REPRODUCTION_INCONCLUSIVE');
  });

  test('BUG-12: INFRA_ERROR também é inconclusivo (não rodou ≠ reprovou)', () => {
    const plan = engine.buildReproductionPlan({ reproduction: { command: 'npx jest tests/x.test.js' } });
    expect(engine.evaluateReproduction({ plan, run: { outcome: 'INFRA_ERROR' } }).outcome).toBe('INCONCLUSIVE');
  });

  test('sem plano de reprodução o resultado é declarado, nunca presumido', () => {
    const plan = engine.buildReproductionPlan({});
    expect(plan.kind).toBe('UNAVAILABLE');
    expect(engine.evaluateReproduction({ plan }).outcome).toBe('INCONCLUSIVE');
  });
});

describe('bugFinding engine — classificação (BUG-15, BUG-16, severidade)', () => {
  test('BUG-15: escrita obsoleta é CONCURRENCY e CRITICAL (stale writer sobrescreve o dono)', () => {
    const assessment = engine.assessSeverity({ source: 'STALE_WRITE', title: 'escrita obsoleta sobrescreveu o dono atual' });
    expect(assessment.category).toBe('CONCURRENCY');
    expect(assessment.severity).toBe('CRITICAL');
    expect(assessment.signals).toContain('STALE_WRITER_OVERWRITE');
  });

  test('severidade vem de sinais objetivos; a sugestão do modelo é apenas advisory', () => {
    const assessment = engine.assessSeverity({ source: 'UNIT_TEST', title: 'falha qualquer', severityHint: 'CRITICAL' });
    expect(assessment.severity).toBe('MEDIUM');
    expect(assessment.advisorySeverity).toBe('CRITICAL');
    expect(assessment.advisoryOnly).toBe(true);
  });

  test('BUG-14 (governança): GO com filho NO_GO é CRÍTICO sem depender de texto', () => {
    const assessment = engine.assessSeverity({ source: 'GOVERNANCE_INCONSISTENCY', invariantOutcome: 'GO', childOutcome: 'NO_GO' });
    expect(assessment.category).toBe('GOVERNANCE');
    expect(assessment.severity).toBe('CRITICAL');
  });

  test('BUG-16: security exige reviewer de segurança e independente', () => {
    const caps = engine.deriveCapabilities({ category: 'SECURITY', severity: 'HIGH' });
    expect(caps.reviewer).toContain('SECURITY_REVIEW');
    expect(caps.coder).toContain('CODING');
    expect(caps.requiresIndependentReviewer).toBe(true);
    expect(caps.requiresSecurityReviewer).toBe(true);
  });

  test('BUG-16: bug de banco exige capability DATABASE; frontend exige FRONTEND', () => {
    expect(engine.deriveCapabilities({ category: 'DATA', severity: 'MEDIUM' }).coder).toContain('DATABASE');
    expect(engine.deriveCapabilities({ category: 'BUG', severity: 'LOW', paths: ['frontend/src/App.jsx'] }).coder).toContain('FRONTEND');
  });

  test('category decision determina o tipo de task e a elevação por severidade', () => {
    expect(engine.deriveTaskType({ category: 'BUG', severity: 'LOW' })).toBe('BUG_FIX');
    expect(engine.deriveTaskType({ category: 'BUG', severity: 'CRITICAL' })).toBe('COMPLEX_BUG_FIX');
    expect(engine.deriveTaskType({ category: 'GOVERNANCE', severity: 'MEDIUM' })).toBe('GOVERNANCE');
  });

  test('INFRA/PROVIDER/CONFIGURATION não geram patch de aplicação', () => {
    expect(engine.requiresApplicationFix('INFRA')).toBe(false);
    expect(engine.requiresApplicationFix('PROVIDER')).toBe(false);
    expect(engine.requiresApplicationFix('CONFIGURATION')).toBe(false);
    expect(engine.requiresApplicationFix('BUG')).toBe(true);
    expect(engine.requiresApplicationFix('DATA')).toBe(true);
  });

  test('um pico de exceção é SUSPECTED (categoria sugerida), nunca confirmação', () => {
    const detections = engine.detectAnomalies({ metrics: { operationsTotal: 100, exceptions: 40 } });
    expect(detections).toHaveLength(1);
    expect(detections[0].code).toBe('EXCEPTION_RATE_SPIKE');
    expect(detections[0].categoryHint).toBe('BUG');
    expect(detections[0].signals).toEqual([]);
  });

  test('BUG-12 (telemetria): timeout individual não vira anomalia; repetido vira candidato TIMEOUT', () => {
    expect(engine.detectAnomalies({ metrics: { timeouts: 1 } })).toHaveLength(0);
    const repeated = engine.detectAnomalies({ metrics: { timeouts: 4 } });
    expect(repeated).toHaveLength(1);
    expect(repeated[0].categoryHint).toBe('TIMEOUT');
    expect(repeated[0].categoryHint).not.toBe('BUG');
  });

  test('BUG-15 (telemetria): stale write detectado carrega o sinal crítico', () => {
    const [detection] = engine.detectAnomalies({ metrics: { staleWrites: 1 } });
    expect(detection.code).toBe('STALE_WRITE');
    expect(detection.categoryHint).toBe('CONCURRENCY');
    expect(detection.signals).toContain('STALE_WRITER_OVERWRITE');
  });

  test('BUG-13: NO_PROGRESS é diagnóstico com fase/operação/último progresso', () => {
    const [detection] = engine.detectAnomalies({
      metrics: { noProgress: true, phase: 'REGRESSION', operation: 'checkRegression', lastProgressSignal: 'command_completed', providerStatus: 'HEALTHY', childStatus: 'RUNNING' },
    });
    expect(detection.code).toBe('NO_PROGRESS');
    expect(detection.diagnosticOnly).toBe(true);
    expect(detection.metric.phase).toBe('REGRESSION');
    expect(detection.metric.operation).toBe('checkRegression');
    expect(detection.metric.providerStatus).toBe('HEALTHY');
  });

  test('crash loop e falha de regressão repetida são detectados por padrão, não por evento único', () => {
    expect(engine.detectAnomalies({ metrics: { restarts: 1 } })).toHaveLength(0);
    expect(engine.detectAnomalies({ metrics: { restarts: 3 } })[0].code).toBe('CRASH_LOOP');
    expect(engine.detectAnomalies({ metrics: { regressionFailureStreak: 2 } })[0].code).toBe('REPEATED_REGRESSION_FAILURE');
  });
});

describe('bugFinding engine — ciclo de vida (BUG-03, BUG-04, BUG-07, BUG-08, BUG-09, BUG-17)', () => {
  test('BUG-04/transições: máquina fail-closed recusa transição não declarada', () => {
    expect(engine.canTransition('SUSPECTED', 'CONFIRMED').allowed).toBe(true);
    expect(engine.canTransition('SUSPECTED', 'FIXED').allowed).toBe(false);
    expect(engine.canTransition('FIXED', 'REGRESSION_VALIDATED').allowed).toBe(true);
    expect(engine.canTransition('SUSPECTED', 'REGRESSION_VALIDATED').allowed).toBe(false);
    expect(() => engine.assertTransition('DUPLICATE', 'FIXING')).toThrow(/transição não permitida/);
  });

  test('BUG-08: FIXED exige reprodução verde + testes direcionados + parecer aprovado', () => {
    const finding = { status: 'FIXING' };
    expect(engine.canDeclareFixed({ finding, reproductionPassed: true, targetedTestsPassed: true, reviewPassed: false }).code)
      .toBe('FIX_WITHOUT_REVIEW');
    expect(engine.canDeclareFixed({ finding, reproductionPassed: false, targetedTestsPassed: true, reviewPassed: true }).code)
      .toBe('FIX_WITHOUT_REPRODUCTION');
    expect(engine.canDeclareFixed({ finding, reproductionPassed: true, targetedTestsPassed: true, reviewPassed: true }).allowed).toBe(true);
  });

  test('patch aplicado NÃO é fix (estado CONFIRMED não pode pular para FIXED)', () => {
    const result = engine.canDeclareFixed({ finding: { status: 'SUSPECTED' }, reproductionPassed: true, targetedTestsPassed: true, reviewPassed: true });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('INVALID_FINDING_TRANSITION');
  });

  test('BUG-09: regressão exige execução real e só depois de FIXED', () => {
    expect(engine.canDeclareRegressionValidated({ finding: { status: 'FIXING' }, regressionRuns: [{ id: 'r1', passed: true }] }).code)
      .toBe('REGRESSION_WITHOUT_FIX');
    expect(engine.canDeclareRegressionValidated({ finding: { status: 'FIXED' }, regressionRuns: [] }).code)
      .toBe('REGRESSION_EVIDENCE_MISSING');
    expect(engine.canDeclareRegressionValidated({ finding: { status: 'FIXED' }, regressionRuns: [{ id: 'r1', passed: false }] }).allowed)
      .toBe(false);
    expect(engine.canDeclareRegressionValidated({ finding: { status: 'FIXED' }, regressionRuns: [{ id: 'r1', passed: true }] }).allowed)
      .toBe(true);
  });

  test('BUG-07: só CONFIRMED/FIXING geram task de correção', () => {
    expect(engine.canGenerateFixTask({ status: 'SUSPECTED' }).allowed).toBe(false);
    expect(engine.canGenerateFixTask({ status: 'CONFIRMED' }).allowed).toBe(true);
    expect(engine.canGenerateFixTask({ status: 'CONFIRMED', duplicateOf: 'x' }).allowed).toBe(false);
  });

  test('BUG-08: contrato da task referencia o finding, a missão e as evidências', () => {
    const contract = engine.buildFixTaskContract({
      finding: {
        id: 'f-1', missionId: 'm-1', missionVersion: 2, missionSpecHash: 'h', title: 'bug', category: 'BUG', severity: 'HIGH',
        evidenceRefs: [{ type: 'TEST_REPORT', ref: 'jest:x' }], reproduction: { command: 'npx jest tests/x.test.js' },
        affectedFiles: ['api/services/x.js'],
      },
    });
    expect(contract.title).toContain('f-1');
    expect(contract.findingId).toBe('f-1');
    expect(contract.missionId).toBe('m-1');
    expect(contract.missionVersion).toBe(2);
    expect(contract.evidenceRefs).toHaveLength(1);
    expect(contract.testCommands).toContain('npx jest tests/x.test.js');
    expect(contract.allowedPaths).toEqual(['api/services/x.js']);
    expect(contract.releaseBlocker).toBe(true);
  });

  // DEFEITO MEDIDO (2026-10-08, fix task d84bdab8 / INC-3B): o contrato lia
  // `finding.expectedBehavior`/`observedBehavior`/`rootCause`, mas `getFinding` devolve as linhas
  // CRUAS do Sequelize (`expected_behavior`, `observed_behavior`, `root_cause`). Os três campos
  // existiam no banco e a task nasceu com o objective de UMA linha — "Corrigir finding X na causa
  // raiz, não no sintoma" — sem comportamento esperado, observado nem causa raiz. O teste BUG-08
  // acima não pegava porque passava um objeto já em camelCase: media a forma do chamador, não a
  // forma que o produtor real entrega.
  test('BUG-08b: contrato lê a LINHA CRUA do banco (snake_case), não só o objeto normalizado', () => {
    const linhaCrua = {
      id: 'f-2',
      title: 'bug',
      category: 'BUG',
      severity: 'MEDIUM',
      expected_behavior: 'a fachada deve produzir efeito explicito',
      observed_behavior: 'retorna applied:false',
      root_cause: 'le a decisao por uma chave que o nucleo nao produz',
      reproduction: { command: 'npx jest tests/y.test.js' },
      mission_id: 'm-2',
      mission_version: 7,
      mission_spec_hash: 'h2',
      affected_files: ['api/services/y.js'],
      affected_subsystems: ['ENGINEERING'],
      evidence_refs: [{ type: 'TEST_REPORT', ref: 'tr-1' }],
      acceptance_criteria: ['caso real verde'],
      self_modification: true,
    };
    const contract = engine.buildFixTaskContract({ finding: linhaCrua });

    expect(contract.objective.split('\n')).toHaveLength(4);
    expect(contract.objective).toContain('Comportamento esperado: a fachada deve produzir efeito explicito');
    expect(contract.objective).toContain('Comportamento observado: retorna applied:false');
    expect(contract.objective).toContain('Causa raiz: le a decisao por uma chave que o nucleo nao produz');
    expect(contract.missionId).toBe('m-2');
    expect(contract.missionVersion).toBe(7);
    expect(contract.missionSpecHash).toBe('h2');
    expect(contract.evidenceRefs).toHaveLength(1);
    expect(contract.acceptanceCriteria).toContain('caso real verde');
    expect(contract.selfModification).toBe(true);
    expect(contract.testCommands).toContain('npx jest tests/y.test.js');
  });

  test('BUG-08c: camelCase e snake_case produzem o MESMO contrato (nenhuma grafia vira campo ausente)', () => {
    const base = { id: 'f-3', title: 'bug', category: 'BUG', severity: 'MEDIUM' };
    const camel = engine.buildFixTaskContract({
      finding: { ...base, expectedBehavior: 'X', observedBehavior: 'Y', rootCause: 'Z', missionId: 'm-3', affectedFiles: ['a.js'] },
    });
    const snake = engine.buildFixTaskContract({
      finding: { ...base, expected_behavior: 'X', observed_behavior: 'Y', root_cause: 'Z', mission_id: 'm-3', affected_files: ['a.js'] },
    });

    expect(snake.objective).toBe(camel.objective);
    expect(snake.missionId).toBe(camel.missionId);
    expect(snake.allowedPaths).toEqual(camel.allowedPaths);
  });

  test('BUG-08d: campo realmente AUSENTE continua ausente (a tolerância não inventa contexto)', () => {
    const contract = engine.buildFixTaskContract({
      finding: { id: 'f-4', title: 'bug', category: 'BUG', severity: 'LOW' },
    });

    expect(contract.objective.split('\n')).toHaveLength(1);
    expect(contract.objective).not.toContain('Comportamento esperado');
    expect(contract.objective).not.toContain('Causa raiz');
    expect(contract.missionId).toBeNull();
  });

  test('BUG-17: reincidência escala severidade e incrementa a contagem (sem criar estado paralelo)', () => {
    expect(engine.isRecurrence('FIXED')).toBe(true);
    expect(engine.isRecurrence('CLOSED')).toBe(true);
    expect(engine.isRecurrence('CONFIRMED')).toBe(false);
    const recurrence = engine.applyRecurrence({ previousStatus: 'CLOSED', severity: 'MEDIUM', recurrenceCount: 1 });
    expect(recurrence.status).toBe('CONFIRMED');
    expect(recurrence.severity).toBe('HIGH');
    expect(recurrence.recurrenceCount).toBe(2);
  });

  test('gate: fechar sem reprodução/evidência/regressão é detectado como greenwashing', () => {
    const violations = engine.detectGreenwashing({
      finding: { status: 'CLOSED', evidenceRefs: [], regressionTestRefs: [] },
      events: [{ type: 'STATUS_CHANGED', payload: { to: 'CONFIRMED' } }],
    });
    const codes = violations.map((v) => v.code);
    expect(codes).toContain('CLOSED_WITHOUT_REPRODUCTION');
    expect(codes).toContain('CLOSED_WITHOUT_EVIDENCE');
    expect(codes).toContain('REGRESSION_NOT_EXECUTED');
  });

  test('gate: ciclo honesto não é acusado de greenwashing', () => {
    const violations = engine.detectGreenwashing({
      finding: { status: 'CLOSED', evidenceRefs: [{ type: 'TEST_REPORT', ref: 'x' }], regressionTestRefs: ['cmd'] },
      events: [{ type: 'STATUS_CHANGED', payload: { to: 'CONFIRMED' } }, { type: 'REPRODUCTION_ATTEMPTED' }, { type: 'FIX_APPLIED' }, { type: 'REGRESSION_VALIDATED' }],
    });
    expect(violations).toEqual([]);
  });
});

describe('bugFinding engine — self-modification (BUG-19, BUG-20)', () => {
  test('BUG-19: fix que toca governança/router eleva o risco e exige aprovação humana', () => {
    const assessment = engine.assessSelfModification({
      paths: ['scripts/governance/validate-bug-autonomous-loop.js'],
      category: 'GOVERNANCE',
      severity: 'HIGH',
    });
    expect(assessment.selfModification).toBe(true);
    expect(assessment.humanApprovalRequired).toBe(true);
    expect(assessment.autoApprovalForbidden).toBe(true);
  });

  test('BUG-19: subsistema sensível também caracteriza self-modification (sem path)', () => {
    const assessment = engine.assessSelfModification({ subsystems: ['ANTI_GREENWASHING'], severity: 'LOW' });
    expect(assessment.selfModification).toBe(true);
    expect(assessment.autoApprovalForbidden).toBe(true);
  });

  test('BUG-20: policy NUNCA autoriza autoaprovação de self-modification HIGH/CRITICAL', () => {
    const policy = { allowSelfModificationAutoApproval: true };
    const critical = engine.assessSelfModification({ paths: ['governance/x.js'], category: 'GOVERNANCE', severity: 'CRITICAL', policy });
    expect(critical.autoApprovalForbidden).toBe(true);
    expect(critical.humanApprovalRequired).toBe(true);
    // Autorização explícita de policy só vale para severidade não crítica.
    const low = engine.assessSelfModification({ paths: ['governance/x.js'], category: 'GOVERNANCE', severity: 'LOW', policy });
    expect(low.autoApprovalForbidden).toBe(false);
  });

  test('BUG-20: sem policy, a autoaprovação é proibida por omissão', () => {
    const assessment = engine.assessSelfModification({ paths: ['engine/engineeringRouter/constants.js'], severity: 'MEDIUM' });
    expect(assessment.autoApprovalForbidden).toBe(true);
  });

  test('finding comum não é self-modification', () => {
    const assessment = engine.assessSelfModification({ paths: ['api/services/caseService.js'], category: 'BUG', severity: 'LOW' });
    expect(assessment.selfModification).toBe(false);
    expect(assessment.humanApprovalRequired).toBe(false);
  });

  test('BUG-20: baseline de regras detecta enfraquecimento (gate removido / limiar reduzido)', () => {
    const baseline = engine.captureRuleBaseline({
      mandatoryGates: ['ANTI_GREENWASHING', 'REQUIRED_TESTS'],
      testManifest: ['tests/unit/x.test.js'],
      thresholds: { weightedCoverage: 84 },
    });
    const weakened = engine.diffRuleBaseline(baseline, {
      mandatoryGates: ['REQUIRED_TESTS'],
      testManifest: ['tests/unit/x.test.js'],
      thresholds: { weightedCoverage: 70 },
    });
    expect(weakened.changed).toBe(true);
    expect(weakened.mandatoryGates.removed).toContain('ANTI_GREENWASHING');
    expect(weakened.thresholdChanges[0]).toEqual({ key: 'weightedCoverage', from: 84, to: 70 });

    const unchanged = engine.diffRuleBaseline(baseline, {
      mandatoryGates: ['ANTI_GREENWASHING', 'REQUIRED_TESTS'],
      testManifest: ['tests/unit/x.test.js'],
      thresholds: { weightedCoverage: 84 },
    });
    expect(unchanged.changed).toBe(false);
  });

  test('PROTECTED_GOVERNANCE_BASELINE: arquivo de regra MODIFICADO (hash diferente) é violação', () => {
    const baseline = engine.captureRuleBaseline({
      files: { 'jest.config.cjs': 'aaa', 'config/journey-criticality.json': 'bbb' },
    });
    // Apagar o arquivo do baseline não muda hashes — o que muda é o hash do arquivo vivo.
    const tampered = engine.verifyRuleBaseline({
      baseline,
      current: { files: { 'jest.config.cjs': 'aaa', 'config/journey-criticality.json': 'CCC' } },
    });
    expect(tampered.ok).toBe(false);
    expect(tampered.code).toBe('GOVERNANCE_BASELINE_VIOLATION');
    expect(tampered.diff.files.modified).toEqual(['config/journey-criticality.json']);

    const intact = engine.verifyRuleBaseline({ baseline, current: { files: { 'jest.config.cjs': 'aaa', 'config/journey-criticality.json': 'bbb' } } });
    expect(intact.ok).toBe(true);
    expect(intact.code).toBeNull();

    // Remover o arquivo de regra também é violação (não só editar).
    const removed = engine.verifyRuleBaseline({ baseline, current: { files: { 'jest.config.cjs': 'aaa' } } });
    expect(removed.ok).toBe(false);
    expect(removed.diff.files.removed).toEqual(['config/journey-criticality.json']);

    // Sem baseline não há prova de integridade: fail-closed, nunca "assume que está ok".
    const unverified = engine.verifyRuleBaseline({ baseline: null, current: { files: {} } });
    expect(unverified.ok).toBe(false);
    expect(unverified.checked).toBe(false);
    expect(unverified.code).toBe('GOVERNANCE_BASELINE_UNVERIFIED');
  });

  test('HUMAN_SELF_MODIFICATION_APPROVAL: só humano autenticado tem autoridade de aval', () => {
    expect(engine.assessApprovalAuthority({ actor: 'humano@results', actorType: 'HUMAN' }).allowed).toBe(true);
    // Tipo ausente NÃO vira permissão (ausência de dado é ausência de autoridade).
    expect(engine.assessApprovalAuthority({ actor: 'humano@results' })).toMatchObject({ allowed: false, code: 'SELF_MODIFICATION_APPROVAL_ACTOR_NOT_HUMAN' });
    // Conta de serviço / worker / modelo nunca libera alteração das próprias regras.
    for (const actorType of ['SERVICE_ACCOUNT', 'SYSTEM', 'AUTOMATION', 'AGENT', 'WORKER', 'MODEL', 'LLM']) {
      expect(engine.assessApprovalAuthority({ actor: 'x@results', actorType })).toMatchObject({ allowed: false, code: 'SELF_MODIFICATION_APPROVAL_ACTOR_NOT_HUMAN' });
    }
    // Declarar-se HUMANO não basta quando a identidade se anuncia como automação.
    expect(engine.assessApprovalAuthority({ actor: 'SYSTEM:bug-worker', actorType: 'HUMAN' })).toMatchObject({ allowed: false, code: 'SELF_MODIFICATION_APPROVAL_ACTOR_NOT_HUMAN' });
    // Sem ator não há aval (nada de aprovação anônima).
    expect(engine.assessApprovalAuthority({ actor: null, actorType: 'HUMAN' })).toMatchObject({ allowed: false, code: 'ACTOR_REQUIRED' });
  });
});

describe('bugFinding engine — derivação automática de reprodução (AUTOMATIC_REPRODUCTION_DERIVATION)', () => {
  test('AUTOMATIC_REPRODUCTION_DERIVATION: deriva do TestRun que falhou na execução real', () => {
    const plan = engine.deriveReproductionPlan({
      task: { id: 'task-1', test_commands: [] },
      result: { status: 'FAILED' },
      testRuns: [{ command: 'npx jest tests/unit/y.test.js', outcome: 'FAIL', exitCode: 1, stdoutRef: 'reports/y.log' }],
      source: 'UNIT_TEST',
    });
    expect(plan.derived).toBe(true);
    expect(plan.strategy).toBe('TEST_FAILURE');
    expect(plan.command).toBe('npx jest tests/unit/y.test.js');
    expect(plan.expect).toBe('FAIL');
    expect(plan.evidence[0].type).toBe('TEST_REPORT');
  });

  test('AUTOMATIC_REPRODUCTION_DERIVATION: deriva do comando DECLARADO no contrato da task', () => {
    const plan = engine.deriveReproductionPlan({
      task: { id: 'task-2', test_commands: ['npx jest tests/unit/x.test.js'] },
      result: { status: 'FAILED' },
      source: 'UNIT_TEST',
    });
    expect(plan.derived).toBe(true);
    expect(plan.strategy).toBe('DECLARED_TEST_COMMAND');
    expect(plan.command).toBe('npx jest tests/unit/x.test.js');
  });

  test('AUTOMATIC_REPRODUCTION_DERIVATION: invariante de governança vira reprodução determinística', () => {
    const plan = engine.deriveReproductionPlan({ source: 'RELEASE_GATE', reasonCode: 'COVERAGE_GATE_FAILED' });
    expect(plan.derived).toBe(true);
    expect(plan.strategy).toBe('GOVERNANCE_INVARIANT');
    expect(plan.invariants).toEqual([{ id: 'COVERAGE_GATE_FAILED' }]);
  });

  test('AUTOMATIC_REPRODUCTION_DERIVATION: sem contexto, o MOTIVO é explícito — nada é inventado', () => {
    // Fonte de TESTE sem comando é DEFEITO do laço e o motivo diz exatamente isso...
    const fromTestSource = engine.deriveReproductionPlan({ source: 'UNIT_TEST', reasonCode: 'ALGO_INDETERMINADO' });
    expect(fromTestSource.derived).toBe(false);
    expect(fromTestSource.strategy).toBe('NONE');
    expect(fromTestSource.command).toBeNull();
    expect(fromTestSource.reason).toContain('falha de teste');
    expect(fromTestSource.reason).toMatch(/contexto de execução/i);

    // ...e fora de fonte de teste o motivo é a insuficiência de contexto geral.
    const fromOtherSource = engine.deriveReproductionPlan({ source: 'TELEMETRY_ANOMALY', reasonCode: 'ALGO_INDETERMINADO' });
    expect(fromOtherSource.derived).toBe(false);
    expect(fromOtherSource.command).toBeNull();
    expect(fromOtherSource.reason).toContain('contexto insuficiente');
  });

  test('AUTOMATIC_REPRODUCTION_DERIVATION: entradas nulas NÃO derrubam o observador de falhas', () => {
    // Regressão medida em 2026-09-30: `result: null` causava TypeError — o hook de detecção quebraria
    // exatamente quando há falha. A derivação é pura e precisa tolerar o que a execução não produziu.
    expect(() => engine.deriveReproductionPlan({ task: null, result: null, testRuns: null, regressionRuns: null })).not.toThrow();
    const plan = engine.deriveReproductionPlan({ task: null, result: null, testRuns: null, regressionRuns: null, source: 'UNIT_TEST' });
    expect(plan.derived).toBe(false);
    expect(plan.reason).toBeTruthy();
  });
});

describe('bugFinding engine — vocabulário único', () => {
  test('todos os estados declarados têm transições definidas e terminais coerentes', () => {
    for (const status of engine.FINDING_STATUSES) {
      expect(engine.FINDING_TRANSITIONS[status]).toBeDefined();
    }
    expect(engine.INDEPENDENT_REVIEW_SEVERITIES).toEqual(['HIGH', 'CRITICAL']);
    expect(engine.CONFIRMATION_BASES).not.toContain('LLM_SUSPICION');
    expect(engine.NON_CONFIRMATION_BASES).toContain('LLM_SUSPICION');
  });
});
