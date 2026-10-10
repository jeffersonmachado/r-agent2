'use strict';

/**
 * engine/engineeringMission/metaReview.js — Meta Reviewer (§23) executável.
 *
 * O Meta Reviewer NÃO tem autoridade final sobre GREEN: ele PRODUZ FINDINGS. A autoridade final é
 * composta por gates verificáveis. O que este módulo garante é que os findings são OBJETIVOS
 * (cada um aponta arquivo/linha/evidência) e que a lista de perguntas do §23 está coberta — com
 * `NOT_VERIFIABLE` explícito, nunca PASS por omissão, onde não há verificação possível.
 *
 * Perguntas do §23 que exigem julgamento semântico (mock substituindo funcionalidade real, código
 * morto, dependências desnecessárias) são reportadas como NOT_VERIFIABLE com o MECANISMO que as
 * tornaria verificáveis — nunca como aprovadas.
 *
 * Módulo puro (sem I/O).
 */

const { analyzePatch } = require('./diffAnalysis');
const { RISK_RANK } = require('./missionSpec');

const META_REVIEW_ENGINE_VERSION = '1.0.0';

const SEVERITY = Object.freeze({ BLOCKER: 'BLOCKER', REGRESSION: 'REGRESSION', POST_RELEASE: 'POST_RELEASE', INFO: 'INFO' });

/** Caminhos que uma missão NUNCA pode duplicar (infraestrutura já existente). */
const FORBIDDEN_DUPLICATION_PATTERNS = Object.freeze([
  { id: 'PARALLEL_PROVIDER_REGISTRY', re: /(^|\/)(engineeringProviderRegistry|providerRegistry)\.js$/, detail: 'registry de providers paralelo (fonte única é engine/aiProviderRegistry.js)' },
  { id: 'PARALLEL_STATE_MACHINE', re: /(^|\/)(mission|engineering)[A-Za-z]*StateMachine\.js$/, detail: 'state machine paralela (usar engine/engineeringRouter/stateMachine.js)' },
  { id: 'PARALLEL_EVIDENCE_STORE', re: /(^|\/)(evidenceStore|EvidenceStore)\.js$/, detail: 'evidence store paralelo (usar o Evidence Store de qa/coverage)' },
  { id: 'PARALLEL_TASK_STORE', re: /(^|\/)(engineeringTaskStore|taskStore)\.js$/, detail: 'task store paralelo (usar api/services/engineeringRouter/engineeringTaskService.js)' },
]);

/**
 * Gates que precisam existir e PASSAR para uma missão reivindicar GREEN.
 *
 * `promotion` entrou em 2026-10-10: o gate existia em `deriveGates` mas NÃO era
 * exigido — uma missão podia fechar GREEN sem que a promoção tivesse sido
 * verificada. O status `PROMOTED` só é gravado pelo Router DEPOIS de
 * `POST_PROMOTION_VERIFY` confirmar o candidato (`verified ? 'PROMOTED' :
 * 'READY_FOR_PROMOTION'`), então exigi-lo é exigir a verificação pós-promoção.
 */
const REQUIRED_GATES_FOR_GREEN = Object.freeze([
  'unit',
  'integration',
  'review',
  'regression',
  'governance',
  'promotion',
]);

function finding({ id, checkId, severity, status, title, detail, evidence = [] }) {
  return {
    id,
    checkId,
    severity,
    status, // PASS | FAIL | NOT_VERIFIABLE
    title,
    detail,
    evidence,
    blocksGreen: status === 'FAIL' && (severity === SEVERITY.BLOCKER || severity === SEVERITY.REGRESSION),
  };
}

function pass(id, checkId, severity, title, detail, evidence = []) {
  return finding({ id, checkId, severity, status: 'PASS', title, detail, evidence });
}

function fail(id, checkId, severity, title, detail, evidence = []) {
  return finding({ id, checkId, severity, status: 'FAIL', title, detail, evidence });
}

