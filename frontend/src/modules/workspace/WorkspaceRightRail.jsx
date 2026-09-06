import React from 'react';
import { getOperationalLabels, isDevSurfaceVisible } from './workspaceDevSurface';
import { SuggestionExpectedOutcome, SuggestionMeta } from './WorkspaceActions';
import { formatInsightType } from './insightTypeLabels';

function Card({ title, children, loading = false }) {
  return (
    <section className="workspace-card workspace-right-card">
      <div className="workspace-section-label mb-3">{title}</div>
      {loading ? <div className="workspace-skeleton h-20"></div> : children}
    </section>
  );
}

export function WorkspaceRightRail({ summary, insights, actions, incidents, loadingInsights, loadingActions, loadingIncidents, classification = 'PRODUCTION', onExecuteSuggestion, onApplyTenantRecommendation }) {
  const labels = getOperationalLabels(classification);
  const devSurfaceVisible = isDevSurfaceVisible(classification);
  const insightItems = [...(insights?.items || []), ...(insights?.persisted || [])];
  const pendingActions = (actions?.items || []).filter((item) => item.status === 'pending');
  const criticalFailures = (incidents?.items || []).filter((item) => item.diagnosis?.risk === 'high' || item.validation_result?.status === 'failed');

  return (
    <aside className="workspace-right-rail">
      <Card title="Next Best Action" loading={loadingActions}>
        {actions?.suggestion ? (
          <>
            <strong>{actions.suggestion.label}</strong>
            <p className="workspace-muted text-sm mt-2">{actions.suggestion.reason}</p>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <SuggestionMeta suggestion={actions.suggestion} />
            </div>
            <SuggestionExpectedOutcome suggestion={actions.suggestion} />
            {onExecuteSuggestion && actions.suggestion.action?.kind ? (
              <button
                className="workspace-action-button mt-3"
                type="button"
                disabled={actions.suggestion.action.kind === 'send_message' && !actions.suggestion.action.conversationId}
                title={actions.suggestion.action.kind === 'send_message' && !actions.suggestion.action.conversationId ? 'Sem conversa vinculada' : undefined}
                onClick={() => onExecuteSuggestion(actions.suggestion)}
              >
                {actions.suggestion.action.label || 'Executar ação sugerida'}
              </button>
            ) : null}
          </>
        ) : <p className="workspace-muted text-sm">Nenhuma ação sugerida no momento.</p>}
      </Card>

      {actions?.tenantRecommendation ? (
        <Card title="Recomendação inteligente" loading={loadingActions}>
          <strong>{actions.tenantRecommendation.title}</strong>
          <p className="workspace-muted text-sm mt-2">{actions.tenantRecommendation.description}</p>
          {actions.tenantRecommendation.probableCauses?.length > 0 ? (
            <p className="workspace-muted text-sm mt-2">
              Possíveis causas: {actions.tenantRecommendation.probableCauses
                .map((cause) => `${cause.metricKey} (${cause.direction === 'up' ? '+' : ''}${Math.round(cause.changeRatio * 100)}%)`)
                .join(', ')}
            </p>
          ) : null}
          {actions.tenantRecommendation.projection ? (
            <p className="workspace-muted text-sm mt-2">
              Projeção de fechamento: ~{actions.tenantRecommendation.projection.projectedValue} vs alvo {actions.tenantRecommendation.projection.targetValue}
              ({actions.tenantRecommendation.projection.projectedStatus === 'will_meet' ? 'atinge a meta' : 'não atinge a meta'})
            </p>
          ) : null}
          {onApplyTenantRecommendation ? (
            <button
              className="workspace-action-button mt-3"
              type="button"
              onClick={() => onApplyTenantRecommendation(actions.tenantRecommendation)}
            >
              Aplicar recomendação
            </button>
          ) : null}
        </Card>
      ) : null}

      <Card title="Health Score">
        <div className={`workspace-health-card ${summary?.healthTone || 'healthy'}`}>
          <strong>{summary?.score ?? 100}</strong>
          <span>{summary?.healthLabel || 'Saudável'}</span>
        </div>
        <div className="workspace-metric-list mt-3">
          <div><span>Tickets abertos</span><strong>{summary?.openTickets ?? 0}</strong></div>
          <div><span>SLA em risco</span><strong>{summary?.delayed ?? 0}</strong></div>
          <div><span>{labels.failuresMetric}</span><strong>{summary?.qaFailures ?? 0}</strong></div>
          <div><span>Pagamentos pendentes</span><strong>{summary?.pendingPayments ?? 0}</strong></div>
        </div>
      </Card>

      <Card title="Insights IA" loading={loadingInsights}>
        {insightItems.slice(0, 3).map((item, index) => <div key={`${item.type}-${index}`} className="workspace-rail-item"><strong>{formatInsightType(item.type)}</strong><p>{item.description}</p></div>)}
        {insightItems.length === 0 ? <p className="workspace-muted text-sm">Sem insights adicionais.</p> : null}
      </Card>

      <Card title="Riscos">
        <div className="workspace-metric-list">
          <div><span>Nível atual</span><strong>{summary?.riskLevel || 'Estável'}</strong></div>
          <div><span>Inatividade</span><strong>{summary?.lastActivityAt ? 'monitorada' : 'sem dados'}</strong></div>
        </div>
      </Card>

      <Card title="Ações pendentes" loading={loadingActions}>
        {pendingActions.slice(0, 4).map((item) => <div key={item.id} className="workspace-rail-item"><strong>{item.payload?.title || item.type}</strong><p>{item.status}</p></div>)}
        {pendingActions.length === 0 ? <p className="workspace-muted text-sm">Nenhuma ação pendente.</p> : null}
      </Card>

      {devSurfaceVisible ? (
        <Card title={labels.failuresCardTitle} loading={loadingIncidents}>
          {criticalFailures.slice(0, 3).map((item) => <div key={item.id} className="workspace-rail-item"><strong>{item.diagnosis?.affectedModule || item.source_type}</strong><p>{item.diagnosis?.rootCause || labels.failureDetected}</p></div>)}
          {criticalFailures.length === 0 ? <p className="workspace-muted text-sm">{labels.failuresEmpty}</p> : null}
        </Card>
      ) : null}

      <Card title="Produtividade">
        <div className="workspace-metric-list">
          <div><span>Mensagens recentes</span><strong>{summary?.recentMessages ?? 0}</strong></div>
          <div><span>Ações pendentes</span><strong>{summary?.pendingActions ?? 0}</strong></div>
        </div>
      </Card>

      <Card title="Pagamentos">
        <div className="workspace-metric-list">
          <div><span>Pendentes</span><strong>{summary?.pendingPayments ?? 0}</strong></div>
          <div><span>Status</span><strong>{summary?.pendingPayments > 0 ? 'Requer atenção' : 'Em dia'}</strong></div>
        </div>
      </Card>
    </aside>
  );
}