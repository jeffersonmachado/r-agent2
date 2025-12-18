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
    <div
      style={{
        flex: 1,
        borderTop: `1px solid ${theme.colors.border.default}`,
        padding: '16px',
        fontSize: '13px',
        backgroundColor: theme.colors.bg.secondary,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div>
        <div style={{ fontWeight: 500, color: theme.colors.text.primary, fontSize: '14px' }}>Timeline da conversa</div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          border: `1px solid ${theme.colors.border.default}`,
          borderRadius: '6px',
          backgroundColor: theme.colors.bg.primary,
        }}
      >
        {timeline.length === 0 && (
          <div style={{ padding: '24px', fontSize: '12px', color: theme.colors.text.tertiary, textAlign: 'center' }}>
            Nenhuma mensagem para exibir.
          </div>
        )}
        {timeline.map((item, idx) => (
          <div
            key={item.idx}
            onClick={() => handleSelectIndex(item.idx)}
            style={{
              padding: '12px',
              borderBottom: idx < timeline.length - 1 ? `1px solid ${theme.colors.border.default}` : 'none',
              cursor: 'pointer',
              backgroundColor: item.idx === currentIndex ? theme.colors.bg.tertiary : 'transparent',
              transition: 'background-color 150ms ease',
            }}
            onMouseEnter={(e) => {
              if (item.idx !== currentIndex) {
                e.currentTarget.style.backgroundColor = theme.colors.bg.hover;
              }
            }}
            onMouseLeave={(e) => {
              if (item.idx !== currentIndex) {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
              }}
            >
              <span
                style={{
                  fontWeight: 500,
                  color: item.from === 'user' ? theme.colors.accent.primary : theme.colors.status.success,
                  fontSize: '12px',
                }}
              >
                {item.from === 'user' ? 'Usuário' : 'Bot'}
              </span>
              <span style={{ fontSize: '11px', color: theme.colors.text.tertiary, fontFamily: 'monospace' }}>
                {item.at ? new Date(item.at).toLocaleTimeString() : ''}
              </span>
            </div>
            <div style={{ fontSize: '13px', marginBottom: '6px', color: theme.colors.text.primary, lineHeight: 1.5 }}>
              {item.text}
            </div>
            <div style={{ fontSize: '11px', color: theme.colors.text.tertiary, fontFamily: 'monospace' }}>
              {item.nodeId || 'desconhecido'}
            </div>
          </div>
        ))}
      </div>

      {currentItem && (
        <div
          style={{
            padding: '12px',
            borderRadius: '6px',
            backgroundColor: theme.colors.bg.tertiary,
            border: `1px solid ${theme.colors.border.default}`,
            fontSize: '12px',
          }}
        >
          <div style={{ fontWeight: 500, marginBottom: '8px', color: theme.colors.text.primary }}>Mensagem selecionada</div>
          <div style={{ marginBottom: '4px', color: theme.colors.text.secondary }}>
            <span style={{ color: theme.colors.text.tertiary }}>Origem: </span>
            {currentItem.from === 'user' ? 'Usuário' : 'Bot'}
          </div>
          <div style={{ marginBottom: '4px', color: theme.colors.text.secondary }}>
            <span style={{ color: theme.colors.text.tertiary }}>Horário: </span>
            {currentItem.at ? new Date(currentItem.at).toLocaleString() : ''}
          </div>
          <div style={{ color: theme.colors.text.secondary, fontFamily: 'monospace' }}>
            <span style={{ color: theme.colors.text.tertiary }}>Nó: </span>
            {currentItem.nodeId || 'desconhecido'}
          </div>
        </div>
      )}
    </div>
  );
}


