import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchJson } from '../api/client';
import logger from '../utils/logger';
import { formatJSON, isJSON } from '../utils/devDashboardUtils';

// Função para detectar se está em mobile
const isMobileScreen = () => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768;
};

/**
 * Hook customizado para gerenciar estado e lógica do DevDashboard
 */
export function useDevDashboard() {
  const [activeTab, setActiveTab] = useState('status');
  const [systemStatus, setSystemStatus] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [envInfo, setEnvInfo] = useState(null);
  const [rateLimitStatus, setRateLimitStatus] = useState(null);
  const [wsConnections, setWsConnections] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(5000);
  const [showLogs, setShowLogs] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  
  // Estados para Contratos, Prompts, Nós e Documentos
  const [devFiles, setDevFiles] = useState({ contracts: [], prompts: [], nodes: [], documents: {} });
  // Em mobile, todas as categorias começam recolhidas (false)
  const [expandedCategories, setExpandedCategories] = useState(() => {
    return isMobileScreen() ? {} : {};
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [fileError, setFileError] = useState(null);
  const [jsonData, setJsonData] = useState(null);
  const refreshInFlightRef = useRef(false);

  const isTransientDashboardError = useCallback((err) => {
    if (!err) return false;
    const message = String(err?.message || '').toLowerCase();
    return (
      err?.connectionRefused === true ||
      Number(err?.status) === 0 ||
      err?.name === 'AbortError' ||
      message.includes('request timed out') ||
      message.includes('failed to fetch') ||
      message.includes('network')
    );
  }, []);

  // Função para buscar status do sistema
  const fetchSystemStatus = useCallback(async () => {
    try {
      const data = await fetchJson('/system/status', {
        method: 'GET',
        timeoutMs: 10000,
        suppressErrorLog: true,
      });
      setSystemStatus(data);
      setLastUpdate(new Date());
    } catch (err) {
      if (!isTransientDashboardError(err)) {
        logger.error('[DevDashboard] Erro ao buscar status', err);
      }
      
      // Se for erro de conexão, define um estado de erro
      if (isTransientDashboardError(err)) {
        const errorStatus = {
          timestamp: new Date().toISOString(),
          services: {
            apiServer: {
              name: 'API Server',
              description: 'Servidor principal da API (Node.js)',
              status: 'unhealthy',
              error: 'API não acessível - servidor pode estar offline',
              details: {
                hint: 'Verifique se o servidor está rodando em http://localhost:3000',
              },
            },
            ragService: {
              name: 'RAG Service',
              description: 'Serviço de Retrieval-Augmented Generation (Python/FastAPI)',
              status: 'unhealthy',
              error: 'Não foi possível verificar - API offline',
            },
            redis: {
              name: 'Redis',
              description: 'Cache e rate limiting',
              status: 'unhealthy',
              error: 'Não foi possível verificar - API offline',
            },
            webSocket: {
              name: 'WebSocket',
              description: 'Conexões em tempo real',
              status: 'unhealthy',
              error: 'Não foi possível verificar - API offline',
            },
          },
          overall: {
            status: 'unhealthy',
            healthy: 0,
            total: 4,
            percentage: 0,
          },
        };
        setSystemStatus(errorStatus);
        setLastUpdate(new Date());
      }
    }
  }, [isTransientDashboardError]);

  // Função para buscar métricas
  const fetchMetrics = useCallback(async () => {
    try {
      const data = await fetchJson('/analytics/metrics', {
        method: 'GET',
        timeoutMs: 10000,
        suppressErrorLog: true,
      }).catch(() => null);
      setMetrics(data);
    } catch (err) {
      logger.debug('[DevDashboard] Métricas não disponíveis', err);
      // Se for erro de conexão, limpa as métricas
      if (isTransientDashboardError(err)) {
        setMetrics(null);
      }
    }
  }, [isTransientDashboardError]);

  // Função para buscar informações do ambiente
  const fetchEnvInfo = useCallback(async () => {
    try {
      const data = await fetchJson('/version', {
        method: 'GET',
        timeoutMs: 10000,
        suppressErrorLog: true,
      });
      setEnvInfo(data);
    } catch (err) {
      if (!isTransientDashboardError(err)) {
        logger.error('[DevDashboard] Erro ao buscar info do ambiente', err);
      }
      // Se for erro de conexão, limpa as informações do ambiente
      if (isTransientDashboardError(err)) {
        setEnvInfo(null);
      }
    }
  }, [isTransientDashboardError]);

  // Função para buscar status de rate limit
  const fetchRateLimitStatus = useCallback(async () => {
    try {
      const operations = ['BOOTSTRAP', 'GENERATION_REAL', 'DRY_RUN'];
      const pairs = await Promise.all(operations.map(async (op) => {
        try {
          const result = await fetchJson('/system/check-rate-limit', {
            method: 'POST',
            body: JSON.stringify({
              bootstrap: op === 'BOOTSTRAP',
              executionMode: op === 'DRY_RUN' ? 'dry-run' : 'real',
            }),
            timeoutMs: 10000,
            suppressErrorLog: true,
          });
          return [op, result];
        } catch (err) {
          if (isTransientDashboardError(err)) {
            return [op, { error: 'API não acessível ou indisponível no momento' }];
          }
          return [op, { error: err.message }];
        }
      }));

      setRateLimitStatus(Object.fromEntries(pairs));
    } catch (err) {
      if (!isTransientDashboardError(err)) {
        logger.error('[DevDashboard] Erro ao buscar rate limit', err);
      }
      // Se for erro de conexão geral, limpa o status
      if (isTransientDashboardError(err)) {
        setRateLimitStatus(null);
      }
    }
  }, [isTransientDashboardError]);

  // Função para buscar conexões WebSocket
  const fetchWsConnections = useCallback(async () => {
    try {
      const data = await fetchJson('/system/websocket', {
        method: 'GET',
        timeoutMs: 10000,
        suppressErrorLog: true,
      });
      setWsConnections(data);
    } catch (err) {
      if (!isTransientDashboardError(err)) {
        logger.error('[DevDashboard] Erro ao buscar conexões WebSocket', err);
      }
      // Sempre limpa em caso de erro
      setWsConnections(null);
    }
  }, [isTransientDashboardError]);

  // Função para atualizar tudo
  const refreshAll = useCallback(async () => {
    if (refreshInFlightRef.current) {
      return;
    }
    refreshInFlightRef.current = true;
    setLoading(true);
    try {
      await Promise.all([
        fetchSystemStatus(),
        fetchMetrics(),
        fetchEnvInfo(),
        fetchRateLimitStatus(),
        fetchWsConnections(),
      ]);
    } finally {
      setLoading(false);
      refreshInFlightRef.current = false;
    }
  }, [fetchSystemStatus, fetchMetrics, fetchEnvInfo, fetchRateLimitStatus, fetchWsConnections]);

  // Função para buscar lista de arquivos
  const fetchDevFiles = useCallback(async () => {
    try {
      const data = await fetchJson('/dev/files', {
        method: 'GET',
        timeoutMs: 5000,
      });
      setDevFiles(data);
    } catch (err) {
      logger.error('[DevDashboard] Erro ao buscar arquivos', err);
    }
  }, []);

  // Função para carregar conteúdo de um arquivo
  const loadFileContent = useCallback(async (type, filePath) => {
    setFileLoading(true);
    setFileError(null);
    try {
      const data = await fetchJson(`/dev/files/${type}/${filePath}`, {
        method: 'GET',
        timeoutMs: 10000,
      });
      // Formata JSON automaticamente
      const formattedContent = filePath.endsWith('.json') && isJSON(data.content)
        ? formatJSON(data.content)
        : data.content;
      setFileContent(formattedContent);
      setSelectedFile({ type, path: filePath, ...data });
      
      // Se for JSON, faz parse para o formulário
      if (filePath.endsWith('.json') && isJSON(data.content)) {
        try {
          setJsonData(JSON.parse(data.content));
        } catch {
          setJsonData(null);
        }
      } else {
        setJsonData(null);
      }
    } catch (err) {
      logger.error('[DevDashboard] Erro ao carregar arquivo', err);
      setFileError(err.message || 'Erro ao carregar arquivo');
    } finally {
      setFileLoading(false);
    }
  }, []);

  // Função para atualizar JSON a partir do formulário
  const updateJsonFromForm = useCallback((newData) => {
    try {
      setJsonData(newData);
      const jsonString = JSON.stringify(newData, null, 2);
      setFileContent(jsonString);
    } catch (err) {
      logger.error('[DevDashboard] Erro ao converter formulário para JSON', err);
      setFileError('Erro ao converter dados do formulário');
    }
  }, []);

  // Função para atualizar jsonData completo quando um valor aninhado muda
  const updateJsonDataFromPath = useCallback((path, newData) => {
    updateJsonFromForm(newData);
  }, [updateJsonFromForm]);

  // Função para salvar arquivo
  const saveFile = useCallback(async () => {
    if (!selectedFile) return;
    
    setFileSaving(true);
    setFileError(null);
    try {
      // Se temos jsonData, usa ele, senão usa fileContent
      const contentToSave = jsonData 
        ? JSON.stringify(jsonData, null, 2)
        : fileContent;
      
      await fetchJson(`/dev/files/${selectedFile.type}/${selectedFile.path}`, {
        method: 'PUT',
        body: JSON.stringify({ content: contentToSave }),
        timeoutMs: 10000,
      });
      // Recarrega o arquivo para atualizar metadata
      await loadFileContent(selectedFile.type, selectedFile.path);
      alert('Arquivo salvo com sucesso!');
    } catch (err) {
      logger.error('[DevDashboard] Erro ao salvar arquivo', err);
      setFileError(err.message || 'Erro ao salvar arquivo');
      alert('Erro ao salvar arquivo: ' + (err.message || 'Erro desconhecido'));
    } finally {
      setFileSaving(false);
    }
  }, [selectedFile, jsonData, fileContent, loadFileContent]);

  // Função para limpar cache de rate limit
  const clearRateLimitCache = useCallback(async () => {
    try {
      const result = await fetchJson('/admin/rate-limit/clear-cache', {
        method: 'POST',
        timeoutMs: 5000,
      });
      await fetchRateLimitStatus();
      logger.info('[DevDashboard] Cache de rate limit limpo', result);
      alert('Cache de rate limit limpo com sucesso!');
    } catch (err) {
      logger.error('[DevDashboard] Erro ao limpar cache', err);
      alert('Erro ao limpar cache: ' + (err.message || 'Erro desconhecido'));
    }
  }, [fetchRateLimitStatus]);

  // Busca inicial
  useEffect(() => {
    refreshAll();
    if (activeTab === 'contracts-prompts' || activeTab === 'documents' || activeTab === 'nodes') {
      fetchDevFiles();
    }
  }, [activeTab, refreshAll, fetchDevFiles]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      refreshAll();
    }, refreshInterval);
    
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, refreshAll]);

  return {
    // Estado
    activeTab,
    setActiveTab,
    systemStatus,
    metrics,
    envInfo,
    rateLimitStatus,
    wsConnections,
    loading,
    autoRefresh,
    setAutoRefresh,
    refreshInterval,
    setRefreshInterval,
    showLogs,
    setShowLogs,
    lastUpdate,
    devFiles,
    expandedCategories,
    setExpandedCategories,
    selectedFile,
    setSelectedFile,
    fileContent,
    setFileContent,
    fileLoading,
    fileSaving,
    fileError,
    jsonData,
    // Funções
    refreshAll,
    fetchDevFiles,
    loadFileContent,
    saveFile,
    updateJsonFromForm,
    updateJsonDataFromPath,
    clearRateLimitCache,
  };
}

