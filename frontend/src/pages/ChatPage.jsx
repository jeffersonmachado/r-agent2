import React, { useState, useEffect, useRef } from 'react';
import { FlowTestChat } from '../components/FlowTestChat';
import { listFlows, getFlow } from '../api/flows';
import { useRouter } from '../hooks/useRouter';
import { useAuth } from '../context/authContext';
import { useTheme } from '../styles/themeContext';
import { useToast } from '../components/Toast';
import logger from '../utils/logger';

/**
 * Página de Chat Completo
 * 
 * Permite selecionar um fluxo e testá-lo através de uma interface de chat completa.
 */
export function ChatPage() {
  const { navigate } = useRouter();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { theme } = useTheme();
  const { showToast, ToastContainer } = useToast();
  const [flows, setFlows] = useState([]);
  const [selectedFlowId, setSelectedFlowId] = useState(null);
  const [selectedFlow, setSelectedFlow] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectFocused, setSelectFocused] = useState(false);
  const [selectHovered, setSelectHovered] = useState(false);
  const urlFlowIdRef = useRef(null);

  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  // Carrega lista de fluxos
  useEffect(() => {
    if (isAuthenticated && !authLoading) {
      loadFlows();
    }
  }, [isAuthenticated, authLoading]);

  // Carrega fluxo selecionado
  useEffect(() => {
    if (!selectedFlowId) {
      setSelectedFlow(null);
      return;
    }
    if (!authLoading && isAuthenticated) {
      loadFlow(selectedFlowId);
    }
  }, [selectedFlowId, isAuthenticated, authLoading]);

  // Verifica se há flowId na URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const flowIdFromUrl = urlParams.get('flowId');
    if (flowIdFromUrl) {
      urlFlowIdRef.current = flowIdFromUrl;
      setSelectedFlowId((current) => current || flowIdFromUrl);
    }
  }, []);

  const loadFlows = async () => {
    try {
      setLoading(true);
      const flowsList = await listFlows();
      const flowsArray = Array.isArray(flowsList) ? flowsList : [];
      setFlows(flowsArray);

      const preferredFlowId = urlFlowIdRef.current;
      if (preferredFlowId) {
        const matchedFlow = flowsArray.find((flow) => String(flow?.id) === String(preferredFlowId));
        if (matchedFlow) {
          setSelectedFlowId(preferredFlowId);
          setSelectedFlow(matchedFlow);
          return;
        }
      }

      // Se não há fluxo selecionado e há fluxos disponíveis, seleciona o primeiro
      if (!selectedFlowId && flowsArray.length > 0) {
        setSelectedFlowId(flowsArray[0].id);
      }
    } catch (err) {
      logger.error('Erro ao carregar fluxos:', err);
      showToast(err.message || 'Erro ao carregar fluxos', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadFlow = async (flowId) => {
    try {
      setLoading(true);
      const flow = await getFlow(flowId);
      setSelectedFlow(flow);
    } catch (err) {
      logger.error('Erro ao carregar fluxo:', err);
      showToast(err.message || 'Erro ao carregar fluxo', 'error');
      setSelectedFlow((current) => {
        if (current && current.id === flowId) {
          return current;
        }
        return null;
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFlowChange = (e) => {
    const flowId = e.target.value;
    setSelectedFlowId(flowId);
    // Atualiza URL sem recarregar a página
    const url = new URL(window.location);
    url.searchParams.set('flowId', flowId);
    window.history.pushState({}, '', url);
  };

  if (authLoading) {
    return (
      <div style={{ 
        padding: '40px', 
        textAlign: 'center',
        backgroundColor: theme.colors.bg.primary,
        color: theme.colors.text.primary
      }}>
        <p>Carregando...</p>
      </div>
    );
  }

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100vh',
      backgroundColor: theme.colors.bg.primary
    }}>
      {/* Cabeçalho com seletor de fluxo */}
      <div style={{
        padding: '16px',
        borderBottom: `1px solid ${theme.colors.border.default}`,
        backgroundColor: theme.colors.bg.secondary,
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        flexShrink: 0
      }}>
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '14px',
          color: theme.colors.text.secondary
        }}>
          <span>Fluxo:</span>
          <select
            value={selectedFlowId || ''}
            onChange={handleFlowChange}
            disabled={loading || flows.length === 0}
            onFocus={() => setSelectFocused(true)}
            onBlur={() => setSelectFocused(false)}
            onMouseEnter={() => !loading && flows.length > 0 && setSelectHovered(true)}
            onMouseLeave={() => setSelectHovered(false)}
            style={{
              padding: '8px 12px',
              border: `1px solid ${
                selectFocused 
                  ? theme.colors.border.focus 
                  : selectHovered 
                    ? theme.colors.border.hover 
                    : theme.colors.border.default
              }`,
              borderRadius: '6px',
              backgroundColor: loading || flows.length === 0 
                ? theme.colors.bg.tertiary 
                : theme.colors.bg.primary,
              color: loading || flows.length === 0 
                ? theme.colors.text.disabled 
                : theme.colors.text.primary,
              fontSize: '14px',
              minWidth: '200px',
              cursor: loading || flows.length === 0 ? 'not-allowed' : 'pointer',
              outline: selectFocused ? `2px solid ${theme.colors.accent.light}` : 'none',
              outlineOffset: '2px',
              transition: 'border-color 0.2s, background-color 0.2s'
            }}
          >
            {flows.length === 0 ? (
              <option value="">Nenhum fluxo disponível</option>
            ) : (
              <>
                <option value="">Selecione um fluxo...</option>
                {flows.map((flow) => (
                  <option key={flow.id} value={flow.id}>
                    {flow.name || flow.id}
                  </option>
                ))}
              </>
            )}
          </select>
        </label>
        
        <div style={{ flex: 1 }} />
        
        <h1 style={{ 
          margin: 0, 
          fontSize: '20px', 
          fontWeight: '600',
          color: theme.colors.text.primary
        }}>
          💬 Chat de Teste
        </h1>
      </div>

      {/* Área de conteúdo */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {loading && !selectedFlow && (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%',
            color: theme.colors.text.secondary
          }}>
            <p>Carregando...</p>
          </div>
        )}

        {!loading && !selectedFlow && selectedFlowId && (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%',
            color: theme.colors.text.secondary
          }}>
            <p>Fluxo não encontrado</p>
          </div>
        )}

        {!selectedFlowId && (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100%',
            color: theme.colors.text.secondary
          }}>
            <p>Selecione um fluxo para começar o chat</p>
          </div>
        )}

        {selectedFlow && (
          <div style={{ height: '100%', width: '100%' }}>
            <FlowTestChat 
              flow={selectedFlow}
              onSizeChange={() => {}} // Não precisa ajustar tamanho na página completa
            />
          </div>
        )}
      </div>
      <ToastContainer />
    </div>
  );
}

