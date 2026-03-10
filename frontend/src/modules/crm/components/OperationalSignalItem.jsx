import React, { useState } from 'react';
import { QuickActionsBar } from '../../recommendations';

function toLabel(value) {
  return String(value || 'signal')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function severityClass(value) {
  const key = String(value || '').toLowerCase();
  if (key === 'critical') return 'bg-status-error/20 text-status-error border-status-error/30';
  if (key === 'high') return 'bg-status-warning/20 text-status-warning border-status-warning/30';
  if (key === 'medium') return 'bg-info/20 text-info border-info/30';
  return 'bg-bg-secondary text-text-secondary border-border-default';
}

function statusClass(value) {
  const key = String(value || '').toLowerCase();
  if (key === 'resolved') return 'bg-status-success/20 text-status-success border-status-success/30';
  if (key === 'acknowledged') return 'bg-info/20 text-info border-info/30';
  if (key === 'expired') return 'bg-bg-secondary text-text-secondary border-border-default';
  return 'bg-status-warning/20 text-status-warning border-status-warning/30';
}

function defaultFormatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR');
}

export function OperationalSignalItem({
  signal,
  tenantId = '',
  quickActionsScope = 'admin',
  contactId = '',
  supportContext = null,
  formatDate = defaultFormatDate,
  onStatusChange = null,
}) {
  const [saving, setSaving] = useState(false);
  const status = String(signal?.status || 'open').toLowerCase();
  const confidencePct = Math.round((Number(signal?.confidence) || 0) * 100);

  async function handleChange(nextStatus) {
    if (!onStatusChange || saving) return;
    setSaving(true);
    try {
      await onStatusChange(signal?.id, nextStatus);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border-default bg-bg-primary p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-text-primary">{toLabel(signal?.type)}</div>
        <span className={`inline-flex items-center px-2 py-1 rounded-full border text-xs ${statusClass(status)}`}>
          {status}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className={`inline-flex items-center px-2 py-1 rounded-full border ${severityClass(signal?.severity)}`}>
          {String(signal?.severity || 'low')}
        </span>
        <span className="text-text-secondary">conf. {confidencePct}%</span>
      </div>
      <div className="mt-2 text-xs text-text-secondary">
        origem: {signal?.source_module || 'operational_agent'}
      </div>
      <div className="mt-1 text-xs text-text-tertiary">
        detectado: {formatDate(signal?.detected_at || signal?.created_at)}
      </div>
      {onStatusChange ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {status === 'open' ? (
              <>
                <button type="button" className="btn-default px-2 py-1 text-xs" disabled={saving} onClick={() => handleChange('acknowledged')}>
                  Reconhecer
                </button>
                <button type="button" className="btn-default px-2 py-1 text-xs" disabled={saving} onClick={() => handleChange('resolved')}>
                  Resolver
                </button>
              </>
            ) : null}
            {status === 'acknowledged' ? (
              <>
                <button type="button" className="btn-default px-2 py-1 text-xs" disabled={saving} onClick={() => handleChange('open')}>
                  Reabrir
                </button>
                <button type="button" className="btn-default px-2 py-1 text-xs" disabled={saving} onClick={() => handleChange('resolved')}>
                  Resolver
                </button>
              </>
            ) : null}
          </div>
          <div className="mt-3">
            <QuickActionsBar
              scope={quickActionsScope}
              tenantId={tenantId}
              contactId={contactId || signal?.contact_id || signal?.contactId || ''}
              supportContext={supportContext}
              sourceType="signal"
              sourceId={signal?.id}
              sourceObject={signal}
              compact={true}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
