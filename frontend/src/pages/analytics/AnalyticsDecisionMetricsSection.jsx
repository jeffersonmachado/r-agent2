import React from 'react';

function formatRate(value) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(n * 100)}%`;
}

const PERIOD_LABELS = {
  day: 'hoje',
  week: '7 dias',
  month: '30 dias',
  quarter: '90 dias',
  all: 'todo o histórico',
};

/**
 * Analytics -> Product Metrics da camada de decisão: responde se a
 * inteligência operacional está gerando resultado real —
 *   aceite: recomendações aplicadas vs dispensadas;
 *   resultado: outcomes medidos (improved/regressed/unchanged);
 *   automação: quanto foi aplicado sem intervenção humana (auto/batch).
 * Seção fail-soft: sem stats, não renderiza nada.
 */
export function AnalyticsDecisionMetricsSection({ stats = null }) {
  if (!stats || typeof stats !== 'object') return null;

  const { acceptance = {}, outcome = {}, automation = {}, period } = stats;
  const periodLabel = PERIOD_LABELS[period] || period || '-';

  if ((stats.total || 0) === 0) return null;

  const cards = [
    {
      label: 'Taxa de aceite das recomendações',
      value: acceptance.rate,
      detail: `${acceptance.accepted || 0} aplicadas de ${acceptance.decided || 0} decididas`,
    },
    {
      label: 'Resultado medido com sucesso',
      value: outcome.successRate,
      detail: outcome.evaluated > 0
        ? `${outcome.improved || 0} melhoraram de ${outcome.evaluated} avaliadas`
        : `${outcome.pendingEvaluation || 0} aguardando novos dados`,
    },
    {
      label: 'Aplicação automática',
      value: automation.automationRate,
      detail: `${automation.auto || 0} autônomas + ${automation.batch || 0} em lote de ${automation.applied || 0} aplicadas`,
    },
    {
      label: 'Intervenção humana',
      value: automation.humanInterventionRate,
      detail: `${automation.manual || 0} aplicadas manualmente`,
    },
  ];

  return (
    <section className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg mb-6">
      <h3 className="text-lg font-semibold text-text-primary mb-1">Resultado das recomendações</h3>
      <p className="text-text-secondary text-sm" style={{ marginBottom: '12px' }}>
        A inteligência está sendo aceita e gerando resultado? Período: {periodLabel}.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div key={card.label} className="border border-border-default rounded-lg p-4">
            <div className="text-xs text-text-secondary">{card.label}</div>
            <div className="text-2xl font-semibold text-text-primary">{formatRate(card.value)}</div>
            <div className="text-xs text-text-secondary" style={{ marginTop: '4px' }}>{card.detail}</div>
          </div>
        ))}
      </div>

      {(outcome.regressed || 0) > 0 ? (
        <p className="text-sm text-status-warning" style={{ marginTop: '12px' }}>
          Atenção: {outcome.regressed} recomendação(ões) tiveram resultado medido como piora —
          revise a estratégia dessas ações.
        </p>
      ) : null}
    </section>
  );
}
