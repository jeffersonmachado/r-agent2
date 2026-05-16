import React, { useState, useMemo } from 'react';
import { Button } from '../../styles/Button';
import { SupportCard } from './SupportCard';
import { formatSupportTechnicalLabel } from './supportHumanization';

function formatEvidenceLabel(value) {
  return formatSupportTechnicalLabel(value);
}

function formatOriginLocator(locator) {
  if (!locator) return 'origem não mapeada';
  const mode = locator.canOpenDirectly ? 'abertura direta' : 'abertura contextual';
  return `${formatEvidenceLabel(locator.sourceType || 'origem')} • ${mode}`;
}

function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const PAGE_SIZE = 6;

export function SupportHistoryCard({ timeline = [], loading, formatDate, onOpenItem }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const filteredTimeline = useMemo(() => {
    if (!searchQuery.trim()) return timeline;
    const query = normalizeText(searchQuery);
    return timeline.filter((item) => {
      const searchableText = [
        item.title,
        item.type,
        item.source,
        item.text,
        item.sourceType,
      ]
        .filter(Boolean)
        .map((v) => normalizeText(v))
        .join(' ');
      return searchableText.includes(query);
    });
  }, [timeline, searchQuery]);
  return (
    <SupportCard
      id="support-section-history"
      title="Histórico consolidado"
      subtitle="Linha do tempo consolidada por entidade e contexto"
      badge={(
        <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
          {loading ? 'Carregando…' : `${filteredTimeline.length}/${timeline.length} item(ns)`}
        </div>
      )}
    >
      {timeline.length > 0 ? (
        <>
          <div style={{ marginBottom: '12px' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="🔍 Buscar na timeline…"
              className="support-history-search-input"
              aria-label="Buscar no histórico consolidado"
            />
          </div>
          {filteredTimeline.length > 0 ? (
            <>
              {(showAll ? filteredTimeline : filteredTimeline.slice(0, PAGE_SIZE)).map((item, index, arr) => (
                <div
                  key={item.id}
                  style={{ padding: '10px', borderRadius: '10px', border: '1px solid var(--color-border-default)', background: 'var(--color-bg-secondary)', marginBottom: index === arr.length - 1 ? 0 : '10px' }}
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
              ))}
              {filteredTimeline.length > PAGE_SIZE ? (
                <button
                  type="button"
                  onClick={() => setShowAll((prev) => !prev)}
                  style={{ marginTop: '10px', width: '100%', padding: '6px', borderRadius: '8px', border: '1px solid var(--color-border-default)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: '12px', cursor: 'pointer' }}
                >
                  {showAll ? '▲ Mostrar menos' : `▼ Ver mais (${filteredTimeline.length - PAGE_SIZE} oculto${filteredTimeline.length - PAGE_SIZE > 1 ? 's' : ''})`}
                </button>
              ) : null}
            </>
          ) : (
            <div style={{ color: 'var(--color-text-tertiary)', fontSize: '12px', padding: '8px' }}>
              Nenhum item encontrado com "{searchQuery}".
            </div>
          )}
        </>
      ) : (
        <div style={{ color: 'var(--color-text-tertiary)', fontSize: '12px' }}>
          O histórico consolidado aparecerá aqui quando o contexto atual puder ser relacionado a conversas, tickets ou eventos anteriores.
        </div>
      )}
    </SupportCard>
  );
}
