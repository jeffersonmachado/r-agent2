import React from 'react';
import { SupportCard } from './SupportCard';

export function SupportSuggestedReplyCard({ suggestedReply }) {
  return (
    <SupportCard
      id="support-section-reply"
      title="Resposta sugerida"
      subtitle="Texto de apoio baseado na melhor evidência disponível"
    >
      {suggestedReply ? (
        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap' }}>
          {suggestedReply}
        </div>
      ) : (
        <div style={{ color: 'var(--color-text-tertiary)', fontSize: '12px' }}>
          Quando houver uma evidência forte, a sugestão aparecerá aqui sem interromper o fluxo atual.
        </div>
      )}
    </SupportCard>
  );
}
