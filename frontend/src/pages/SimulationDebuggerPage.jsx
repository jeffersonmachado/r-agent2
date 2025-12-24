import React, { useState } from 'react';
import { ConversationTimeline } from '../simulator/ConversationTimeline';
import { SimulationPanel } from '../simulator/SimulationPanel';
import { FlowEditor } from '../FlowEditor';
import { useEditor } from '../state/editorStore';
import { getReplay } from '../api/flows';
import { Button } from '../styles/Button';
import { Input } from '../styles/Input';
import logger from '../utils/logger';

/**
 * Página focada em debug/replay de sessão real.
 *
 * Responsabilidades:
 * - Permitir escolher um flowId + sessionId
 * - Carregar replay do backend e exibir timeline + detalhes
 * - Opcionalmente, destacar nós no editor visual
 */
export function SimulationDebuggerPage() {
  const { editorJson, updateEditorJson } = useEditor();
  const [sessionId, setSessionId] = useState('');
  const [replay, setReplay] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleLoadReplay = async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getReplay(sessionId);
      setReplay(result);
    } catch (err) {
      logger.error('Erro ao carregar replay', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSeekNode = () => {
    // Em um futuro, podemos integrar com FlowEditor para focar
    // visualmente no nó correspondente.
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        backgroundColor: '#0a0a0a',
        color: '#ffffff',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: '12px',
          padding: '12px 16px',
          borderBottom: '1px solid #2a2a2a',
          backgroundColor: '#111111',
          alignItems: 'center',
        }}
      >
        <div style={{ fontWeight: 500, color: '#ffffff', fontSize: '14px' }}>Debugger de sessão</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', color: '#a0a0a0' }}>Session ID</span>
          <Input
            type="text"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            placeholder="ex.: sess-123"
            style={{ width: '220px', fontSize: '12px' }}
          />
        </div>
        <Button variant="primary" size="sm" onClick={handleLoadReplay}>
          Carregar replay
        </Button>

        {loading && (
          <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#a0a0a0' }}>Carregando...</span>
        )}
        {error && (
          <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#ef4444' }}>Erro: {error}</span>
        )}
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 2, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #2a2a2a',
              fontSize: '13px',
              backgroundColor: '#111111',
              color: '#a0a0a0',
            }}
          >
            Editor de fluxo (visualização)
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <FlowEditor
              initialFlowJson={editorJson}
              onFlowChanged={updateEditorJson}
              onNodeSelected={() => {}}
              onEvent={() => {}}
            />
          </div>
        </div>

        <div
          style={{
            flex: 3,
            display: 'flex',
            flexDirection: 'column',
            borderLeft: '1px solid #2a2a2a',
            backgroundColor: '#111111',
          }}
        >
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <ConversationTimeline replay={replay} onSeekNode={handleSeekNode} />
          </div>
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <SimulationPanel simulation={replay && replay.simulation} />
          </div>
        </div>
      </div>
    </div>
  );
}


