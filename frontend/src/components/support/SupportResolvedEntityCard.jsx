import React from 'react';
import { SupportCard } from './SupportCard';
import { formatSupportTechnicalLabel } from './supportHumanization';

function formatEvidenceLabel(value) {
  return formatSupportTechnicalLabel(value);
}

export function SupportResolvedEntityCard({ identity, loading }) {
  return (
    <SupportCard
      id="support-section-entity"
      title="Entidade resolvida"
      subtitle="Correlação principal do atendimento atual"
      badge={(
        <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
          {loading ? 'Carregando…' : (identity ? `${Math.round((identity.confidence || 0) * 100)}%` : 'sem match')}
        </div>
      )}
    >
      {identity ? (
        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
          <div>Tipo: <strong>{formatEvidenceLabel(identity.entityType)}</strong></div>
          <div>ID: <code>{identity.entityId}</code></div>
          <div style={{ marginTop: '8px' }}>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>Fontes</div>
            {(identity.sources || []).slice(0, 4).map((source, index) => (
              <div key={`${source.type || 'src'}-${index}`}>
                {formatEvidenceLabel(source.type || 'source')}
                {source.id ? ` • ${source.id}` : ''}
                {source.field ? ` • ${source.field}` : ''}
              </div>
            ))}
          </div>
          <div style={{ marginTop: '8px' }}>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>Relacionados</div>
            {(identity.relatedEntities || []).length === 0 ? (
              <div style={{ color: 'var(--color-text-tertiary)' }}>Sem entidades relacionadas detectadas.</div>
            ) : (
              (identity.relatedEntities || []).slice(0, 8).map((entity) => (
                <div key={`${entity.type}:${entity.id}`}>
                  {formatEvidenceLabel(entity.type)}: <code>{entity.id}</code>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div style={{ color: 'var(--color-text-tertiary)', fontSize: '12px' }}>
          Nenhuma entidade foi resolvida com confiança suficiente para este atendimento.
        </div>
      )}
    </SupportCard>
  );
}
