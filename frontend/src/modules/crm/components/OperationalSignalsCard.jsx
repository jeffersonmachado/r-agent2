import React from 'react';
import { OperationalSignalItem } from './OperationalSignalItem';

export function OperationalSignalsCard({
  title = 'Sinais Operacionais',
  subtitle = '',
  tenantId = '',
  quickActionsScope = 'admin',
  contactId = '',
  supportContext = null,
  enabled = true,
  signals = [],
  loading = false,
  error = '',
  onRefresh = null,
  onGenerate = null,
  onStatusChange = null,
  emptyMessage = 'Nenhum sinal operacional detectado.',
}) {
  const items = Array.isArray(signals) ? signals : [];
  const openCount = items.filter((item) => String(item?.status || 'open').toLowerCase() === 'open').length;

  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-text-primary">{title}</div>
          <div className="mt-1 text-xs text-text-secondary">
            {items.length} sinais • {openCount} abertos
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
        {subtitle || (enabled ? 'Monitoramento operacional ativo.' : 'Monitoramento operacional desabilitado.')}
      </div>

      {!enabled ? (
        <div className="mt-3 text-xs text-text-tertiary">Recurso desabilitado para este contexto.</div>
      ) : loading ? (
        <div className="mt-3 text-xs text-text-tertiary">Carregando sinais operacionais...</div>
      ) : error ? (
        <div className="mt-3 text-xs text-status-error">Falha ao carregar sinais operacionais.</div>
      ) : items.length === 0 ? (
        <div className="mt-3 text-xs text-text-tertiary">{emptyMessage}</div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {items.slice(0, 8).map((item) => (
            <OperationalSignalItem
              key={item.id}
              signal={item}
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
