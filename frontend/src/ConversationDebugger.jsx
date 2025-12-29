import React, { useEffect, useMemo, useState } from 'react';

/**
 * Debugger visual de conversa.
 *
 * Requisitos atendidos:
 * - Timeline: lista cronológica de mensagens/eventos.
 * - Destaque de nós: cada item mostra o nodeId e permite "seek"
 *   para aquele ponto da conversa (via callback onSeekNode).
 * - Visualização de variáveis: mostra snapshot de variables do
 *   passo selecionado (quando disponível).
 * - Replay controlado: botões de play/pause/step para navegar
 *   pelos passos.
 *
 * Decisão importante:
 * - Este componente NÃO fala com a engine diretamente; ele apenas
 *   consome dados já produzidos (replay + steps de simulação).
 * - Isso mantém o debugger desacoplado da execução.
 */

/**
 * @param {{
 *   replay: {
 *     messages: Array<{ from: string, text: string, at: string }>,
 *     nodesVisited: Array<{ nodeId: string|null, at: string }>
 *   },
 *   steps?: Array<{ index: number, stateAfter: { variables: Record<string, any> } }>,
 *   onSeekNode?: (nodeId: string|null, stepIndex: number) => void
 * }} props
 */
export function ConversationDebugger({ replay, steps, onSeekNode }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playIntervalMs, setPlayIntervalMs] = useState(800);

  // Timeline simples baseada nas mensagens; em um futuro, podemos
  // combinar com outros eventos (handoff, IA, etc.).
  const timeline = useMemo(() => {
    if (!replay || !Array.isArray(replay.messages)) return [];
    return replay.messages.map((m, idx) => ({
      idx,
      from: m.from,
      text: m.text,
      at: m.at,
      nodeId: (replay.nodesVisited && replay.nodesVisited[idx] && replay.nodesVisited[idx].nodeId) || null,
    }));
  }, [replay]);

  const maxIndex = timeline.length > 0 ? timeline.length - 1 : 0;

  useEffect(() => {
    if (!isPlaying || timeline.length === 0) return undefined;

    const id = setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev >= maxIndex) {
          return prev;
        }
        const next = prev + 1;
        const item = timeline[next];
        if (item && typeof onSeekNode === 'function') {
          onSeekNode(item.nodeId, next);
        }
        return next;
      });
    }, playIntervalMs);

    return () => clearInterval(id);
  }, [isPlaying, playIntervalMs, timeline, maxIndex, onSeekNode]);

  const currentItem = timeline[currentIndex] || null;
  const currentVariables =
    Array.isArray(steps) && steps[currentIndex] && steps[currentIndex].stateAfter
      ? steps[currentIndex].stateAfter.variables || {}
      : {};

  const handleSelectIndex = (idx) => {
    setCurrentIndex(idx);
    setIsPlaying(false);
    const item = timeline[idx];
    if (item && typeof onSeekNode === 'function') {
      onSeekNode(item.nodeId, idx);
    }
  };

  return (
    <div className="conversation-debugger">
      {/* Timeline */}
      <div className="conversation-debugger-timeline">
        <div className="conversation-debugger-timeline-header">
          <strong>Timeline</strong>
          <button onClick={() => setIsPlaying((p) => !p)} disabled={timeline.length === 0}>
            {isPlaying ? 'Pausar' : 'Reproduzir'}
          </button>
          <button
            onClick={() => handleSelectIndex(Math.max(0, currentIndex - 1))}
            disabled={currentIndex <= 0 || timeline.length === 0}
          >
            ◀
          </button>
          <button
            onClick={() => handleSelectIndex(Math.min(maxIndex, currentIndex + 1))}
            disabled={currentIndex >= maxIndex || timeline.length === 0}
          >
            ▶
          </button>
          <label className="conversation-debugger-timeline-label">
            Velocidade (ms)
            <input
              type="number"
              min={200}
              max={5000}
              step={100}
              value={playIntervalMs}
              onChange={(e) => setPlayIntervalMs(Number(e.target.value) || 800)}
              className="conversation-debugger-timeline-input"
            />
          </label>
        </div>

        <div className="conversation-debugger-timeline-list">
          {timeline.length === 0 && <div>Nenhum evento de conversa disponível.</div>}
          {timeline.map((item) => (
            <div
              key={item.idx}
              onClick={() => handleSelectIndex(item.idx)}
              className={`conversation-debugger-timeline-item ${
                item.idx === currentIndex ? 'conversation-debugger-timeline-item--selected' : ''
              }`}
            >
              <div className="conversation-debugger-timeline-item-header">
                <span className="conversation-debugger-timeline-item-from">
                  {item.from === 'user' ? 'Usuário' : 'Bot'}
                </span>
                <span className="conversation-debugger-timeline-item-time">{new Date(item.at).toLocaleTimeString()}</span>
              </div>
              <div className="conversation-debugger-timeline-item-text">{item.text}</div>
              <div className="conversation-debugger-timeline-item-node">Nó: {item.nodeId || 'desconhecido'}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Painel direito: detalhes do passo atual */}
      <div className="conversation-debugger-details">
        <div>
          <strong>Passo atual</strong>
          <div className="conversation-debugger-details-section-title" style={{ color: 'var(--color-text-tertiary)' }}>
            Índice: {currentIndex} / {maxIndex}
          </div>
          {currentItem && (
            <div className="conversation-debugger-details-section" style={{ marginTop: '4px', fontSize: '12px' }}>
              <div>Origem: {currentItem.from === 'user' ? 'Usuário' : 'Bot'}</div>
              <div>Horário: {new Date(currentItem.at).toLocaleString()}</div>
              <div>Nó: {currentItem.nodeId || 'desconhecido'}</div>
            </div>
          )}
        </div>

        <div className="conversation-debugger-details-variables">
          <div className="conversation-debugger-details-variables-title">
            <strong>Variáveis (snapshot)</strong>
          </div>
          <div className="conversation-debugger-details-variables-content">
            {Object.keys(currentVariables).length === 0 ? (
              <span>Nenhuma variável registrada neste passo.</span>
            ) : (
              <pre className="conversation-debugger-details-pre">{JSON.stringify(currentVariables, null, 2)}</pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


