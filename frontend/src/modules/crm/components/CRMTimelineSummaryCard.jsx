import React from 'react';

function defaultFormatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR');
}

export function CRMTimelineSummaryCard({
  title = 'CRM Operacional',
  opportunitiesCount = 0,
  revenueOpportunitiesCount = 0,
  timelineCount = 0,
  enabled = true,
  subtitle = '',
  summary = null,
  loading = false,
  error = '',
  formatDate = defaultFormatDate,
}) {
  const eventsRecentCount = Number(summary?.eventsRecentCount ?? timelineCount ?? 0);
  const opportunities = Number(summary?.opportunitiesCount ?? opportunitiesCount ?? 0);
  const revenueOpportunities = Number(summary?.revenueOpportunitiesCount ?? revenueOpportunitiesCount ?? 0);
  const lastEvent = summary?.lastEvent || null;
  const recentActivity = summary?.recentActivity === true;

  return (
    <div className="rounded-lg border border-border-default bg-bg-primary p-3">
      <div className="text-sm font-semibold text-text-primary">{title}</div>
      <div className="mt-1 text-xs text-text-secondary">
        opps {opportunities} • revenue {revenueOpportunities} • eventos {eventsRecentCount}
      </div>
      {loading ? (
        <div className="mt-2 text-xs text-text-secondary">Carregando resumo operacional...</div>
      ) : error ? (
        <div className="mt-2 text-xs text-status-error">Falha ao carregar resumo operacional.</div>
      ) : lastEvent ? (
        <>
          <div className="mt-2 text-xs text-text-secondary">
            Último evento: {String(lastEvent.type || 'crm_event')}
          </div>
          <div className="mt-1 text-xs text-text-tertiary">
            {formatDate(lastEvent.created_at)} • {lastEvent.source_module || 'crm'}
          </div>
        </>
      ) : (
        <div className="mt-2 text-xs text-text-secondary">Sem atividade operacional recente.</div>
      )}
      <div className="mt-2 text-xs text-text-secondary">
        Atividade recente:{' '}
        <span className={recentActivity ? 'text-status-success' : 'text-text-tertiary'}>
          {recentActivity ? 'ativa' : 'baixa'}
        </span>
      </div>
      <div className="mt-2 text-xs text-text-tertiary">
        {subtitle || (enabled ? 'Cockpit CRM habilitado.' : 'Cockpit CRM desabilitado.')}
      </div>
    </div>
  );
}
