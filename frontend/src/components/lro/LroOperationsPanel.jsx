import React, { useCallback, useEffect, useState } from 'react';
import { fetchJson } from '../../api/client';
import { useLroStream } from '../../shared/useLroStream';
import { LroFeedbackDecision } from './LroFeedbackDecision';

/**
 * LroOperationsPanel — superfície DEVELOPMENT para operações longas.
 *
 * Regras que este componente respeita (mandato LRO §9):
 *  - cada fonte é independente: falha da LISTA não apaga o detalhe já carregado, e vice-versa;
 *  - o detalhe mostra estado da CONEXÃO (conectando/aberto/reconectando/fechado) — a UI não finge
 *    tempo real quando o stream caiu;
 *  - `COMPLETED` aparece com o DESFECHO ao lado: concluir não é aprovar.
 */

const ROTULO_STATUS = {
  CREATED: 'Criada',
  QUEUED: 'Na fila',
  RUNNING: 'Em execução',
  WAITING_FEEDBACK: 'Aguardando decisão',
  PAUSED: 'Pausada',
  COMPLETED: 'Concluída',
  FAILED: 'Falhou',
  CANCELLED: 'Cancelada',
  TIMED_OUT: 'Expirada',
};

const ROTULO_CONEXAO = {
  connecting: 'conectando',
  open: 'ao vivo',
  reconnecting: 'reconectando',
  closed: 'desconectado',
};

function progresso(item) {
  if (item.progressTotal && item.progressTotal > 0) {
    const atual = Number(item.progressCurrent || 0);
    return `${atual}/${item.progressTotal} ${item.progressUnit || ''}`.trim();
  }
  // Total desconhecido ⇒ indeterminado (nunca 100%).
  return item.progressCurrent != null ? `${item.progressCurrent}+ ${item.progressUnit || ''}`.trim() : '—';
}

export function LroOperationsPanel({ baseUrl = '', token = null, tenantId = null, limit = 20 }) {
  const [itens, setItens] = useState([]);
  const [erroLista, setErroLista] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [selecionada, setSelecionada] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const resposta = await fetchJson(`/api/lro?limit=${encodeURIComponent(limit)}`);
      setItens(Array.isArray(resposta.items) ? resposta.items : []);
      setErroLista(null);
    } catch (error) {
      // Falha da lista é ANUNCIADA; o que já estava na tela permanece.
      setErroLista(error && error.message ? error.message : 'falha ao listar operações');
    } finally {
      setCarregando(false);
    }
  }, [limit]);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando && itens.length === 0) {
    return <div className="lro-panel lro-panel--loading">Carregando operações…</div>;
  }

  return (
    <section className="lro-panel" aria-label="Operações de longa duração">
      <header className="lro-panel__header">
        <h3>Operações (LRO)</h3>
        <button type="button" onClick={carregar}>Atualizar</button>
      </header>

      {erroLista ? (
        <p className="lro-panel__erro" role="alert">Não foi possível listar: {erroLista}</p>
      ) : null}

      {itens.length === 0 ? (
        <p className="lro-panel__vazio">Nenhuma operação registrada.</p>
      ) : (
        <table className="lro-panel__tabela">
          <thead>
            <tr>
              <th scope="col">Tipo</th>
              <th scope="col">Status</th>
              <th scope="col">Progresso</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => (
              <tr key={item.id} aria-selected={selecionada === item.id}>
                <td>
                  <button type="button" onClick={() => setSelecionada(item.id)}>
                    {item.operationType}
                  </button>
                </td>
                <td>
                  {ROTULO_STATUS[item.status] || item.status}
                  {item.status === 'COMPLETED' && item.outcome ? ` (${item.outcome})` : ''}
                </td>
                <td>{progresso(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selecionada ? (
        <LroOperationDetail
          operationId={selecionada}
          feedbackRequestId={(itens.find((i) => i.id === selecionada) || {}).feedbackRequestId || null}
          baseUrl={baseUrl}
          token={token}
          tenantId={tenantId}
          onDecided={carregar}
        />
      ) : null}
    </section>
  );
}

function LroOperationDetail({ operationId, feedbackRequestId, baseUrl, token, tenantId, onDecided }) {
  const [eventos, setEventos] = useState([]);
  const { state, lastSeq } = useLroStream({
    operationId,
    baseUrl,
    token,
    tenantId,
    onEvent: (evento) => setEventos((anteriores) => [...anteriores, evento]),
  });

  return (
    <div className="lro-detalhe" aria-label={`Detalhe da operação ${operationId}`}>
      <p className="lro-detalhe__conexao" data-state={state}>
        conexão: {ROTULO_CONEXAO[state] || state} · último evento: {lastSeq}
      </p>
      {feedbackRequestId ? (
        <LroFeedbackDecision requestId={feedbackRequestId} onDecided={onDecided} />
      ) : null}

      {eventos.length === 0 ? (
        <p className="lro-detalhe__vazio">Sem eventos ainda.</p>
      ) : (
        <ol className="lro-detalhe__eventos">
          {eventos.map((evento) => (
            <li key={`${evento.seq}-${evento.type}`}>
              <strong>{evento.type}</strong>
              {evento.payload && evento.payload.outcome ? ` · ${evento.payload.outcome}` : ''}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default LroOperationsPanel;
