import React from 'react';
import { useRouter } from '../../hooks/useRouter';

const KIND_LABELS = {
  recommendation_exception: 'Decisão pendente',
  outcome_regressed: 'Resultado regrediu',
  goal_off_track: 'Meta fora do esperado',
  insight_high: 'Sinal de alto impacto',
};

const SEVERITY_LABELS = {
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};

/**
 * Gestão por exceção: superfície consolidada do que precisa de decisão
 * humana agora. Quando nao ha excecoes, mostra o estado calmo
 * ("Tudo sob controle") — gestao por excecao tambem e nao interromper.
 * Secao fail-soft: `attention` nulo (falha/carregando) nao renderiza nada.
 */
export function AnalyticsAttentionSection({
  attention = null,
  applyingId = null,
  dismissingId = null,
  onApply,
  onDismiss,
}) {
  const { navigate } = useRouter();

  if (!attention) return null;

  if (attention.status === 'clear') {
    return (
      <section
        data-testid="attention-clear"
        className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg mb-6"
      >
        <div className="text-sm text-text-primary font-medium">
          ✓ Tudo sob controle
        </div>
        <p className="text-text-secondary text-sm" style={{ marginTop: '2px' }}>
          Nenhuma exceção precisa de decisão agora. O RAP continua monitorando.
        </p>
      </section>
    );
  }

  const items = Array.isArray(attention.items) ? attention.items : [];
  if (items.length === 0) return null;

  const heading = attention.status === 'critical'
    ? 'Exceções que precisam de decisão'
    : 'Pontos de atenção';

  return (
    <section className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg mb-6">
      <h3 className="text-lg font-semibold text-text-primary mb-1">{heading}</h3>
      <p className="text-text-secondary text-sm" style={{ marginBottom: '12px' }}>
        {items.length} {items.length === 1 ? 'item requer' : 'itens requerem'} atenção. O restante da operação segue normal.
      </p>

      <ul className="space-y-2 text-sm">
        {items.map((item) => (
          <li
            key={`${item.kind}-${item.id}`}
            data-testid={`attention-item-${item.kind}`}
            className="border border-border-default rounded-lg p-3"
          >
            <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
              <span
                className="workspace-action-button"
                style={{ cursor: 'default', padding: '2px 8px', fontSize: '12px' }}
              >
                {SEVERITY_LABELS[item.severity] || item.severity}
              </span>
              <span className="text-text-secondary text-xs">
                {KIND_LABELS[item.kind] || item.kind}
              </span>
            </div>
            <div className="font-medium text-text-primary" style={{ marginTop: '6px' }}>
              {item.title}
            </div>
            {item.reason ? (
              <div className="text-text-secondary" style={{ marginTop: '4px' }}>{item.reason}</div>
            ) : null}

            <div className="flex gap-2" style={{ marginTop: '8px', flexWrap: 'wrap' }}>
              {item.action?.type === 'apply_recommendation' && onApply ? (
                <button
                  type="button"
                  className="workspace-action-button"
                  disabled={applyingId === item.id || dismissingId === item.id}
                  onClick={() => onApply(item)}
                >
                  {applyingId === item.id ? 'Aplicando...' : 'Aplicar'}
                </button>
              ) : null}
              {item.action?.type === 'apply_recommendation' && onDismiss ? (
                <button
                  type="button"
                  className="workspace-action-button"
                  disabled={applyingId === item.id || dismissingId === item.id}
                  onClick={() => onDismiss(item)}
                >
                  {dismissingId === item.id ? 'Dispensando...' : 'Dispensar'}
                </button>
              ) : null}
              {item.action?.type === 'view_details' && item.action?.target ? (
                <button
                  type="button"
                  className="workspace-action-button"
                  onClick={() => navigate(item.action.target)}
                >
                  Ver detalhes
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
