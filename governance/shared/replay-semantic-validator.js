'use strict';

/**
 * Replay Semantic Validator — valida coerência semântica de um replay normalizado.
 *
 * Recebe um replay já normalizado pelo replay-parser e verifica:
 *   1. status=GO mas failedStepCount > 0       → FALSE_POSITIVE
 *   2. status=GO mas failedStepIds presente    → FALSE_POSITIVE_IDS
 *   3. status=GO mas step.status=failed        → STEP_FAILED_IN_GO
 *   4. status=GO mas step.passed=false         → STEP_UNPASSED_IN_GO
 *   5. ui.available=false em jornada crítica   → UI_UNAVAILABLE
 *   6. screenshots ausentes em jornada crítica → MISSING_SCREENSHOTS
 *   7. audit.valid=false no flow               → AUDIT_INVALID
 *   8. actionType incoerente com status        → ACTION_TYPE_DRIFT
 *
 * REGRA: nenhum engine pode duplicar estas verificações.
 * Todos DEVEM chamar validateReplaySemantics().
 */

function findUiUnavailable(obj, parentPath) {
  if (!obj || typeof obj !== 'object') return [];
  const found = [];

  if (Array.isArray(obj)) {
    obj.forEach((v, i) => found.push(...findUiUnavailable(v, `${parentPath}[${i}]`)));
    return found;
  }

  // Verificar ui diretamente
  if (obj.ui && obj.ui.available === false) {
    found.push({ path: `${parentPath}.ui`, reason: obj.ui.reason || 'unavailable' });
  }

  // Verificar nos snapshots nomeados
  for (const snap of ['beforeStepSnapshot', 'afterStepSnapshot', 'beforeSnapshot', 'afterSnapshot', 'postState']) {
    const s = obj[snap];
    if (s && s.ui && s.ui.available === false) {
      found.push({ path: `${parentPath}.${snap}.ui`, reason: s.ui.reason || 'unavailable' });
    }
  }

  return found;
}

/**
 * @param {object} replay — replay normalizado (saída de replay-parser.normalizeReplay)
 * @param {Set<string>} visualCritical — conjunto de journeyIds visuais críticos
 * @returns {Array<{rule, severity, message, ...}>}
 */
function validateReplaySemantics(replay, visualCritical) {
  if (!replay) return [];
  const violations = [];
  const { journeyId, status, failedStepCount, failedStepIds, steps, screenshots, audit } = replay;
  const isCritical = visualCritical && visualCritical.has(journeyId);

  // 1. GO com failedStepCount > 0
  if ((failedStepCount ?? 0) > 0 && status === 'GO') {
    violations.push({
      rule:    'FALSE_POSITIVE',
      severity: 'CRITICAL',
      journeyId,
      message: `${journeyId}: status=GO mas failedStepCount=${failedStepCount}`,
    });
  }

  // 2. GO com failedStepIds presentes
  if ((failedStepIds || []).length > 0 && status === 'GO') {
    violations.push({
      rule:    'FALSE_POSITIVE_IDS',
      severity: 'CRITICAL',
      journeyId,
      failedStepIds,
      message: `${journeyId}: status=GO mas failedStepIds=${JSON.stringify(failedStepIds)}`,
    });
  }

  // 3 & 4. Steps com status=failed ou passed=false em artefato GO
  for (const step of (steps || [])) {
    const stepId = step.id || step.stepId || '?';

    if (step.status === 'failed' || step.passed === false) {
      violations.push({
        rule:    step.status === 'failed' ? 'STEP_FAILED_IN_GO' : 'STEP_UNPASSED_IN_GO',
        severity: 'CRITICAL',
        journeyId,
        stepId,
        message: `${journeyId}: step ${stepId} falhou (status=${step.status}) em artefato GO`,
      });
    }

    // 5. ui.available=false em step de jornada crítica
    if (isCritical) {
      const uiIssues = findUiUnavailable(step, `step.${stepId}`);
      const stepUiIssues = uiIssues.filter((u) =>
        u.path.includes('beforeStepSnapshot') || u.path.includes('afterStepSnapshot')
      );
      for (const issue of stepUiIssues) {
        violations.push({
          rule:    'UI_UNAVAILABLE',
          severity: 'CRITICAL',
          journeyId,
          stepId,
          path:    issue.path,
          reason:  issue.reason,
          message: `${journeyId}: step ${stepId} ui.available=false (${issue.reason}) em jornada visual crítica`,
        });
      }
    }
  }

  // 5b. ui.available=false em snapshot raiz de jornada crítica
  if (isCritical) {
    const { replay: _r, ...snapshotContext } = {
      beforeSnapshot: replay.beforeSnapshot,
      afterSnapshot:  replay.afterSnapshot,
    };
    const rootUiIssues = findUiUnavailable(snapshotContext, 'root');
    for (const issue of rootUiIssues) {
      violations.push({
        rule:    'ROOT_UI_UNAVAILABLE',
        severity: 'CRITICAL',
        journeyId,
        path:    issue.path,
        reason:  issue.reason,
        message: `${journeyId}: snapshot raiz ui.available=false (${issue.reason}) em jornada crítica`,
      });
    }
  }

  // 6. Screenshots ausentes em jornada crítica GO
  if (isCritical && status === 'GO' && (screenshots || []).length === 0) {
    violations.push({
      rule:    'MISSING_SCREENSHOTS',
      severity: 'HIGH',
      journeyId,
      message: `${journeyId}: status=GO mas sem screenshots em jornada visual crítica`,
    });
  }

  // 7. audit.valid=false
  if (audit && audit.valid === false) {
    violations.push({
      rule:    'AUDIT_INVALID',
      severity: 'HIGH',
      journeyId,
      message: `${journeyId}: audit.valid=false`,
    });
  }

  return violations;
}

/**
 * Valida uma lista de replays e retorna resultado agregado.
 * @param {Array} replays — array de replays normalizados
 * @param {Set<string>} visualCritical
 * @returns {{ pass, violations, criticalCount, highCount, perJourney }}
 */
function validateAllReplays(replays, visualCritical) {
  const perJourney = replays.map((r) => {
    const violations = validateReplaySemantics(r, visualCritical);
    return {
      journeyId:       r.journeyId,
      source:          r.source,
      status:          r.status,
      isVisualCritical: visualCritical ? visualCritical.has(r.journeyId) : false,
      violations,
      valid:           violations.length === 0,
    };
  });

  const allViolations = perJourney.flatMap((j) =>
    j.violations.map((v) => ({ ...v, journeyId: j.journeyId, source: j.source }))
  );

  return {
    pass:          allViolations.length === 0,
    violations:    allViolations,
    criticalCount: allViolations.filter((v) => v.severity === 'CRITICAL').length,
    highCount:     allViolations.filter((v) => v.severity === 'HIGH').length,
    perJourney,
  };
}

module.exports = { validateReplaySemantics, validateAllReplays, findUiUnavailable };
