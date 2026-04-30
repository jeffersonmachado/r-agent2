import React from 'react';

function Card({ title, children, loading = false }) {
  return (
    <section className="workspace-card workspace-right-card">
      <div className="workspace-section-label mb-3">{title}</div>
      {loading ? <div className="workspace-skeleton h-20"></div> : children}
    </section>
  );
}

export function WorkspaceRightRail({ summary, insights, actions, autocorrections, loadingInsights, loadingActions, loadingAutoCorrections }) {
  const insightItems = [...(insights?.items || []), ...(insights?.persisted || [])];
  const pendingActions = (actions?.items || []).filter((item) => item.status === 'pending');
  const criticalFailures = (autocorrections?.items || []).filter((item) => item.diagnosis?.risk === 'high' || item.validation_result?.status === 'failed');

  return (
    <aside className="workspace-right-rail">
      <Card title="Next Best Action" loading={loadingActions}>
        {actions?.suggestion ? (
          <>
            <strong>{actions.suggestion.label}</strong>
            <p className="workspace-muted text-sm mt-2">{actions.suggestion.reason}</p>
          </>
        ) : <p className="workspace-muted text-sm">Nenhuma ação sugerida no momento.</p>}
      </Card>

      <Card title="Health Score">
        <div className={`workspace-health-card ${summary?.healthTone || 'healthy'}`}>
          <strong>{summary?.score ?? 100}</strong>
          <span>{summary?.healthLabel || 'Saudável'}</span>
        </div>
        <div className="workspace-metric-list mt-3">
          <div><span>Tickets abertos</span><strong>{summary?.openTickets ?? 0}</strong></div>
          <div><span>SLA em risco</span><strong>{summary?.delayed ?? 0}</strong></div>
          <div><span>Falhas QA/RPA</span><strong>{summary?.qaFailures ?? 0}</strong></div>
          <div><span>Pagamentos pendentes</span><strong>{summary?.pendingPayments ?? 0}</strong></div>
        </div>
      </Card>

      <Card title="Insights IA" loading={loadingInsights}>
        {insightItems.slice(0, 3).map((item, index) => <div key={`${item.type}-${index}`} className="workspace-rail-item"><strong>{item.type}</strong><p>{item.description}</p></div>)}
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

      <Card title="Falhas QA/RPA" loading={loadingAutoCorrections}>
        {criticalFailures.slice(0, 3).map((item) => <div key={item.id} className="workspace-rail-item"><strong>{item.diagnosis?.affectedModule || item.source_type}</strong><p>{item.diagnosis?.rootCause || 'Falha detectada'}</p></div>)}
        {criticalFailures.length === 0 ? <p className="workspace-muted text-sm">Nenhuma falha crítica em aberto.</p> : null}
      </Card>

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