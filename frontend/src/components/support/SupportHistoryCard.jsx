import React from 'react';
import { Button } from '../../styles/Button';
import { SupportCard } from './SupportCard';

function formatEvidenceLabel(value) {
  if (!value) return 'n/a';
  return String(value).replace(/_/g, ' ');
}

function formatOriginLocator(locator) {
  if (!locator) return 'origem não mapeada';
  const mode = locator.canOpenDirectly ? 'abertura direta' : 'abertura contextual';
  return `${formatEvidenceLabel(locator.sourceType || 'origem')} • ${mode}`;
}

export function SupportHistoryCard({ timeline = [], loading, formatDate, onOpenItem }) {
  return (
    <SupportCard
      id="support-section-history"
      title="Histórico consolidado"
      subtitle="Linha do tempo consolidada por entidade e contexto"
      badge={(
        <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
          {loading ? 'Carregando…' : `${timeline.length} item(ns)`}
        </div>
      )}
    >
      {timeline.length > 0 ? (
        timeline.slice(0, 6).map((item, index) => (
          <div
            key={item.id}
            style={{ padding: '10px', borderRadius: '10px', border: '1px solid var(--color-border-default)', background: 'var(--color-bg-secondary)', marginBottom: index === Math.min(timeline.length, 6) - 1 ? 0 : '10px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginBottom: '6px' }}>
              <div>
                <strong>{item.title || formatEvidenceLabel(item.type)}</strong>
                {item.source ? ` • ${formatEvidenceLabel(item.source)}` : ''}
              </div>
              <div style={{ color: 'var(--color-text-tertiary)', fontSize: '12px' }}>{formatDate(item.timestamp)}</div>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>
              {item.text || 'Sem conteúdo textual disponível.'}
            </div>
            {item.originLocator ? (
              <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', marginTop: '6px' }}>
                {formatOriginLocator(item.originLocator)}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
              <Button type="button" onClick={() => onOpenItem(item)} style={{ width: 'auto' }}>Abrir origem</Button>
            </div>
          </div>
        ))
      ) : (
        <div style={{ color: 'var(--color-text-tertiary)', fontSize: '12px' }}>
          O histórico consolidado aparecerá aqui quando o contexto atual puder ser relacionado a conversas, tickets ou eventos anteriores.
        </div>
      )}
    </SupportCard>
  );
}
