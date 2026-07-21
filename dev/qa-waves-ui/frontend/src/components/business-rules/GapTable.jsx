import { Check, Eye, Search, X } from 'lucide-react';

const severityColors = {
  critical: 'var(--err)',
  high: '#ff8a65',
  medium: 'var(--warn)',
  low: 'var(--muted)'
};

const statusLabels = {
  open: 'Aberto',
  investigating: 'Investigando',
  resolved: 'Resolvido',
  dismissed: 'Ignorado'
};

export default function GapTable({ gaps, onUpdateGap }) {
  if (!gaps || gaps.length === 0) {
    return (
      <div className="empty-gaps">
        Nenhum gap detectado.
      </div>
    );
  }

  return (
    <div className="gaps-table-wrapper">
      <table className="gaps-table">
        <thead>
          <tr>
            <th>Severidade</th>
            <th>Entidade</th>
            <th>Fluxo afetado</th>
            <th>Impacto</th>
            <th>Recomendacao</th>
            <th>Status</th>
            <th>Acoes</th>
          </tr>
        </thead>
        <tbody>
          {gaps.map((gap) => (
            <tr key={gap.gapId}>
              <td>
                <span
                  className="severity-badge"
                  style={{
                    backgroundColor: `${severityColors[gap.severity]}20`,
                    color: severityColors[gap.severity],
                    border: `1px solid ${severityColors[gap.severity]}`
                  }}
                >
                  {gap.severity}
                </span>
              </td>
              <td className="entity-cell">{gap.missingEntity}</td>
              <td className="flow-cell">{gap.affectedFlow}</td>
              <td className="impact-cell">{gap.impact}</td>
              <td className="recommendation-cell">{gap.recommendation}</td>
              <td>
                <span className="status-badge">{statusLabels[gap.status] || gap.status}</span>
              </td>
              <td>
                <div className="gap-actions">
                  {gap.status === 'open' && (
                    <button
                      className="icon-btn-sm"
                      title="Investigar"
                      onClick={() => onUpdateGap(gap.gapId, 'investigating')}
                    >
                      <Search size={14} />
                    </button>
                  )}
                  {(gap.status === 'open' || gap.status === 'investigating') && (
                    <>
                      <button
                        className="icon-btn-sm success"
                        title="Resolver"
                        onClick={() => onUpdateGap(gap.gapId, 'resolved')}
                      >
                        <Check size={14} />
                      </button>
                      <button
                        className="icon-btn-sm"
                        title="Ignorar"
                        onClick={() => onUpdateGap(gap.gapId, 'dismissed')}
                      >
                        <X size={14} />
                      </button>
                    </>
                  )}
                  {gap.status === 'resolved' && (
                    <button
                      className="icon-btn-sm"
                      title="Reabrir"
                      onClick={() => onUpdateGap(gap.gapId, 'open')}
                    >
                      <Eye size={14} />
                    </button>
                  )}
                  {gap.status === 'dismissed' && (
                    <button
                      className="icon-btn-sm"
                      title="Reabrir"
                      onClick={() => onUpdateGap(gap.gapId, 'open')}
                    >
                      <Eye size={14} />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
