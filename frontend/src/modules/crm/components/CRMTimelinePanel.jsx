import React from 'react';
import { CRMTimelineSummaryCard } from './CRMTimelineSummaryCard';

function formatCrmOperationalType(value) {
  const key = String(value || '').toLowerCase();
  if (!key) return 'Evento CRM';
  if (key.includes('upserted')) return 'Atualização CRM';
  if (key.includes('activity')) return 'Atividade';
  if (key.includes('opportunity')) return 'Oportunidade';
  if (key.includes('revenue')) return 'Revenue';
  if (key.includes('schedule')) return 'Agendamento';
  if (key.includes('ticket')) return 'Suporte';
  return String(value);
}

function describeCrmOperationalItem(item) {
  const payload = item && typeof item === 'object' && item.payload && typeof item.payload === 'object'
    ? item.payload
    : {};
  if (payload?.opportunity?.title) return payload.opportunity.title;
  if (payload?.revenueOpportunity?.type) return `Revenue: ${payload.revenueOpportunity.type}`;
  if (payload?.type) return `Atividade: ${payload.type}`;
  if (payload?.status) return `Status: ${payload.status}`;
  if (item?.reference_type && item?.reference_id) return `${item.reference_type}: ${item.reference_id}`;
  if (item?.reference_type) return String(item.reference_type);
  return 'Evento operacional';
}

function defaultFormatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR');
}

export function CRMTimelinePanel({
  enabled = true,
  contactId = '',
  profile = null,
  timeline = [],
  loading = false,
  formatDate = defaultFormatDate,
}) {
  const relationships = profile?.relationships || null;
  const items = Array.isArray(timeline) ? timeline : [];

  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <div style={{ fontWeight: 700 }}>Timeline CRM</div>
      </div>

      <CRMTimelineSummaryCard
        title="Resumo"
        opportunitiesCount={relationships?.opportunitiesCount || 0}
        revenueOpportunitiesCount={relationships?.revenueOpportunitiesCount || 0}
        timelineCount={items.length}
        enabled={enabled}
      />

      {!enabled ? (
        <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
          Cockpit CRM desabilitado para este tenant.
        </div>
      ) : !contactId ? (
        <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
          Ticket sem vínculo de contato CRM.
        </div>
      ) : loading ? (
        <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>Carregando...</div>
      ) : items.length === 0 ? (
        <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
          Nenhum evento operacional para este contato.
        </div>
      ) : (
        <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {items.slice(0, 6).map((item) => (
            <div key={item.id} style={{ border: '1px solid var(--color-border-default)', borderRadius: '8px', padding: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                <strong style={{ fontSize: '12px' }}>{formatCrmOperationalType(item.type)}</strong>
                <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
                  {formatDate(item.created_at)}
                </span>
              </div>
              <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                {describeCrmOperationalItem(item)}
              </div>
              <div style={{ marginTop: '2px', fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
                {item.source_module || 'crm'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
