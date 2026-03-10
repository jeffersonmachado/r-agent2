import React from 'react';
import { OperationalRecommendationItem } from './OperationalRecommendationItem';

export function OperationalRecommendationsCard({
  title = 'Recomendações Operacionais',
  subtitle = '',
  tenantId = '',
  quickActionsScope = 'admin',
  contactId = '',
  supportContext = null,
  enabled = true,
  recommendations = [],
  loading = false,
  error = '',
  onRefresh = null,
  onGenerate = null,
  onStatusChange = null,
  emptyMessage = 'Nenhuma recomendação operacional disponível.',
}) {
  const items = Array.isArray(recommendations) ? recommendations : [];
  const openCount = items.filter((item) => String(item?.status || 'open').toLowerCase() === 'open').length;

  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-text-primary">{title}</div>
          <div className="mt-1 text-xs text-text-secondary">
            {items.length} recomendações • {openCount} abertas
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onRefresh ? (
            <button type="button" className="btn-default px-2 py-1 text-xs" onClick={onRefresh}>
              Atualizar
            </button>
          ) : null}
          {onGenerate ? (
            <button type="button" className="btn-default px-2 py-1 text-xs" onClick={onGenerate}>
              Gerar
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-2 text-xs text-text-tertiary">
        {subtitle || (enabled ? 'Recomendações orientadas por sinais operacionais.' : 'Recomendações desabilitadas para este contexto.')}
      </div>

      {!enabled ? (
        <div className="mt-3 text-xs text-text-tertiary">Recurso desabilitado para este contexto.</div>
      ) : loading ? (
        <div className="mt-3 text-xs text-text-tertiary">Carregando recomendações operacionais...</div>
      ) : error ? (
        <div className="mt-3 text-xs text-status-error">Falha ao carregar recomendações operacionais.</div>
      ) : items.length === 0 ? (
        <div className="mt-3 text-xs text-text-tertiary">{emptyMessage}</div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {items.slice(0, 8).map((item) => (
            <OperationalRecommendationItem
              key={item.id}
              recommendation={item}
              tenantId={tenantId}
              quickActionsScope={quickActionsScope}
              contactId={contactId}
              supportContext={supportContext}
              onStatusChange={onStatusChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