function notVerifiable(id, checkId, title, detail, mechanism) {
  return {
    ...finding({ id, checkId, severity: SEVERITY.INFO, status: 'NOT_VERIFIABLE', title, detail }),
    mechanism,
  };
}

function requirementTexts(list) {
  return (Array.isArray(list) ? list : []).map((r) => (typeof r === 'string' ? r : r && r.text)).filter(Boolean);
}

/**
 * @param {Object} bundle  ver docs/architecture/QWEN_COM_ENRIQUECIMENTO.md §Meta/Adversarial
 * @param {Object} [options]
 * @param {Object} [options.policy]
 * @param {string[]} [options.policy.internalEngineeringPaths] — caminhos DEVELOPMENT-only internos,
 *   isentos do check de scoping por tenant (nunca expostos à experiência do cliente)
 */
function runMetaReview(bundle = {}, options = {}) {
  const policy = options.policy || {};
  const internalPaths = policy.internalEngineeringPaths || ['api/services/engineeringMission/', 'api/services/engineeringRouter/', 'engine/engineeringMission/', 'engine/engineeringRouter/'];
  const mission = bundle.mission || {};
  const spec = bundle.spec || {};
  const approvals = Array.isArray(bundle.approvals) ? bundle.approvals : [];
  const versions = Array.isArray(bundle.versions) ? bundle.versions : [];
  const task = bundle.task || null;
  const attempts = Array.isArray(bundle.attempts) ? bundle.attempts : [];
  const testRuns = Array.isArray(bundle.testRuns) ? bundle.testRuns : [];
  const reviews = Array.isArray(bundle.reviews) ? bundle.reviews : [];
  const gates = Array.isArray(bundle.gates) ? bundle.gates : [];
  const claims = Array.isArray(bundle.claims) ? bundle.claims : [];
  const findings = [];

  const diffText = attempts.map((a) => a.patchDiff || '').filter(Boolean).join('\n');
  const fileContents = bundle.fileContents instanceof Map ? bundle.fileContents : new Map();
  const analysis = analyzePatch({ diffText, fileContents });
  const changedFiles = [...new Set([...(bundle.changedFiles || []), ...analysis.files])];

  // 1. O objetivo original foi realmente atendido?
  const approved = approvals.find((a) => ['APPROVED', 'AUTO_APPROVED'].includes(a.state));
  if (!approved) {
    findings.push(fail('MR-01', 'ORIGINAL_OBJECTIVE_ADDRESSED', SEVERITY.BLOCKER,
      'Objetivo original não tem execução autorizada', 'nenhuma aprovação vigente encontrada — sem aprovação não há base para afirmar que o objetivo foi atendido',
      approvals.map((a) => ({ state: a.state, specVersion: a.specVersion }))));
  } else if (task && task.status === 'GREEN' && spec.objective) {
    findings.push(pass('MR-01', 'ORIGINAL_OBJECTIVE_ADDRESSED', SEVERITY.BLOCKER,
      'Objetivo original atendido com execução GREEN', `spec v${spec.version} executada por task ${task.id} (${task.status})`,
      [{ taskId: task.id, specVersion: spec.version, objective: spec.objective }]));
  } else {
    findings.push(fail('MR-01', 'ORIGINAL_OBJECTIVE_ADDRESSED', SEVERITY.BLOCKER,
      'Objetivo não comprovadamente atendido', `task status=${task ? task.status : 'ausente'} — nenhuma evidência de conclusão do objetivo`,
      [{ taskStatus: task ? task.status : null }]));
  }

  // 2. A missão executada corresponde à MissionSpec aprovada?
  const specMatchesApproval = approved && approved.specVersion === spec.version && approved.specHash === spec.specHash;
  findings.push(specMatchesApproval
    ? pass('MR-02', 'EXECUTED_MATCHES_APPROVED_SPEC', SEVERITY.BLOCKER, 'Execução aderente à versão aprovada', `v${spec.version} · ${String(spec.specHash).slice(0, 12)}…`)
    : fail('MR-02', 'EXECUTED_MATCHES_APPROVED_SPEC', SEVERITY.BLOCKER,
      'Versão executada difere da aprovada',
      `aprovada v${approved ? approved.specVersion : '—'} (${approved ? String(approved.specHash).slice(0, 12) : '—'}…) vs corrente v${spec.version} (${String(spec.specHash).slice(0, 12)}…)`));

  // 3. Alguma alteração material ocorreu sem nova aprovação?
  const unapprovedVersions = versions.filter((v) => v.version > (approved ? approved.specVersion : 0));
  findings.push(unapprovedVersions.length === 0
    ? pass('MR-03', 'NO_MATERIAL_CHANGE_WITHOUT_APPROVAL', SEVERITY.BLOCKER, 'Nenhuma alteração pós-aprovação', `versões ≤ v${approved ? approved.specVersion : 0}`)
    : fail('MR-03', 'NO_MATERIAL_CHANGE_WITHOUT_APPROVAL', SEVERITY.BLOCKER,
      'Alteração material sem nova aprovação',
      `existem versões posteriores à aprovada sem aprovação própria: ${unapprovedVersions.map((v) => `v${v.version}(${v.materiality})`).join(', ')}`,
      unapprovedVersions.map((v) => ({ version: v.version, materiality: v.materiality, event: v.event }))));

  // 4. Critérios de aceite da spec chegaram ao contrato de execução?
  const specCriteria = requirementTexts(spec.acceptanceCriteria);
  const taskCriteria = new Set(requirementTexts(task ? task.acceptanceCriteria : []));
  const missingCriteria = specCriteria.filter((c) => !taskCriteria.has(c));
  if (!task) {
    findings.push(fail('MR-04', 'ACCEPTANCE_CRITERIA_PROPAGATED', SEVERITY.REGRESSION, 'Sem task para verificar critérios', 'missão sem EngineeringTask vinculada'));
  } else if (missingCriteria.length === 0) {
    findings.push(pass('MR-04', 'ACCEPTANCE_CRITERIA_PROPAGATED', SEVERITY.REGRESSION, 'Critérios de aceite propagados', `${specCriteria.length} critério(s) presentes no contrato de execução`));
  } else {
    findings.push(fail('MR-04', 'ACCEPTANCE_CRITERIA_PROPAGATED', SEVERITY.REGRESSION,
      'Critério de aceite não chegou à execução', `${missingCriteria.length} critério(s) ausentes do contrato da task`,
      missingCriteria.map((c) => ({ criterion: c }))));
  }

  // 5. Todos os gaps (requisitos derivados) têm evidência de tratamento?
  const requirementIds = (spec.derivedRequirements || []).map((r) => (typeof r === 'string' ? null : r.id)).filter(Boolean);
  const evidenceText = [
    ...testRuns.flatMap((t) => [t.command, t.stdoutExcerpt, t.stderrExcerpt]).filter(Boolean),
    ...gates.flatMap((g) => [g.id, JSON.stringify(g.evidence || '')]),
  ].join('\n');
  const uncovered = requirementIds.filter((id) => !evidenceText.includes(id));
  findings.push(uncovered.length === 0
    ? pass('MR-05', 'GAPS_HAVE_EVIDENCE', SEVERITY.REGRESSION, 'Requisitos derivados com evidência', `${requirementIds.length} requisito(s) referenciados por testes/gates`)
    : fail('MR-05', 'GAPS_HAVE_EVIDENCE', SEVERITY.REGRESSION,
      'Gap sem evidência de tratamento',
      `requisito(s) derivado(s) sem referência em testes/gates: ${uncovered.join(', ')} — "resolvido" sem evidência é exatamente o que o Meta Reviewer precisa reprovar`,
      uncovered.map((id) => ({ requirementId: id }))));

  // 6. Os gates obrigatórios foram executados e passaram?
  const gateById = new Map(gates.map((g) => [g.id, g]));
  const missingGates = REQUIRED_GATES_FOR_GREEN.filter((g) => !gateById.has(g) || gateById.get(g).status !== 'PASS');
  findings.push(missingGates.length === 0
    ? pass('MR-06', 'GATES_EXECUTED', SEVERITY.BLOCKER, 'Gates obrigatórios executados e PASS', REQUIRED_GATES_FOR_GREEN.join(', '))
    : fail('MR-06', 'GATES_EXECUTED', SEVERITY.BLOCKER,
      'Gate obrigatório ausente ou não-PASS',
      `gate(s): ${missingGates.map((g) => `${g}=${gateById.get(g) ? gateById.get(g).status : 'AUSENTE'}`).join(', ')}`,
      missingGates.map((g) => ({ gateId: g, status: gateById.get(g) ? gateById.get(g).status : 'MISSING' }))));

  // 7. Algum teste foi enfraquecido?
  const weakened = [...analysis.removedAssertions, ...analysis.removedTestCases];
  findings.push(weakened.length === 0
    ? pass('MR-07', 'TESTS_NOT_WEAKENED', SEVERITY.BLOCKER, 'Nenhum teste enfraquecido', 'nenhuma asserção/caso de teste removido pelo patch')
    : fail('MR-07', 'TESTS_NOT_WEAKENED', SEVERITY.BLOCKER,
      'Teste enfraquecido ou removido', `${weakened.length} ocorrência(s) no patch`,
      weakened.slice(0, 20)));

  // 8. Algum teste foi desligado para ficar verde?
  findings.push(analysis.addedTestSuppression.length === 0
    ? pass('MR-08', 'NO_TEST_SUPPRESSION', SEVERITY.REGRESSION, 'Nenhum teste desligado', 'nenhum .skip/.only/xit/xdescribe/todo adicionado')
    : fail('MR-08', 'NO_TEST_SUPPRESSION', SEVERITY.REGRESSION,
      'Teste desligado/focado adicionado', `${analysis.addedTestSuppression.length} ocorrência(s)`,
      analysis.addedTestSuppression.slice(0, 20)));

  // 9. Segredos no patch?
  findings.push(analysis.addedSecrets.length === 0
    ? pass('MR-09', 'NO_SECRETS_IN_PATCH', SEVERITY.BLOCKER, 'Nenhum segredo no patch', 'nenhum padrão de credencial encontrado nas linhas adicionadas')
    : fail('MR-09', 'NO_SECRETS_IN_PATCH', SEVERITY.BLOCKER,
      'Segredo adicionado pelo patch', `${analysis.addedSecrets.length} ocorrência(s)`,
      analysis.addedSecrets.slice(0, 20)));

  // 10. Exceções engolidas / fallback silencioso?
  if (analysis.silentErrorHandlingNotVerifiable) {
    findings.push(notVerifiable('MR-10', 'NO_SILENT_ERROR_HANDLING',
      'Exceção engolida / fallback silencioso',
      'não foi possível inspecionar os blocos catch do patch neste ambiente',
      analysis.silentErrorHandlingNotVerifiable.mechanism));
  } else {
    findings.push(analysis.silentErrorHandling.length === 0
      ? pass('MR-10', 'NO_SILENT_ERROR_HANDLING', SEVERITY.REGRESSION, 'Nenhuma exceção engolida', 'nenhum catch vazio ou catch→return literal sem logger/sinal de degradação em linhas adicionadas')
      : fail('MR-10', 'NO_SILENT_ERROR_HANDLING', SEVERITY.REGRESSION,
        'Exceção engolida ou convertida em retorno silencioso', `${analysis.silentErrorHandling.length} ocorrência(s)`,
        analysis.silentErrorHandling.slice(0, 20)));
  }

  // 11. Funcionalidade desligada para passar?
  findings.push(analysis.addedFeatureDisables.length === 0
    ? pass('MR-11', 'NO_FEATURE_DISABLED_TO_PASS', SEVERITY.REGRESSION, 'Nenhum desligamento adicionado', 'nenhuma flag/bypass adicionada nas linhas novas')
    : fail('MR-11', 'NO_FEATURE_DISABLED_TO_PASS', SEVERITY.REGRESSION,
      'Possível desligamento de funcionalidade', `${analysis.addedFeatureDisables.length} ocorrência(s) — exige justificativa explícita`,
      analysis.addedFeatureDisables.slice(0, 20)));

  // 12. Código comentado (heurística — informativo, nunca bloqueante sozinho).
  findings.push(analysis.addedCommentedCode.length === 0
    ? pass('MR-12', 'NO_COMMENTED_OUT_CODE', SEVERITY.INFO, 'Nenhum código comentado detectado', 'heurística textual sobre linhas adicionadas')
    : finding({ id: 'MR-12', checkId: 'NO_COMMENTED_OUT_CODE', severity: SEVERITY.POST_RELEASE, status: 'FAIL',
      title: 'Código comentado adicionado', detail: `${analysis.addedCommentedCode.length} linha(s) suspeita(s) (heurística)`, evidence: analysis.addedCommentedCode.slice(0, 20) }));

  // 13. Review independente presente quando o risco exige?
  const riskRank = RISK_RANK[spec.risk] ?? 1;
  const independentNeeded = riskRank >= RISK_RANK.HIGH;
  const independentReview = reviews.find((r) => r.independentOfCoder === true);
  const degradedIndependence = reviews.find((r) => (r.findings || []).some?.((f) => String(f.code || f).includes('INDEPENDENT_PROVIDER_UNAVAILABLE')));
  if (!independentNeeded) {
    findings.push(pass('MR-13', 'INDEPENDENT_REVIEW_PRESENT', SEVERITY.REGRESSION, 'Independência não exigida pelo risco', `risco ${spec.risk}`));
  } else if (independentReview) {
    findings.push(pass('MR-13', 'INDEPENDENT_REVIEW_PRESENT', SEVERITY.REGRESSION, 'Review independente presente', `${independentReview.reviewerProvider || '—'}:${independentReview.reviewerModel || '—'} · decisão ${independentReview.decision}`));
  } else if (degradedIndependence) {
    findings.push(fail('MR-13', 'INDEPENDENT_REVIEW_PRESENT', SEVERITY.REGRESSION,
      'Independência de reviewer indisponível (degradação registrada)',
      'o Router registrou INDEPENDENT_PROVIDER_UNAVAILABLE — validade determinística adicional é obrigatória antes de GREEN',
      [{ reviewerProvider: degradedIndependence.reviewerProvider, decision: degradedIndependence.decision }]));
  } else {
    findings.push(fail('MR-13', 'INDEPENDENT_REVIEW_PRESENT', SEVERITY.REGRESSION,
      'Risco alto/CRITICAL sem review independente', `risco ${spec.risk} exige reviewer de provider distinto do coder`));
  }

  // 14. Existe evidência para as afirmações de conclusão?
  const claimsWithoutEvidence = claims.filter((c) => !c.evidence || (Array.isArray(c.evidence) && c.evidence.length === 0));
  findings.push(claimsWithoutEvidence.length === 0
    ? pass('MR-14', 'EVIDENCE_FOR_COMPLETION_CLAIMS', SEVERITY.BLOCKER, 'Toda afirmação tem evidência', `${claims.length} afirmação(ões) verificadas`)
    : fail('MR-14', 'EVIDENCE_FOR_COMPLETION_CLAIMS', SEVERITY.BLOCKER,
      'Afirmação de conclusão sem evidência', `${claimsWithoutEvidence.length} afirmação(ões) sem referência de evidência`,
      claimsWithoutEvidence.map((c) => ({ claim: c.text }))));

  // 15. Duplicação de infraestrutura existente?
  const duplications = changedFiles.filter((f) => FORBIDDEN_DUPLICATION_PATTERNS.some((p) => p.re.test(f)));
  findings.push(duplications.length === 0
    ? pass('MR-15', 'NO_PARALLEL_INFRASTRUCTURE', SEVERITY.REGRESSION, 'Nenhuma infraestrutura duplicada', 'nenhum caminho proibido tocado pelo patch')
    : fail('MR-15', 'NO_PARALLEL_INFRASTRUCTURE', SEVERITY.REGRESSION,
      'Infraestrutura duplicada', duplications.join(', '),
      duplications.map((f) => ({ file: f, detail: FORBIDDEN_DUPLICATION_PATTERNS.find((p) => p.re.test(f)).detail }))));

  // 16. Rotas novas sem enforcement de classificação?
  const newRouteFiles = changedFiles.filter((f) => /^api\/modules\/[^/]+\/routes\.js$/.test(f));
  const routesWithoutEnforcement = newRouteFiles.filter((f) => {
    const content = fileContents.get(f);
    if (!content) return false; // não inventa: sem conteúdo, não reprova
    return !/checkClassification|requireClassification/.test(content);
  });
  findings.push(routesWithoutEnforcement.length === 0
    ? pass('MR-16', 'CLASSIFICATION_ENFORCED_ON_NEW_ROUTES', SEVERITY.BLOCKER, 'Rotas novas com enforcement de classificação', `${newRouteFiles.length} arquivo(s) de rotas verificado(s)`)
    : fail('MR-16', 'CLASSIFICATION_ENFORCED_ON_NEW_ROUTES', SEVERITY.BLOCKER,
      'Rota nova sem enforcement de classificação', routesWithoutEnforcement.join(', '),
      routesWithoutEnforcement.map((f) => ({ file: f }))));

  // 17. Estado impossível: GREEN sem task GREEN?
  if (mission.status === 'GREEN' && (!task || task.status !== 'GREEN')) {
    findings.push(fail('MR-17', 'NO_IMPOSSIBLE_STATES', SEVERITY.BLOCKER,
      'Estado impossível: missão GREEN sem execução GREEN', `mission.status=GREEN, task.status=${task ? task.status : 'ausente'}`));
  } else {
    findings.push(pass('MR-17', 'NO_IMPOSSIBLE_STATES', SEVERITY.BLOCKER, 'Nenhum estado impossível detectado', `mission=${mission.status}, task=${task ? task.status : 'ausente'}`));
  }

  // 18. Modelo novo sem migration no mesmo patch?
  const modelFiles = changedFiles.filter((f) => /^api\/db\/models\/[A-Za-z_]+\.js$/.test(f));
  const migrationFiles = changedFiles.filter((f) => /^api\/db\/migrations\/.+\.js$/.test(f));
  const modelsWithNewColumns = modelFiles.filter((f) => {
    const content = fileContents.get(f);
    const patch = diffText.split('\n').filter((l) => l.startsWith('+') && (l.includes(f) || true));
    if (!content) return false;
    // coluna nova no modelo = linha adicionada com "allowNull" ou "DataTypes." no arquivo do model
    return patch.some((l) => /DataTypes\./.test(l)) || /DataTypes\./.test(content.split('\n').slice(0, 5).join('\n'));
  });
  if (modelsWithNewColumns.length > 0 && migrationFiles.length === 0) {
    findings.push(fail('MR-18', 'MIGRATION_FOR_MODEL_CHANGE', SEVERITY.REGRESSION,
      'Model alterado sem migration no mesmo patch', `models: ${modelsWithNewColumns.join(', ')} sem arquivo em api/db/migrations/`,
      modelsWithNewColumns.map((f) => ({ file: f }))));
  } else {
    findings.push(pass('MR-18', 'MIGRATION_FOR_MODEL_CHANGE', SEVERITY.REGRESSION, 'Migrations consistentes com models', `${modelFiles.length} model(s) alterado(s), ${migrationFiles.length} migration(s) no patch`));
  }

  // 19. Escopo por tenant em leituras novas (infraestrutura interna de engenharia é isenta por política).
  const tenantTouched = (spec.subsystems || []).some((s) => /multi|tenant|workspace/i.test(String(s))) || spec.missionType === 'SECURITY';
  const scopedFiles = changedFiles.filter((f) => /^api\/services\//.test(f) && !internalPaths.some((p) => f.startsWith(p)));
  const unscopedReads = [];
  if (tenantTouched && scopedFiles.length > 0) {
    for (const f of scopedFiles) {
      const content = fileContents.get(f);
      if (!content) continue;
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (/(findAll|findOne|destroy|update)\(/.test(line) && !/tenant_id|tenantId|where:\s*\{\s*id/.test(line)) {
          unscopedReads.push({ file: f, line: idx + 1, evidence: line.trim() });
        }
      });
    }
  }
  findings.push(unscopedReads.length === 0
    ? pass('MR-19', 'TENANT_SCOPING_PRESERVED', SEVERITY.REGRESSION, 'Nenhuma leitura nova sem escopo explícito', `${scopedFiles.length} arquivo(s) de serviço analisado(s)`)
    : fail('MR-19', 'TENANT_SCOPING_PRESERVED', SEVERITY.REGRESSION,
      'Leitura sem escopo explícito em caminho de serviço', `${unscopedReads.length} ocorrência(s) — exige justificativa (id único) ou filtro por tenant`,
      unscopedReads.slice(0, 20)));

  // 20. Perguntas do §23 que a análise atual NÃO consegue responder — explícitas, nunca PASS.
  for (const concern of analysis.unverifiableConcerns) {
    findings.push(notVerifiable(`MR-2x-${concern.checkId}`, concern.checkId,
      `Verificação não automatizável: ${concern.checkId}`,
      `${concern.suspects} ocorrência(s) suspeita(s) detectada(s) por heurística textual`,
      concern.mechanism));
  }
  findings.push(notVerifiable('MR-20', 'MOCKS_DO_NOT_REPLACE_REAL_FUNCTIONALITY',
    'Mocks substituindo funcionalidade real',
    'não é verificável por análise textual: exige diff semântico entre comportamento testado e comportamento de produção',
    'revisão humana com checklist + teste de contrato que exercite o caminho real (como os E2E desta entrega fazem)'));
  findings.push(notVerifiable('MR-21', 'NO_DEAD_CODE',
    'Código morto',
    'não é verificável sem análise de alcançabilidade por tipos/lint',
    'declarar eslint (no-unused-vars/no-unreachable) como dependência de desenvolvimento'));
  findings.push(notVerifiable('MR-22', 'NO_UNNECESSARY_DEPENDENCIES',
    'Dependências desnecessárias',
    'não é verificável sem análise de uso real de cada dependência',
    '`depcheck` no CI + revisão de package.json no diff'));

  const counts = {
    total: findings.length,
    pass: findings.filter((f) => f.status === 'PASS').length,
    fail: findings.filter((f) => f.status === 'FAIL').length,
    notVerifiable: findings.filter((f) => f.status === 'NOT_VERIFIABLE').length,
    blockers: findings.filter((f) => f.status === 'FAIL' && f.severity === SEVERITY.BLOCKER).length,
    regressions: findings.filter((f) => f.status === 'FAIL' && f.severity === SEVERITY.REGRESSION).length,
  };
  const blocksGreen = findings.some((f) => f.blocksGreen);
  const status = blocksGreen ? 'FAIL' : (counts.notVerifiable > 0 ? 'INCOMPLETE' : 'PASS');

  return {
    engineVersion: META_REVIEW_ENGINE_VERSION,
    kind: 'META',
    status,
    blocksGreen,
    counts,
    findings,
    analysisSummary: {
      filesChanged: analysis.filesChanged,
      addedLines: analysis.addedLines,
      removedLines: analysis.removedLines,
      analyzedFilePath: analysis.files.slice(0, 50),
    },
  };
}

module.exports = {
  META_REVIEW_ENGINE_VERSION,
  SEVERITY,
  FORBIDDEN_DUPLICATION_PATTERNS,
  REQUIRED_GATES_FOR_GREEN,
  runMetaReview,
};
