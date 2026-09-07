import React from 'react';

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 60) return `${Math.round(n)}s`;
  if (n < 3600) return `${Math.round(n / 60)}min`;
  if (n < 86400) return `${(n / 3600).toFixed(1).replace('.', ',')}h`;
  return `${(n / 86400).toFixed(1).replace('.', ',')}d`;
}

function formatNumber(value) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return String(n).replace('.', ',');
}

/**
 * Analytics → Métricas de Produto (P4.13): responde se a operação está
 * rápida e fluida — tempo até a primeira resposta (TTFR), tempo até o
 * primeiro valor (TTFV), esforço por tarefa (cliques) e profundidade de
 * navegação. Fail-soft: sem dados, explica o que falta em vez de quebrar.
 */
export function AnalyticsProductMetricsSection({ productMetrics = null }) {
  if (!productMetrics || typeof productMetrics !== 'object' || productMetrics.ok !== true) return null;

  const ttfr = productMetrics.timeToFirstResponse || {};
  const ttfv = productMetrics.timeToFirstValue || {};
  const navigation = productMetrics.navigation || {};
  const surfaces = Array.isArray(productMetrics.clicksPerCoreSurface)
    ? productMetrics.clicksPerCoreSurface
    : [];

  const hasInteractionData = (navigation.sessions || 0) > 0;

  return (
    <section className="analytics-section" data-testid="analytics-product-metrics" aria-label="Métricas de produto">
      <h2 style={{ marginBottom: '4px' }}>Experiência operacional</h2>
      <p className="text-text-secondary" style={{ marginBottom: '16px' }}>
        Velocidade e fluidez da operação nos últimos {productMetrics.windowDays || 30} dias
      </p>

      <div className="analytics-metrics-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
        <div className="analytics-metric-card" data-testid="pm-ttfr">
          <div className="analytics-metric-label">Tempo até a primeira resposta</div>
          <div className="analytics-metric-value" style={{ fontSize: '1.6rem', fontWeight: 600 }}>
            {formatDuration(ttfr.avgSeconds)}
          </div>
          <div className="text-text-secondary" style={{ fontSize: '0.85rem' }}>
            {ttfr.conversations > 0
              ? `mediana ${formatDuration(ttfr.medianSeconds)} em ${ttfr.conversations} conversa(s)`
              : 'ainda sem conversas respondidas na janela'}
          </div>
        </div>

        <div className="analytics-metric-card" data-testid="pm-ttfv">
          <div className="analytics-metric-label">Tempo até o primeiro valor</div>
          <div className="analytics-metric-value" style={{ fontSize: '1.6rem', fontWeight: 600 }}>
            {ttfv.available ? formatDuration(ttfv.seconds) : '—'}
          </div>
          <div className="text-text-secondary" style={{ fontSize: '0.85rem' }}>
            {ttfv.available
              ? 'do início do onboarding até a primeira resposta a um cliente'
              : 'a primeira resposta a um cliente ainda não aconteceu'}
          </div>
        </div>

        <div className="analytics-metric-card" data-testid="pm-nav-depth">
          <div className="analytics-metric-label">Profundidade de navegação</div>
          <div className="analytics-metric-value" style={{ fontSize: '1.6rem', fontWeight: 600 }}>
            {formatNumber(navigation.avgRoutesPerSession)}
          </div>
          <div className="text-text-secondary" style={{ fontSize: '0.85rem' }}>
            {hasInteractionData
              ? `telas distintas por sessão (${navigation.sessions} sessões)`
              : 'telemetria de navegação ainda não coletada'}
          </div>
        </div>

        <div className="analytics-metric-card" data-testid="pm-clicks">
          <div className="analytics-metric-label">Esforço por tarefa</div>
          <div className="analytics-metric-value" style={{ fontSize: '1.6rem', fontWeight: 600 }}>
            {surfaces.length > 0 && surfaces.some((s) => s.avgClicksPerCompletedTask != null)
              ? `${formatNumber(
                  surfaces.find((s) => s.avgClicksPerCompletedTask != null)?.avgClicksPerCompletedTask,
                )} cliques`
              : '—'}
          </div>
          <div className="text-text-secondary" style={{ fontSize: '0.85rem' }}>
            {surfaces.length > 0
              ? 'cliques médios por tarefa concluída na superfície principal'
              : 'cliques por tarefa ainda não medidos'}
          </div>
        </div>
      </div>

      {surfaces.length > 0 ? (
        <div style={{ marginTop: '12px' }}>
          <table className="analytics-table" data-testid="pm-surfaces-table" style={{ width: '100%', fontSize: '0.9rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Superfície</th>
                <th style={{ textAlign: 'right' }}>Sessões</th>
                <th style={{ textAlign: 'right' }}>Cliques/sessão</th>
                <th style={{ textAlign: 'right' }}>Tarefas concluídas</th>
                <th style={{ textAlign: 'right' }}>Cliques/tarefa</th>
              </tr>
            </thead>
            <tbody>
              {surfaces.map((surface) => (
                <tr key={surface.surface}>
                  <td>{surface.surface}</td>
                  <td style={{ textAlign: 'right' }}>{surface.sessions}</td>
                  <td style={{ textAlign: 'right' }}>{formatNumber(surface.avgClicksPerSession)}</td>
                  <td style={{ textAlign: 'right' }}>{surface.taskCompletions}</td>
                  <td style={{ textAlign: 'right' }}>{formatNumber(surface.avgClicksPerCompletedTask)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export default AnalyticsProductMetricsSection;
