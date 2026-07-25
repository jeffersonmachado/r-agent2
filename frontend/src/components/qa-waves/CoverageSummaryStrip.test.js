import { describe, expect, it } from 'vitest';
import { buildCoverageSummaryMetrics } from './CoverageSummaryStrip';

describe('buildCoverageSummaryMetrics', () => {
  it('mapeia o payload do endpoint para a faixa de métricas', () => {
    const metrics = buildCoverageSummaryMetrics({
      visitedCoverage: 10.4,
      validatedCoverage: 10.4,
      successRate: 100,
      weightedCoverage: 15.6,
      criticalSummary: { uncovered: 7, failed: 0, stale: 0, orphaned: 0 },
    });

    expect(metrics.visited).toEqual({ label: 'Cobertura visitada', value: '10.4%' });
    expect(metrics.validated).toEqual({ label: 'Cobertura validada', value: '10.4%' });
    expect(metrics.success).toEqual({ label: 'Taxa de sucesso', value: '100.0%' });
    expect(metrics.weighted).toEqual({ label: 'Cobertura ponderada', value: '15.6%' });
    expect(metrics.critical).toEqual({ uncovered: 7, failed: 0, stale: 0 });
  });

  it('retorna null para payload ausente ou inválido', () => {
    expect(buildCoverageSummaryMetrics(null)).toBeNull();
    expect(buildCoverageSummaryMetrics(undefined)).toBeNull();
    expect(buildCoverageSummaryMetrics('x')).toBeNull();
  });

  it('tolera campos ausentes (placeholder —) e criticalSummary vazio', () => {
    const metrics = buildCoverageSummaryMetrics({});

    expect(metrics.visited.value).toBe('—');
    expect(metrics.validated.value).toBe('—');
    expect(metrics.success.value).toBe('—');
    expect(metrics.weighted.value).toBe('—');
    expect(metrics.critical).toEqual({ uncovered: 0, failed: 0, stale: 0 });
  });
});
