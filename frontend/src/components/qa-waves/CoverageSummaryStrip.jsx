import React, { useCallback, useEffect, useState } from 'react';
import { fetchJson } from '../../api/client';

/**
 * Mapeia o payload de GET /api/qa-waves/coverage/summary para a faixa de
 * métricas do dashboard. Função pura (testável sem DOM).
 */
export function buildCoverageSummaryMetrics(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const toPct = (value) => (
    typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}%` : '—'
  );
  const critical = payload.criticalSummary || {};

  return {
    visited: { label: 'Cobertura visitada', value: toPct(payload.visitedCoverage) },
    validated: { label: 'Cobertura validada', value: toPct(payload.validatedCoverage) },
    success: { label: 'Taxa de sucesso', value: toPct(payload.successRate) },
    weighted: { label: 'Cobertura ponderada', value: toPct(payload.weightedCoverage) },
    critical: {
      uncovered: Number(critical.uncovered) || 0,
      failed: Number(critical.failed) || 0,
      stale: Number(critical.stale) || 0,
    },
  };
}

const METRIC_ORDER = ['visited', 'validated', 'success', 'weighted'];

/**
 * Faixa de métricas de cobertura de execução (visitada / validada / sucesso /
 * ponderada + resumo crítico). Carrega apenas no mount ou via botão Atualizar.
 */
export function CoverageSummaryStrip() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson('/api/qa-waves/coverage/summary');
      setMetrics(buildCoverageSummaryMetrics(data));
    } catch (err) {
      setMetrics(null);
      setError(err?.message || 'Falha ao carregar resumo de cobertura');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="qa-waves-panel">
      <div className="flex justify-between items-center mb-3">
        <h2 className="qa-waves-section-title mb-0">Cobertura de Execução (Mesh)</h2>
        <button type="button" onClick={load} disabled={loading} className="qa-btn-primary">
          {loading ? 'Carregando…' : '↻ Atualizar'}
        </button>
      </div>

      {error && (
        <p className="qa-empty" style={{ color: 'var(--color-status-error)' }}>{error}</p>
      )}

      {!error && !metrics && !loading && (
        <p className="qa-empty">Resumo de cobertura indisponível.</p>
      )}

      {metrics && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {METRIC_ORDER.map((key) => (
              <div
                key={key}
                style={{
                  border: '1px solid var(--color-border-default)',
                  borderRadius: 8,
                  padding: 12,
                  background: 'var(--color-bg-elevated)',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                  {metrics[key].label}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{metrics[key].value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12, fontSize: 13 }}>
            <span>
              Críticos não cobertos:{' '}
              <strong style={{ color: metrics.critical.uncovered > 0 ? 'var(--color-status-error)' : 'var(--color-status-success)' }}>
                {metrics.critical.uncovered}
              </strong>
            </span>
            <span>
              Críticos com falha:{' '}
              <strong style={{ color: metrics.critical.failed > 0 ? 'var(--color-status-error)' : 'var(--color-status-success)' }}>
                {metrics.critical.failed}
              </strong>
            </span>
            <span>
              Críticos obsoletos (stale):{' '}
              <strong style={{ color: metrics.critical.stale > 0 ? 'var(--color-status-warning)' : 'var(--color-status-success)' }}>
                {metrics.critical.stale}
              </strong>
            </span>
          </div>
        </>
      )}
    </section>
  );
}

export default CoverageSummaryStrip;
