import React, { useMemo, useState } from 'react';
import { useTheme } from '../styles/themeContext';

/**
 * Timeline de conversa baseada no replay retornado pelo backend.
 *
 * Props:
 * - replay: qualquer estrutura retornada por buildConversationReplay;
 *   assumimos, para UI, que existe um array `messages` com:
 *   { from, text, at, nodeId? }
 * - onSeekNode?: (nodeId: string|null, index: number) => void
 */
export function ConversationTimeline({ replay, onSeekNode }) {
  const { theme } = useTheme();
  const [currentIndex, setCurrentIndex] = useState(0);

  const timeline = useMemo(() => {
    if (!replay || !Array.isArray(replay.messages)) return [];
    return replay.messages.map((m, idx) => ({
      idx,
      from: m.from,
      text: m.text,
      at: m.at,
      nodeId: m.nodeId || null,
    }));
  }, [replay]);

  const handleSelectIndex = (idx) => {
    setCurrentIndex(idx);
    const item = timeline[idx];
    if (item && typeof onSeekNode === 'function') {
      onSeekNode(item.nodeId, idx);
    }
  };

  const currentItem = timeline[currentIndex] || null;

  return (
    <div className="conversation-timeline">
      <div>
        <div className="conversation-timeline-header">Timeline da conversa</div>
      </div>

      <div className="conversation-timeline-list">
        {timeline.length === 0 && (
          <div className="conversation-timeline-empty">
            Nenhuma mensagem para exibir.
          </div>
        )}
        {timeline.map((item, idx) => (
          <div
            key={item.idx}
            onClick={() => handleSelectIndex(item.idx)}
            className={`conversation-timeline-item ${
              item.idx === currentIndex ? 'conversation-timeline-item--selected' : ''
            }`}
          >
            <div className="conversation-timeline-item-header">
              <span
                className={`conversation-timeline-item-from ${
                  item.from === 'user' 
                    ? 'conversation-timeline-item-from--user' 
                    : 'conversation-timeline-item-from--bot'
                }`}
              >
                {item.from === 'user' ? 'Usuário' : 'Bot'}
              </span>
              <span className="conversation-timeline-item-time">
                {item.at ? new Date(item.at).toLocaleTimeString() : ''}
              </span>
            </div>
            <div className="conversation-timeline-item-text">
              {item.text}
            </div>
            <div className="conversation-timeline-item-node">
              {item.nodeId || 'desconhecido'}
            </div>
          </div>
        ))}
      </div>

      {currentItem && (
        <div className="conversation-timeline-detail">
          <div className="conversation-timeline-detail-title">Mensagem selecionada</div>
          <div className="conversation-timeline-detail-row">
            <span className="conversation-timeline-detail-label">Origem: </span>
            {currentItem.from === 'user' ? 'Usuário' : 'Bot'}
          </div>
          <div className="conversation-timeline-detail-row">
            <span className="conversation-timeline-detail-label">Horário: </span>
            {currentItem.at ? new Date(currentItem.at).toLocaleString() : ''}
          </div>
          <div className="conversation-timeline-detail-row">
            <span className="conversation-timeline-detail-label">Nó: </span>
            <span className="conversation-timeline-detail-value">{currentItem.nodeId || 'desconhecido'}</span>
          </div>
        </div>
      )}
    </div>
  );
}


