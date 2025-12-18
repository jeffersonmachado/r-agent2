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
    <div style={{ display: 'flex', height: '100%', fontFamily: 'system-ui, sans-serif', fontSize: '13px' }}>
      {/* Timeline */}
      <div
        style={{
          flex: 2,
          borderRight: '1px solid #ddd',
          padding: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
          <label style={{ marginLeft: 'auto', fontSize: '11px' }}>
            Velocidade (ms)
            <input
              type="number"
              min={200}
              max={5000}
              step={100}
              value={playIntervalMs}
              onChange={(e) => setPlayIntervalMs(Number(e.target.value) || 800)}
              style={{ width: '70px', marginLeft: '4px' }}
            />
          </label>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', borderTop: '1px solid #eee', paddingTop: '4px' }}>
          {timeline.length === 0 && <div>Nenhum evento de conversa disponível.</div>}
          {timeline.map((item) => (
            <div
              key={item.idx}
              onClick={() => handleSelectIndex(item.idx)}
              style={{
                padding: '6px 8px',
                marginBottom: '4px',
                borderRadius: '4px',
                cursor: 'pointer',
                backgroundColor: item.idx === currentIndex ? '#e6f0ff' : '#f8f9fa',
                border: item.idx === currentIndex ? '1px solid #2f6feb' : '1px solid #ddd',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                <span style={{ fontWeight: 'bold' }}>
                  {item.from === 'user' ? 'Usuário' : 'Bot'}
                </span>
                <span style={{ fontSize: '11px', color: '#666' }}>{new Date(item.at).toLocaleTimeString()}</span>
              </div>
              <div style={{ fontSize: '13px', marginBottom: '2px' }}>{item.text}</div>
              <div style={{ fontSize: '11px', color: '#999' }}>Nó: {item.nodeId || 'desconhecido'}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Painel direito: detalhes do passo atual */}
      <div
        style={{
          flex: 1,
          padding: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div>
          <strong>Passo atual</strong>
          <div style={{ fontSize: '12px', color: '#666' }}>
            Índice: {currentIndex} / {maxIndex}
          </div>
          {currentItem && (
            <>
              <div style={{ marginTop: '4px', fontSize: '12px' }}>
                <div>Origem: {currentItem.from === 'user' ? 'Usuário' : 'Bot'}</div>
                <div>Horário: {new Date(currentItem.at).toLocaleString()}</div>
                <div>Nó: {currentItem.nodeId || 'desconhecido'}</div>
              </div>
            </>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          <div style={{ marginBottom: '4px' }}>
            <strong>Variáveis (snapshot)</strong>
          </div>
          <div
            style={{
              border: '1px solid #ddd',
              borderRadius: '4px',
              padding: '4px',
              overflow: 'auto',
              maxHeight: '100%',
              backgroundColor: '#fafafa',
              fontFamily: 'monospace',
              fontSize: '11px',
            }}
          >
            {Object.keys(currentVariables).length === 0 ? (
              <span>Nenhuma variável registrada neste passo.</span>
            ) : (
              <pre style={{ margin: 0 }}>{JSON.stringify(currentVariables, null, 2)}</pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


