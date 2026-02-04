import React from 'react';
import { Button } from '../styles/Button';

export function FlowCurrentDisplay({ displayedFlow, onRegenerate, kind, onKindChange }) {
  const aiGeneration = displayedFlow?.metadata?.aiGeneration || null;
  const usedFallback =
    typeof aiGeneration?.usedFallback === 'boolean' ? aiGeneration.usedFallback : null;
  const attemptsCount = Array.isArray(aiGeneration?.attempts)
    ? aiGeneration.attempts.length
    : null;
  const qualityScore =
    typeof aiGeneration?.qualityScore === 'number' ? aiGeneration.qualityScore : null;
  const fallbackReason =
    typeof aiGeneration?.fallbackReason === 'string' ? aiGeneration.fallbackReason : null;
  const providerErrorMessage =
    typeof aiGeneration?.providerErrorMessage === 'string' ? aiGeneration.providerErrorMessage : null;
  const failureSource =
    typeof aiGeneration?.failureSource === 'string' ? aiGeneration.failureSource : null;
  const failureMessage =
    typeof aiGeneration?.failureMessage === 'string' ? aiGeneration.failureMessage : null;

  return (
    <div className="flow-current-display">
      Fluxo atual:{' '}
      <strong className="ml-1">
        {displayedFlow ? (displayedFlow.name || displayedFlow.id) : 'não carregado'}
      </strong>

      {displayedFlow && (
        <span className="ml-3 inline-flex items-center gap-2 text-xs text-text-secondary">
          <span>Tipo:</span>
          <select
            value={String(kind || displayedFlow?.kind || 'chat').toLowerCase() === 'voice' ? 'voice' : 'chat'}
            onChange={(e) => onKindChange && onKindChange(e.target.value)}
            className="border border-border-default rounded px-2 py-1 bg-bg-elevated text-text-primary"
            title="Define se o fluxo é de chat ou voz (URA)"
          >
            <option value="chat">Chat</option>
            <option value="voice">Voz (URA)</option>
          </select>
        </span>
      )}

      {displayedFlow && (
        <Button
          variant="ghost"
          size="sm"
          className="ml-2"
          onClick={onRegenerate}
          title="Gerar novamente com IA"
        >
          Gerar novamente
        </Button>
      )}

      {usedFallback !== null && (
        <span
          className={`ml-2 text-xs border border-border-default rounded-full px-2 py-0.5 ${
            usedFallback
              ? 'bg-status-warning/10 text-status-warning'
              : 'bg-status-success/10 text-status-success'
          }`}
          title={[
            usedFallback
              ? 'Este fluxo foi gerado via fallback (sem provider de IA ou falha na geração).'
              : 'Este fluxo foi gerado por IA.',
            usedFallback && fallbackReason ? `Motivo: ${fallbackReason}` : null,
            usedFallback && failureMessage
              ? (failureSource === 'provider' ? `Provider: ${failureMessage}` : `Falha: ${failureMessage}`)
              : (usedFallback && providerErrorMessage ? `Provider: ${providerErrorMessage}` : null),
            qualityScore !== null ? `Score: ${qualityScore}` : null,
            attemptsCount !== null ? `Tentativas: ${attemptsCount}` : null,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {usedFallback ? 'Fallback' : 'IA'}
          {qualityScore !== null ? ` · Score: ${qualityScore}` : ''}
          {attemptsCount !== null ? ` · Tentativas: ${attemptsCount}` : ''}
          {usedFallback ? ' · Falha' : ''}
        </span>
      )}
    </div>
  );
}

