import React from 'react';
import { Button } from '../../styles/Button';
import { SupportCard } from './SupportCard';
import {
  formatSupportEvidenceReason,
  formatSupportTechnicalLabel,
} from './supportHumanization';

function formatEvidenceLabel(value) {
  return formatSupportTechnicalLabel(value);
}

function formatEvidenceOrigin(origin) {
  const kind = origin?.label || origin?.kind;
  if (!kind) return 'desconhecida';
  return formatEvidenceLabel(kind);
}

function formatOriginLocator(locator) {
  if (!locator) return 'origem não mapeada';
  const mode = locator.canOpenDirectly ? 'abertura direta' : 'abertura contextual';
  return `${formatEvidenceLabel(locator.sourceType || 'origem')} • ${mode}`;
}

export function SupportEvidenceCard({
  evidenceResult,
  loading,
  formatDate,
  onOpenSource,
  onCopyEvidence,
  onUseAsReply,
}) {
  const items = [evidenceResult?.best, ...(evidenceResult?.alternatives || [])].filter(Boolean);

  return (
    <SupportCard
      id="support-section-evidence"
      title="Evidências relacionadas"
      subtitle="Melhor prova disponível para apoiar a resposta atual"
      badge={(
        <div className="text-xs text-text-tertiary">
          {loading ? 'Carregando…' : `${items.length} item(ns)`}
        </div>
      )}
    >
      {items.length > 0 ? (
        items.map((evidence, index) => (
          <div
            key={evidence.id || index}
            style={{ padding: '10px', borderRadius: '10px', border: '1px solid var(--color-border-default)', background: 'var(--color-bg-secondary)', marginBottom: index === items.length - 1 ? 0 : '10px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginBottom: '6px' }}>
              <div>
                <strong>{formatEvidenceLabel(evidence.type)}</strong>
                {evidence.theme ? ` • ${formatEvidenceLabel(evidence.theme)}` : ''}
              </div>
              <div style={{ color: 'var(--color-text-tertiary)' }}>{formatDate(evidence.occurred_at)}</div>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '6px', display: 'grid', gap: '4px' }}>
              <div>{formatEvidenceLabel(evidence.category)} • origem {formatEvidenceLabel(evidence.source_type)} • força {formatEvidenceLabel(evidence.strength)}</div>
              <div>Modo {formatEvidenceOrigin(evidence.evidence_origin)}</div>
              {evidence.origin_locator ? <div>{formatOriginLocator(evidence.origin_locator)}</div> : null}
              <div>Confiança {Math.round((evidence.confidence || 0) * 100)}% • pontuação {evidence.reasoning?.score || 0}</div>
              {evidence.reasoning?.matchedBy?.length ? <div>Critérios de correspondência: {evidence.reasoning.matchedBy.map((item) => formatEvidenceLabel(item)).join(', ')}</div> : null}
              {evidence.source_ref?.ticketId || evidence.source_ref?.conversationId || evidence.source_id ? (
                <div>
                  {evidence.source_ref?.ticketId ? `ticket ${evidence.source_ref.ticketId}` : null}
                  {evidence.source_ref?.ticketId && evidence.source_ref?.conversationId ? ' • ' : null}
                  {evidence.source_ref?.conversationId ? `conversa ${evidence.source_ref.conversationId}` : null}
                  {(evidence.source_ref?.ticketId || evidence.source_ref?.conversationId) && evidence.source_id ? ' • ' : null}
                  {evidence.source_id ? `origem ${evidence.source_id}` : null}
                </div>
              ) : null}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>
              {evidence.excerpt || evidence.summary}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
              <Button type="button" onClick={() => onOpenSource(evidence)} style={{ width: 'auto' }}>Abrir origem</Button>
              <Button type="button" onClick={() => onCopyEvidence(evidence)} style={{ width: 'auto' }}>Copiar evidência</Button>
              <Button type="button" onClick={() => onUseAsReply(evidence)} style={{ width: 'auto' }}>Usar na resposta</Button>
            </div>
          </div>
        ))
      ) : (
        <div style={{ color: 'var(--color-text-tertiary)', fontSize: '12px' }}>
          {evidenceResult?.reasoning?.reason
            ? `Nenhuma evidência forte foi encontrada: ${formatSupportEvidenceReason(evidenceResult.reasoning.reason) || formatEvidenceLabel(evidenceResult.reasoning.reason)}.`
            : 'Nenhuma evidência histórica relevante foi encontrada para o contexto atual.'}
        </div>
      )}
    </SupportCard>
  );
}
