/**
 * CoverageEvaluator — Avalia cobertura de fluxos contra source files.
 *
 * Para cada fluxo inferido, verifica se cada entidade tem programas
 * correspondentes no mapa sourceFiles. Entidades sem cobertura geram
 * BusinessGaps com severidade baseada na posição no fluxo.
 */

/**
 * Determina severidade do gap com base na posição da entidade no fluxo.
 * Entidades raiz (índice 0) são críticas; folhas são baixa severidade.
 */
function severityForPosition(index, total) {
  if (total <= 1) return 'critical';
  const ratio = index / (total - 1);
  if (ratio === 0) return 'critical';
  if (ratio <= 0.33) return 'high';
  if (ratio <= 0.66) return 'medium';
  return 'low';
}

/**
 * @param {Array} flows — fluxos inferidos (sem coverage ainda)
 * @param {Object<string, string[]>} sourceFiles — mapa entityName → [arquivos]
 * @returns {{ flowsWithCoverage: Array, gaps: Array }}
 */
export function evaluate(flows, sourceFiles = {}) {
  const gaps = [];
  const flowsWithCoverage = flows.map((flow, flowIdx) => {
    let coveredCount = 0;

    const stepsWithStatus = flow.steps.map((step, stepIdx) => {
      const entityFiles = sourceFiles[step.entity];
      const isCovered = Array.isArray(entityFiles) && entityFiles.length > 0;

      if (isCovered) {
        coveredCount++;
        return { ...step, covered: true };
      }

      // Gera gap para entidade não coberta
      const severity = severityForPosition(stepIdx, flow.steps.length);
      const affectedEntities = flow.entitiesInFlow.slice(0, stepIdx + 1);

      gaps.push({
        gapId: `gap-${flow.flowId}-${step.entity.toLowerCase()}`,
        severity,
        description: `Entidade "${step.entity}" sem cobertura no fluxo "${flow.flowName}"`,
        missingEntity: step.entity,
        affectedFlow: flow.flowName,
        impact: severity === 'critical'
          ? `Fluxo incompleto: ${affectedEntities.join(' → ')} sem a etapa ${step.entity}`
          : `Entidade "${step.entity}" não possui programas de implementação`,
        recommendation: `Criar programas para a entidade "${step.entity}" (ex: ${step.entity.toLowerCase()}_cadastro.prg, ${step.entity.toLowerCase()}_consulta.prg)`,
        suggestedFiles: entityFiles || [],
        status: 'open'
      });

      return { ...step, covered: false };
    });

    const coverage = flow.totalEntities > 0
      ? Math.round((coveredCount / flow.totalEntities) * 100)
      : 0;

    return {
      ...flow,
      steps: stepsWithStatus,
      coverage,
      coveredEntities: coveredCount
    };
  });

  return { flowsWithCoverage, gaps };
}

export default { evaluate, severityForPosition };
