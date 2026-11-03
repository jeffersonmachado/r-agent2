import React, { useState } from 'react';
import { fetchJson } from '../../api/client';

/**
 * LroFeedbackDecision — botões de decisão humana para operação em WAITING_FEEDBACK.
 *
 * Regras que a UI NÃO pode quebrar (mandato LRO §7):
 *  - silêncio/prazo nunca aprova: a UI não tem auto-aprovação nem "aprovar por timeout";
 *  - cada decisão carrega uma `idempotencyKey` ESTÁVEL por (pedido, decisão) — duplo clique reenvia a
 *    MESMA chave, então o servidor devolve a resposta existente em vez de criar efeito novo;
 *  - recusa do servidor é MOSTRADA com o código (`FEEDBACK_JA_RESPONDIDO`, `FEEDBACK_EXPIRADO`,
 *    `FEEDBACK_VERSAO_OBSOLETA`, `classification_forbidden`), e os botões são desarmados quando a
 *    decisão não pode mais ser tomada.
 */

const CODIGOS_SEM_RETENTATIVA = new Set([
  'FEEDBACK_JA_RESPONDIDO',
  'FEEDBACK_EXPIRADO',
  'FEEDBACK_ENCERRADO',
  'FEEDBACK_VERSAO_OBSOLETA',
  'FEEDBACK_NAO_ENCONTRADO',
]);

export function LroFeedbackDecision({ requestId, onDecided = null, onError = null } = {}) {
  const [enviando, setEnviando] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);
  const [desarmado, setDesarmado] = useState(false);

  if (!requestId) return null;

  const decidir = async (decision) => {
    if (desarmado || enviando) return;
    setEnviando(decision);
    setErro(null);
    try {
      const resposta = await fetchJson(`/api/lro/feedback/${encodeURIComponent(requestId)}/respond`, {
        method: 'POST',
        // Chave estável por (pedido, decisão): duplo clique não duplica efeito.
        body: JSON.stringify({ decision, idempotencyKey: `ui:${requestId}:${decision}` }),
      });
      setResultado(resposta);
      setDesarmado(true);
      if (onDecided) onDecided(resposta);
    } catch (error) {
      const codigo = (error && (error.code || error.error)) || null;
      const mensagem = (error && error.message) || 'falha ao registrar decisão';
      setErro({ codigo, mensagem });
      if (codigo && CODIGOS_SEM_RETENTATIVA.has(codigo)) setDesarmado(true);
      if (onError) onError({ codigo, mensagem });
    } finally {
      setEnviando(null);
    }
  };

  return (
    <div className="lro-decisao" aria-label="Decisão humana">
      {resultado ? (
        <p className="lro-decisao__ok" role="status">
          Decisão registrada{resultado.operation && resultado.operation.status ? ` · operação ${resultado.operation.status}` : ''}
          {resultado.replayed ? ' (reenvio idempotente)' : ''}
        </p>
      ) : (
        <div className="lro-decisao__acoes">
          <button type="button" onClick={() => decidir('approve')} disabled={Boolean(enviando) || desarmado}>
            {enviando === 'approve' ? 'Aprovando…' : 'Aprovar'}
          </button>
          <button type="button" onClick={() => decidir('reject')} disabled={Boolean(enviando) || desarmado}>
            {enviando === 'reject' ? 'Rejeitando…' : 'Rejeitar'}
          </button>
        </div>
      )}

      {erro ? (
        <p className="lro-decisao__erro" role="alert">
          {erro.codigo ? `${erro.codigo}: ` : ''}{erro.mensagem}
        </p>
      ) : null}
    </div>
  );
}

export default LroFeedbackDecision;
