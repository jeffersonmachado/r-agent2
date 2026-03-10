import React, { useState } from 'react';
import { QuickActionsBar } from '../../recommendations';

function toLabel(value) {
  return String(value || 'recommendation')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function statusClass(value) {
  const key = String(value || '').toLowerCase();
  if (key === 'accepted' || key === 'executed') return 'bg-status-success/20 text-status-success border-status-success/30';
  if (key === 'ignored') return 'bg-bg-secondary text-text-secondary border-border-default';
  return 'bg-status-warning/20 text-status-warning border-status-warning/30';
}

function impactClass(value) {
  const key = String(value || '').toLowerCase();
  if (key === 'critical' || key === 'high') return 'bg-status-error/20 text-status-error border-status-error/30';
  if (key === 'medium') return 'bg-info/20 text-info border-info/30';
  return 'bg-bg-secondary text-text-secondary border-border-default';
}

export function OperationalRecommendationItem({
  recommendation,
  tenantId = '',
  quickActionsScope = 'admin',
  contactId = '',
  supportContext = null,
  onStatusChange = null,
}) {
  const [saving, setSaving] = useState(false);
  const status = String(recommendation?.status || 'open').toLowerCase();
  const confidencePct = Math.round((Number(recommendation?.confidence) || 0) * 100);
  const actions = Array.isArray(recommendation?.suggested_actions) ? recommendation.suggested_actions : [];

  async function handleChange(nextStatus) {
    if (!onStatusChange || saving) return;
    setSaving(true);
    try {
      await onStatusChange(recommendation?.id, nextStatus);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border-default bg-bg-primary p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-text-primary">{toLabel(recommendation?.type)}</div>
        <span className={`inline-flex items-center px-2 py-1 rounded-full border text-xs ${statusClass(status)}`}>
          {status}
        </span>
      </div>
      <div className="mt-2 text-xs text-text-secondary">{recommendation?.description || 'Recomendação operacional'}</div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className={`inline-flex items-center px-2 py-1 rounded-full border ${impactClass(recommendation?.impact_level || recommendation?.impactLevel)}`}>
          {String(recommendation?.impact_level || recommendation?.impactLevel || 'medium')}
        </span>
        <span className="text-text-secondary">prioridade {Number(recommendation?.priority) || 0}</span>
        <span className="text-text-secondary">conf. {confidencePct}%</span>
      </div>
      {actions.length > 0 ? (
        <div className="mt-2 text-xs text-text-tertiary">
          ação: {String(actions[0]?.action || 'inspect_channel')}
        </div>
      ) : null}
      <div className="mt-1 text-xs text-text-tertiary">
        módulo: {recommendation?.target_module || recommendation?.targetModule || 'support'}
      </div>
      {onStatusChange ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {status === 'open' ? (
            <>
              <button type="button" className="btn-default px-2 py-1 text-xs" disabled={saving} onClick={() => handleChange('accepted')}>
                Aceitar
              </button>
              <button type="button" className="btn-default px-2 py-1 text-xs" disabled={saving} onClick={() => handleChange('ignored')}>
                Ignorar
              </button>
              <button type="button" className="btn-default px-2 py-1 text-xs" disabled={saving} onClick={() => handleChange('executed')}>
                Executada
              </button>
            </>
          ) : (
            <button type="button" className="btn-default px-2 py-1 text-xs" disabled={saving} onClick={() => handleChange('open')}>
              Reabrir
            </button>
          )}
        </div>
      ) : null}
      <div className="mt-3">
        <QuickActionsBar
          scope={quickActionsScope}
          tenantId={tenantId}
          contactId={contactId || recommendation?.contact_id || recommendation?.contactId || ''}
          supportContext={supportContext}
          sourceType="recommendation"
          sourceId={recommendation?.id}
          sourceObject={recommendation}
          compact={true}
        />
      </div>
    </div>
  );
}
