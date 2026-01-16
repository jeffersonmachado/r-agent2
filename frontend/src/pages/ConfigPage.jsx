import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getConfig, updateConfig, reloadConfig, restartServer, getProcessManager, validateProviderToken, validateRedisConnection, getTenantAiConfig, saveTenantAiConfig, saveTenantAiCredentials } from '../api/config';
import { listFlows } from '../api/flows';
import { useAuth } from '../context/authContext';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { NavigationLink } from '../components/NavigationLink';
import { useTheme } from '../styles/themeContext';
import { useRouter } from '../hooks/useRouter';
import logger from '../utils/logger';
import { useConfirmDialog } from '../components/ConfirmDialog';

/**
 * Página de gerenciamento de configuração do sistema.
 * Permite visualizar e editar o arquivo config.json.
 */
export function ConfigPage() {
  const { isAuthenticated, loading: authLoading, agent } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const { themeName } = useTheme();
  const { confirm, ConfirmDialog } = useConfirmDialog();

  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  if (authLoading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <p>Carregando...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Será redirecionado pelo useEffect
  }
  const [config, setConfig] = useState(null);
  const [editedConfig, setEditedConfig] = useState(null);
  const [jsonText, setJsonText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [jsonError, setJsonError] = useState(null);
  const [viewMode, setViewMode] = useState('form'); // 'form' ou 'json'
  
  // Lê o parâmetro 'tab' da URL para abrir a aba correta
  const getInitialTab = () => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get('tab');
      if (tabParam && ['api', 'frontend', 'rag', 'whatsapp', 'flows', 'ai', 'features', 'scripts', 'logging', 'rateLimit', 'general'].includes(tabParam)) {
        return tabParam;
      }
    }
    return 'api';
  };
  
  // Lê o parâmetro 'tenant' da URL para configurar provider de tenant específico
  // Atualiza quando a URL muda
  const getTargetTenantId = useCallback(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get('tenant') || null;
    }
    return null;
  }, []);
  
  const [targetTenantId, setTargetTenantId] = useState(() => getTargetTenantId());
  
  // Atualiza targetTenantId quando a URL muda
  useEffect(() => {
    const newTargetTenantId = getTargetTenantId();
    if (newTargetTenantId !== targetTenantId) {
      setTargetTenantId(newTargetTenantId);
    }
  }, [getTargetTenantId, targetTenantId]);
  
  const [activeTab, setActiveTab] = useState(getInitialTab); // 'api', 'frontend', 'rag', 'whatsapp', 'flows', 'ai', 'features', 'scripts', 'logging', 'rateLimit', 'general'
  const [flows, setFlows] = useState([]);
  const [loadingFlows, setLoadingFlows] = useState(false);
  const [validatingTokens, setValidatingTokens] = useState({}); // { 'ai.openai.apiKey': true }
  const [tokenValidationStatus, setTokenValidationStatus] = useState({}); // { 'ai.openai.apiKey': { valid: true, error: null } }
  const [validatingRedis, setValidatingRedis] = useState(false);
  const [redisValidationStatus, setRedisValidationStatus] = useState(null); // { valid: true, error: null }
  
  // Estado específico para configuração de IA do tenant
  const [tenantAiConfig, setTenantAiConfig] = useState(null); // { tenantId, primary, secondary, configured, model, temperature, max_tokens }
  const [loadingTenantAiConfig, setLoadingTenantAiConfig] = useState(false);
  const [savingTenantAiConfig, setSavingTenantAiConfig] = useState(false);
  const [savingTenantAiCredentials, setSavingTenantAiCredentials] = useState(false);
  const [apiKey, setApiKey] = useState(''); // Campo de apiKey (sempre vazio ao carregar, nunca exibido)
  const [apiKeyProvider, setApiKeyProvider] = useState(''); // Provider para o qual a apiKey será salva
  const [validatingApiKey, setValidatingApiKey] = useState(false);
  const [apiKeyValidationStatus, setApiKeyValidationStatus] = useState(null); // { valid: boolean, error: string | null }
  const [credentialsValidatedAndSaved, setCredentialsValidatedAndSaved] = useState(false); // Rastreia se credenciais foram validadas e salvas

  const configLoadedRef = useRef(false);
  const configLoadedTenantRef = useRef(null); // Rastreia qual tenant foi carregado
  const showToastRef = useRef(showToast);

  // Atualiza ref quando showToast muda
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  // Carrega configuração
  const loadConfig = useCallback(async () => {
    if (configLoadedRef.current) return; // Já carregado
    
    configLoadedRef.current = true;
    setLoading(true);
    try {
      const data = await getConfig();
      
      // Valida que data é um objeto válido
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        // Se for string (HTML de erro), tenta parsear como JSON
        if (typeof data === 'string') {
          try {
            const parsed = JSON.parse(data);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              setConfig(parsed);
              setEditedConfig(JSON.parse(JSON.stringify(parsed))); // Deep copy
              setJsonText(JSON.stringify(parsed, null, 2));
              setHasChanges(false);
              setJsonError(null);
              return;
            }
          } catch {
            // Não é JSON válido, provavelmente HTML
          }
        }
        
        // Se chegou aqui, os dados não são válidos
        logger.error('Configuração inválida recebida', { data: typeof data === 'string' ? data.substring(0, 200) : data });
        showToastRef.current('Erro: configuração inválida recebida do servidor', 'error');
        configLoadedRef.current = false;
        return;
      }
      
      // IMPORTANTE: Preserva TODA a configuração original (incluindo todos os tenants)
      // Isso é necessário para que ao salvar, possamos fazer merge correto
      setConfig(data);
      
      // Para exibição na aba IA, filtra para mostrar apenas o tenant atual
      // mas mantém todos os dados no editedConfig para preservar ao salvar
      const filteredData = JSON.parse(JSON.stringify(data)); // Deep copy
      
      // Determina o tenant atual - NUNCA deve ser null quando há um tenant válido
      // Prioridade: targetTenantId (da URL) > agent.tenantId (do agente logado)
      // IMPORTANTE: Se agent.tenantId for 'system', ainda usa ele (não exclui mais)
      const currentTenantId = targetTenantId || agent?.tenantId || null;
      
      // Se tiver um tenant específico, filtra ai.tenants para mostrar apenas o tenant atual
      // Se currentTenantId for null, não filtra (mostra todos os tenants)
      if (currentTenantId && filteredData.ai?.tenants) {
        // Mantém apenas o tenant atual visível, mas preserva os outros no config original
        const allTenants = { ...filteredData.ai.tenants };
        filteredData.ai.tenants = {};
        if (allTenants[currentTenantId]) {
          filteredData.ai.tenants[currentTenantId] = allTenants[currentTenantId];
        } else {
          // Se o tenant não tem configuração ainda, cria um objeto vazio para permitir edição
          filteredData.ai.tenants[currentTenantId] = {};
        }
        logger.info('Filtrando configuração de IA para mostrar apenas tenant atual', { tenantId: currentTenantId });
      }
      
      setEditedConfig(filteredData);
      setJsonText(JSON.stringify(filteredData, null, 2));
      setHasChanges(false);
      setJsonError(null);
      
      // Salva o tenant atual no ref
      configLoadedTenantRef.current = currentTenantId;
    } catch (error) {
      logger.error('Erro ao carregar configuração', error);
      showToastRef.current('Erro ao carregar configuração', 'error');
      configLoadedRef.current = false; // Permite tentar novamente
    } finally {
      setLoading(false);
    }
  }, [agent?.tenantId, targetTenantId]);

  // Carrega na montagem (aguarda agent estar disponível para filtrar corretamente)
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      // Determina o tenant atual - mesma lógica do loadConfig
      const currentTenantId = targetTenantId || agent?.tenantId || null;
      const previousTenantId = configLoadedTenantRef.current;
      
      // Se ainda não carregou, ou se o tenant mudou, recarrega
      if (!configLoadedRef.current || currentTenantId !== previousTenantId) {
        configLoadedRef.current = false; // Permite recarregar
        configLoadedTenantRef.current = currentTenantId;
        loadConfig();
      }
    }
  }, [loadConfig, authLoading, isAuthenticated, agent?.tenantId, targetTenantId]);

  const flowsLoadedRef = useRef(false);

  // Carrega lista de fluxos quando necessário
  const loadFlowsList = useCallback(async () => {
    if (flowsLoadedRef.current) return; // Já carregado
    flowsLoadedRef.current = true;
    setLoadingFlows(true);
    try {
      const flowsList = await listFlows();
      setFlows(Array.isArray(flowsList) ? flowsList : []);
    } catch (error) {
      logger.error('Erro ao carregar fluxos', error);
      setFlows([]);
      flowsLoadedRef.current = false; // Permite tentar novamente em caso de erro
    } finally {
      setLoadingFlows(false);
    }
  }, []);

  // Carrega fluxos quando a aba de flows ou ai está ativa
  useEffect(() => {
    if ((activeTab === 'flows' || activeTab === 'ai') && !flowsLoadedRef.current) {
      loadFlowsList();
    }
  }, [activeTab, loadFlowsList]);

  // Carrega configuração de IA do tenant atual quando a aba IA está ativa
  const loadTenantAiConfig = useCallback(async () => {
    // Determina qual tenant usar: targetTenantId (da URL) > agent.tenantId
    const tenantToUse = targetTenantId || agent?.tenantId;
    if (!tenantToUse) {
      setTenantAiConfig({
        tenantId: null,
        primary: null,
        secondary: null,
        configured: false,
        model: null,
        temperature: null,
        max_tokens: null
      });
      setApiKey(''); // Sempre limpa apiKey
      setApiKeyProvider('');
      return;
    }

    setLoadingTenantAiConfig(true);
    try {
      // Usa targetTenantId se disponível (super-admin), senão usa current
      const aiConfig = await getTenantAiConfig(targetTenantId || undefined);
      // getTenantAiConfig já retorna primary e secondary
      setTenantAiConfig({
        tenantId: tenantToUse,
        primary: aiConfig?.primary || null,
        secondary: aiConfig?.secondary || null,
        configured: aiConfig?.configured || false,
        model: aiConfig?.model || null,
        temperature: aiConfig?.temperature || null,
        max_tokens: aiConfig?.max_tokens || null
      });
      setApiKey(''); // Sempre limpa apiKey - nunca exibimos a chave atual
      setApiKeyProvider('');
      setCredentialsValidatedAndSaved(false); // Reset ao recarregar
    } catch (error) {
      logger.error('Erro ao carregar configuração de IA do tenant', error);
      const tenantToUse = targetTenantId || agent?.tenantId;
      // Se for 404, trata como não configurado
      if (error.status === 404) {
        setTenantAiConfig({
          tenantId: tenantToUse || null,
          primary: null,
          secondary: null,
          configured: false,
          model: null,
          temperature: null,
          max_tokens: null
        });
      } else {
        showToastRef.current('Erro ao carregar configuração de IA do tenant', 'error');
        const tenantToUse = targetTenantId || agent?.tenantId;
        setTenantAiConfig({
          tenantId: tenantToUse || null,
          primary: null,
          secondary: null,
          configured: false,
          model: null,
          temperature: null,
          max_tokens: null
        });
      }
      setApiKey(''); // Sempre limpa apiKey
      setApiKeyProvider('');
      setCredentialsValidatedAndSaved(false); // Reset ao recarregar
    } finally {
      setLoadingTenantAiConfig(false);
    }
  }, [agent?.tenantId, targetTenantId]);

  // Carrega configuração de IA quando a aba IA está ativa ou quando o tenant muda
  useEffect(() => {
    if (activeTab === 'ai') {
      loadTenantAiConfig();
    }
  }, [activeTab, loadTenantAiConfig]);

  // Valida JSON quando o texto muda (com debounce)
  const jsonValidationTimeoutRef = useRef(null);
  useEffect(() => {
    if (viewMode !== 'json' || !jsonText) {
      return;
    }

    // Limpa timeout anterior
    if (jsonValidationTimeoutRef.current) {
      clearTimeout(jsonValidationTimeoutRef.current);
    }

    // Debounce de 300ms para evitar validação excessiva
    jsonValidationTimeoutRef.current = setTimeout(() => {
      try {
        const parsed = JSON.parse(jsonText);
        setJsonError(null);
        setEditedConfig(parsed);
      } catch (err) {
        setJsonError(err.message);
      }
    }, 300);

    return () => {
      if (jsonValidationTimeoutRef.current) {
        clearTimeout(jsonValidationTimeoutRef.current);
      }
    };
  }, [jsonText, viewMode]);

  // Detecta mudanças usando useMemo com comparação direta
  const hasChangesMemo = useMemo(() => {
    if (!editedConfig || !config) return false;
    
    if (viewMode === 'json' && jsonText) {
      try {
        const parsed = JSON.parse(jsonText);
        const parsedString = JSON.stringify(parsed);
        const configString = JSON.stringify(config);
        return parsedString !== configString;
      } catch {
        return false;
      }
    }
    
    if (viewMode === 'form') {
      const editedString = JSON.stringify(editedConfig);
      const configString = JSON.stringify(config);
      return editedString !== configString;
    }
    
    return false;
  }, [editedConfig, config, viewMode, jsonText]);

  useEffect(() => {
    setHasChanges(hasChangesMemo);
  }, [hasChangesMemo]);

  // Salva configuração
  const handleSave = async () => {
    if (jsonError) {
      showToast('Corrija os erros no JSON antes de salvar', 'error');
      return;
    }

    setSaving(true);
    try {
      // Se estiver na aba IA, salva a configuração de IA do tenant
      if (activeTab === 'ai') {
        if (!tenantAiConfig?.primary) {
          showToast('Selecione um provider primário antes de salvar', 'warning');
          setSaving(false);
          return;
        }
        
        setSavingTenantAiConfig(true);
        try {
          // Usa targetTenantId se disponível (super-admin), senão undefined (usa current)
          await saveTenantAiConfig({
            primary: tenantAiConfig.primary,
            secondary: tenantAiConfig.secondary || undefined,
            model: tenantAiConfig.model || undefined,
            temperature: tenantAiConfig.temperature !== null && tenantAiConfig.temperature !== undefined ? tenantAiConfig.temperature : undefined,
            max_tokens: tenantAiConfig.max_tokens || undefined
          }, targetTenantId || undefined);
          showToast('Configuração de IA salva com sucesso!', 'success');
          // Reset estado de credenciais quando configuração muda
          setCredentialsValidatedAndSaved(false);
          setApiKeyValidationStatus(null);
          await loadTenantAiConfig(); // Recarrega
        } catch (error) {
          logger.error('Erro ao salvar configuração de IA', error);
          const errorMessage = error.body?.message || error.message || 'Erro ao salvar configuração';
          showToast(`Erro: ${errorMessage}`, 'error');
        } finally {
          setSavingTenantAiConfig(false);
          setSaving(false);
        }
        return;
      }
      
      // Para outras abas, verifica se há configuração para salvar
      if (!editedConfig) {
        showToast('Nenhuma configuração para salvar', 'warning');
        setSaving(false);
        return;
      }
      
      await updateConfig(editedConfig);
      showToast('Configuração salva com sucesso!', 'success');
      configLoadedRef.current = false; // Permite recarregar
      await loadConfig(); // Recarrega para garantir sincronização
    } catch (error) {
      logger.error('Erro ao salvar configuração', error);
      showToast('Erro ao salvar configuração', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Recarrega do servidor
  const handleReload = async () => {
    configLoadedRef.current = false; // Permite recarregar
    setLoading(true);
    try {
      await reloadConfig();
      await loadConfig();
      showToast('Configuração recarregada do servidor', 'success');
    } catch (error) {
      logger.error('Erro ao recarregar configuração', error);
      showToast('Erro ao recarregar configuração', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Reseta para valores originais
  const handleReset = async () => {
    const confirmed = await confirm({
      title: 'Descartar Alterações',
      message: 'Deseja descartar todas as alterações e voltar aos valores originais?',
      confirmLabel: 'Descartar',
      cancelLabel: 'Cancelar',
      variant: 'warning',
    });

    if (!confirmed) {
      return;
    }

    setEditedConfig(JSON.parse(JSON.stringify(config))); // Deep copy
    setJsonText(JSON.stringify(config, null, 2));
    setHasChanges(false);
    setJsonError(null);
    showToast('Alterações descartadas', 'info');
  };

  // Reinicia o servidor
  const handleRestart = async () => {
    // Verifica qual gerenciador está sendo usado antes de confirmar
    let processManagerInfo = null;
    try {
      processManagerInfo = await getProcessManager();
    } catch (error) {
      logger.warn('Não foi possível verificar gerenciador de processo', error);
    }

    const hasProcessManager = processManagerInfo?.hasProcessManager ?? false;
    const processManagerName = processManagerInfo?.processManager ?? 'desconhecido';

    const confirmMessage = hasProcessManager
      ? `Isso reiniciará o servidor.\n\n✅ Gerenciador detectado: ${processManagerName}\nO servidor será reiniciado automaticamente.\n\nDeseja continuar?`
      : `Isso reiniciará o servidor.\n\n⚠️ Nenhum gerenciador de processo detectado.\nO servidor não reiniciará automaticamente.\nVocê precisará iniciá-lo manualmente.\n\nDeseja continuar?`;

    const confirmed = await confirm({
      title: '⚠️ Reiniciar Servidor',
      message: confirmMessage,
      confirmLabel: 'Reiniciar',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });

    if (!confirmed) {
      return;
    }

    try {
      const result = await restartServer();
      const hasManager = result?.hasProcessManager ?? hasProcessManager;
      const managerName = result?.processManager ?? processManagerName;
      
      if (hasManager) {
        showToast(
          `Servidor sendo reiniciado automaticamente (${managerName})... A página será recarregada em alguns segundos.`,
          'success'
        );
      } else {
        showToast(
          'Servidor encerrado. Reinicie manualmente usando "npm start" ou "node api/server.js".',
          'warning'
        );
        // Não recarrega a página se não houver gerenciador
        return;
      }
      
      // Aguarda um pouco e tenta recarregar a página apenas se houver gerenciador
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    } catch (error) {
      // Erro é esperado pois o servidor será encerrado
      logger.info('Servidor sendo reiniciado', error);
      
      // Tenta usar informações do erro ou fallback
      const hasManager = hasProcessManager;
      if (hasManager) {
        showToast('Servidor sendo reiniciado... A página será recarregada em alguns segundos.', 'info');
        setTimeout(() => {
          window.location.reload();
        }, 3000);
      } else {
        showToast(
          'Servidor encerrado. Reinicie manualmente usando "npm start" ou "node api/server.js".',
          'warning'
        );
      }
    }
  };

  // Valida token de um provedor
  const validateToken = useCallback(async (path, apiKey) => {
    if (!apiKey || apiKey.trim() === '') {
      setTokenValidationStatus(prev => ({ ...prev, [path]: null }));
      return;
    }

    // Determina qual provider baseado no path
    let provider = null;
    if (path === 'ai.openai.apiKey') {
      provider = 'openai';
    } else if (path === 'ai.anthropic.apiKey') {
      provider = 'anthropic';
    }

    if (!provider) {
      return; // Não é um token de provedor que precisa validação
    }

    setValidatingTokens(prev => ({ ...prev, [path]: true }));
    setTokenValidationStatus(prev => ({ ...prev, [path]: null }));

    try {
      const result = await validateProviderToken(provider, apiKey);
      setTokenValidationStatus(prev => ({
        ...prev,
        [path]: {
          valid: result.valid,
          error: result.error || null,
        },
      }));

      if (result.valid) {
        showToast(`Token ${provider === 'openai' ? 'OpenAI' : 'Anthropic'} válido!`, 'success');
      } else {
        showToast(`Token ${provider === 'openai' ? 'OpenAI' : 'Anthropic'} inválido: ${result.error || 'Erro desconhecido'}`, 'error');
      }
    } catch (error) {
      logger.error('Erro ao validar token', error);
      setTokenValidationStatus(prev => ({
        ...prev,
        [path]: {
          valid: false,
          error: error.message || 'Erro ao validar token',
        },
      }));
      showToast(`Erro ao validar token: ${error.message || 'Erro desconhecido'}`, 'error');
    } finally {
      setValidatingTokens(prev => ({ ...prev, [path]: false }));
    }
  }, [showToast]);

  // Valida conexão do Redis
  const validateRedis = useCallback(async (redisUrl) => {
    if (!redisUrl || redisUrl.trim() === '') {
      setRedisValidationStatus(null);
      return;
    }

    setValidatingRedis(true);
    setRedisValidationStatus(null);

    try {
      const result = await validateRedisConnection(redisUrl);
      setRedisValidationStatus({
        valid: result.valid,
        error: result.error || null,
      });

      if (result.valid) {
        showToast('Conexão com Redis válida!', 'success');
      } else {
        showToast(`Conexão com Redis inválida: ${result.error || 'Erro desconhecido'}`, 'error');
      }
    } catch (error) {
      logger.error('Erro ao validar conexão do Redis', error);
      setRedisValidationStatus({
        valid: false,
        error: error.message || 'Erro ao validar conexão do Redis',
      });
      showToast(`Erro ao validar conexão do Redis: ${error.message || 'Erro desconhecido'}`, 'error');
    } finally {
      setValidatingRedis(false);
    }
  }, [showToast]);

  // Atualiza valor no modo form
  const updateValue = useCallback((path, value) => {
    if (!editedConfig) return;

    // Valida que editedConfig é um objeto válido
    if (typeof editedConfig !== 'object' || Array.isArray(editedConfig)) {
      logger.error('editedConfig não é um objeto válido', { 
        type: typeof editedConfig, 
        isArray: Array.isArray(editedConfig),
        sample: typeof editedConfig === 'string' ? editedConfig.substring(0, 200) : editedConfig
      });
      showToast('Erro: configuração inválida. Recarregue a página.', 'error');
      return;
    }

    const keys = path.split('.');
    const newConfig = JSON.parse(JSON.stringify(editedConfig)); // Deep copy

    let current = newConfig;
    for (let i = 0; i < keys.length - 1; i++) {
      // Garante que current é um objeto antes de criar propriedades
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        logger.error('Tentativa de criar propriedade em valor não-objeto', { 
          path, 
          key: keys[i], 
          currentType: typeof current,
          isArray: Array.isArray(current)
        });
        showToast('Erro: estrutura de configuração inválida. Recarregue a página.', 'error');
        return;
      }
      
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }

    const lastKey = keys[keys.length - 1];
    if (value === '' || value === null) {
      delete current[lastKey];
      // Se estiver deletando uma propriedade dentro de ai.tenants[tenantId] e o objeto ficar vazio, remove o objeto também
      if (keys.length >= 3 && keys[0] === 'ai' && keys[1] === 'tenants' && Object.keys(current).length === 0) {
        const tenantId = keys[2];
        if (newConfig.ai?.tenants?.[tenantId] && Object.keys(newConfig.ai.tenants[tenantId]).length === 0) {
          delete newConfig.ai.tenants[tenantId];
          // Se o objeto tenants ficar vazio, remove também
          if (newConfig.ai.tenants && Object.keys(newConfig.ai.tenants).length === 0) {
            delete newConfig.ai.tenants;
          }
        }
      }
    } else {
      // Tenta converter para número se for um número válido
      if (typeof value === 'string' && /^-?\d+$/.test(value)) {
        current[lastKey] = parseInt(value, 10);
      } else if (typeof value === 'string' && /^-?\d*\.\d+$/.test(value)) {
        current[lastKey] = parseFloat(value);
      } else if (value === 'true' || value === 'false') {
        current[lastKey] = value === 'true';
      } else {
        current[lastKey] = value;
      }
    }

    setEditedConfig(newConfig);
    // Atualiza jsonText apenas se estiver no modo JSON para evitar serialização desnecessária
    if (viewMode === 'json') {
      setJsonText(JSON.stringify(newConfig, null, 2));
    }

    // Limpa status de validação quando o valor muda
    if (path === 'ai.openai.apiKey' || path === 'ai.anthropic.apiKey') {
      setTokenValidationStatus(prev => ({ ...prev, [path]: null }));
    }
    if (path === 'rateLimit.redis.url') {
      setRedisValidationStatus(null);
    }
  }, [editedConfig, viewMode, showToast]);

  // Renderiza campo de input para um valor
  const renderField = (label, path, value, type = 'text', options = null) => {
    const displayValue = value === null || value === undefined ? '' : String(value);
    const isTokenField = path === 'ai.openai.apiKey' || path === 'ai.anthropic.apiKey';
    const isRedisField = path === 'rateLimit.redis.url';
    const isValidating = validatingTokens[path] || false;
    const validationStatus = tokenValidationStatus[path];
    const redisValidating = isRedisField && validatingRedis;
    const redisStatus = isRedisField ? redisValidationStatus : null;

    // Se tem opções, renderiza como select
    if (options && Array.isArray(options)) {
      return (
        <div key={path} className="mb-4">
          <label className="block mb-2 text-sm font-medium text-text-primary">
            {label}
          </label>
          <div className="relative">
            <select
              value={displayValue}
              onChange={(e) => updateValue(path, e.target.value)}
              className="w-full px-3 py-2 pr-10 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
            >
              <option value="">Selecione...</option>
              {options.map((option) => {
                const optionValue = typeof option === 'object' ? option.value : option;
                const optionLabel = typeof option === 'object' ? option.label : option;
                return (
                  <option key={optionValue} value={optionValue}>
                    {optionLabel}
                  </option>
                );
              })}
            </select>
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={path} className="mb-4">
        <label className="block mb-2 text-sm font-medium text-text-primary">
          {label}
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            {type === 'textarea' ? (
              <textarea
                value={displayValue}
                onChange={(e) => updateValue(path, e.target.value)}
                className={`w-full px-3 py-2 bg-bg-secondary border rounded-lg text-text-primary font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all min-h-[80px] resize-y ${
                  validationStatus
                    ? validationStatus.valid
                      ? 'border-status-success'
                      : 'border-status-error'
                    : 'border-border-default'
                }`}
                placeholder={label}
              />
            ) : (
              <input
                type={type}
                value={displayValue}
                onChange={(e) => updateValue(path, e.target.value)}
                className={`w-full px-3 py-2 pr-10 bg-bg-secondary border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all ${
                  (validationStatus || redisStatus)
                    ? (validationStatus?.valid || redisStatus?.valid)
                      ? 'border-status-success'
                      : 'border-status-error'
                    : 'border-border-default'
                }`}
                placeholder={label}
              />
            )}
            {(isTokenField && validationStatus) || (isRedisField && redisStatus) ? (
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                {(validationStatus?.valid || redisStatus?.valid) ? (
                  <svg className="w-5 h-5 text-status-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-status-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
              </div>
            ) : null}
          </div>
          {(isTokenField || isRedisField) && (
            <button
              type="button"
              onClick={() => isTokenField ? validateToken(path, displayValue) : validateRedis(displayValue)}
              disabled={!displayValue || isValidating || redisValidating}
              className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium whitespace-nowrap"
            >
              {(isValidating || redisValidating) ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Testando...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{isTokenField ? 'Testar Token' : 'Testar Conexão'}</span>
                </>
              )}
            </button>
          )}
        </div>
        {isTokenField && validationStatus && !validationStatus.valid && validationStatus.error && (
          <p className="mt-1 text-xs text-status-error">{validationStatus.error}</p>
        )}
        {isTokenField && validationStatus && validationStatus.valid && (
          <p className="mt-1 text-xs text-status-success">✓ Token válido e funcionando corretamente</p>
        )}
        {isRedisField && redisStatus && !redisStatus.valid && redisStatus.error && (
          <p className="mt-1 text-xs text-status-error">{redisStatus.error}</p>
        )}
        {isRedisField && redisStatus && redisStatus.valid && (
          <p className="mt-1 text-xs text-status-success">✓ Conexão com Redis válida e funcionando corretamente</p>
        )}
      </div>
    );
  };

  const tabs = [
    { id: 'api', label: 'API', icon: '⚙️' },
    { id: 'frontend', label: 'Frontend', icon: '🖥️' },
    { id: 'rag', label: 'RAG', icon: '🔍' },
    { id: 'whatsapp', label: 'WhatsApp', icon: '💬' },
    { id: 'flows', label: 'Fluxos', icon: '🔄' },
    { id: 'ai', label: 'IA', icon: '🤖' },
    { id: 'features', label: 'Features', icon: '✨' },
    { id: 'scripts', label: 'Scripts', icon: '📜' },
    { id: 'logging', label: 'Logging', icon: '📝' },
    { id: 'rateLimit', label: 'Rate Limiting', icon: '🚦' },
    { id: 'general', label: 'Geral', icon: '🌐' },
  ];

  if (loading && !config) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
          <p className="text-text-secondary">Carregando configuração...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        .config-page-scroll::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .config-page-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .config-page-scroll::-webkit-scrollbar-thumb {
          background-color: rgba(156, 163, 175, 0.3);
          border-radius: 4px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        .config-page-scroll::-webkit-scrollbar-thumb:hover {
          background-color: rgba(156, 163, 175, 0.5);
        }
        .config-page-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(156, 163, 175, 0.3) transparent;
        }
      `}</style>
      <div className="min-h-screen w-full bg-bg-primary p-6 overflow-y-auto config-page-scroll">
        <div className="w-full">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
            <div>
              <h1 className="text-3xl font-bold text-text-primary mb-2">⚙️ Configuração do Sistema</h1>
              <p className="text-text-secondary text-sm">Gerencie todas as configurações do sistema em um único lugar</p>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 p-4 bg-bg-elevated rounded-xl border border-border-default">
            <Button 
              onClick={handleReload} 
              disabled={loading || saving}
              className="flex items-center gap-2"
            >
              <span>🔄</span>
              <span>Recarregar</span>
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={(saving || savingTenantAiConfig) || (activeTab !== 'ai' && !hasChanges) || jsonError || (activeTab === 'ai' && !tenantAiConfig?.primary)} 
              variant="primary"
              className="flex items-center gap-2"
            >
              {(saving || savingTenantAiConfig) ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Salvando...</span>
                </>
              ) : (
                <>
                  <span>💾</span>
                  <span>Salvar</span>
                </>
              )}
            </Button>
            {hasChanges && (
              <Button onClick={handleReset} variant="secondary" className="flex items-center gap-2">
                <span>↺</span>
                <span>Descartar</span>
              </Button>
            )}
            <Button 
              onClick={handleRestart} 
              disabled={loading || saving}
              variant="secondary"
              className="flex items-center gap-2 border-status-warning/50 hover:bg-status-warning/10"
            >
              <span>🔄</span>
              <span>Reiniciar Servidor</span>
            </Button>
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => setViewMode('form')}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  viewMode === 'form'
                    ? 'bg-accent-primary text-white shadow-lg shadow-accent-primary/30'
                    : 'bg-bg-secondary text-text-secondary hover:bg-bg-hover border border-border-default'
                }`}
              >
                📋 Formulário
              </button>
              <button
                onClick={() => setViewMode('json')}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  viewMode === 'json'
                    ? 'bg-accent-primary text-white shadow-lg shadow-accent-primary/30'
                    : 'bg-bg-secondary text-text-secondary hover:bg-bg-hover border border-border-default'
                }`}
              >
                {'{ }'} JSON
              </button>
            </div>
          </div>
        </div>

        {/* Warning Banner */}
        {hasChanges && (
          <div className="mb-6 p-4 bg-status-warning/10 border border-status-warning/30 rounded-xl flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="text-text-primary font-medium">Você tem alterações não salvas</p>
              <p className="text-text-secondary text-sm">Lembre-se de salvar suas alterações antes de sair</p>
            </div>
          </div>
        )}

        {/* Abas de navegação (apenas no modo formulário) */}
        {viewMode === 'form' && (
          <div className="mb-6 border-b border-border-default overflow-x-auto">
            <div className="flex gap-0 min-w-max">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-6 py-4 font-medium text-sm transition-all whitespace-nowrap relative ${
                      isActive
                        ? 'text-accent-primary border-b-3 border-accent-primary'
                        : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                    }`}
                    style={{ borderBottomWidth: isActive ? '3px' : '0' }}
                  >
                    <span className="mr-2">{tab.icon}</span>
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Conteúdo */}
        {viewMode === 'form' && editedConfig ? (
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            {/* Aba: API */}
            {activeTab === 'api' && (
              <div className="space-y-6">
                <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
                  <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
                    <span>⚙️</span>
                    <span>API</span>
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {renderField('Porta', 'api.port', editedConfig.api?.port, 'number')}
                  </div>
                  <div className="mt-6 pt-6 border-t border-border-default">
                    <h4 className="text-lg font-medium text-text-primary mb-4">Limpeza de Tickets</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {renderField('Intervalo (horas)', 'api.ticketCleanup.intervalHours', editedConfig.api?.ticketCleanup?.intervalHours, 'number')}
                      {renderField('Idade Máxima (dias)', 'api.ticketCleanup.maxAgeDays', editedConfig.api?.ticketCleanup?.maxAgeDays, 'number')}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Aba: Frontend */}
            {activeTab === 'frontend' && (
              <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
                <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
                  <span>🖥️</span>
                  <span>Frontend</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {renderField('Porta', 'frontend.port', editedConfig.frontend?.port, 'number')}
                  {renderField('URL Base da API', 'frontend.apiBaseUrl', editedConfig.frontend?.apiBaseUrl)}
                </div>
              </div>
            )}

            {/* Aba: RAG */}
            {activeTab === 'rag' && (
              <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
                <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
                  <span>🔍</span>
                  <span>RAG Service</span>
                </h3>
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {renderField('URL do Serviço', 'rag.serviceUrl', editedConfig.rag?.serviceUrl)}
                    {renderField('Timeout (ms)', 'rag.timeout', editedConfig.rag?.timeout, 'number')}
                  </div>
                  
                  <div className="mt-6 pt-6 border-t border-border-default">
                    <h4 className="text-lg font-medium text-text-primary mb-4">Configuração por Tenant</h4>
                    {editedConfig.rag?.tenants && Object.keys(editedConfig.rag.tenants).length > 0 ? (
                      <div className="space-y-4">
                        {Object.entries(editedConfig.rag.tenants).map(([tenantId, tenantConfig]) => (
                          <div key={tenantId} className="p-4 bg-bg-primary rounded-lg border border-border-default">
                            <h5 className="text-md font-semibold text-text-primary mb-3">{tenantId}</h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {renderField(
                                'URL do Serviço',
                                `rag.tenants.${tenantId}.serviceUrl`,
                                tenantConfig?.serviceUrl
                              )}
                              {renderField(
                                'Timeout (ms)',
                                `rag.tenants.${tenantId}.timeout`,
                                tenantConfig?.timeout,
                                'number'
                              )}
                            </div>
                            {tenantConfig?.domains && (
                              <div className="mt-4 pt-4 border-t border-border-default">
                                <h6 className="text-sm font-medium text-text-secondary mb-2">Domínios</h6>
                                <div className="space-y-2">
                                  {Object.entries(tenantConfig.domains).map(([domainName, domainConfig]) => (
                                    <div key={domainName} className="p-3 bg-bg-secondary rounded border border-border-default">
                                      <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-medium text-text-primary">{domainName}</span>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={domainConfig?.enabled || false}
                                            onChange={(e) => updateValue(`rag.tenants.${tenantId}.domains.${domainName}.enabled`, e.target.checked)}
                                            className="w-4 h-4 rounded border-border-default text-accent-primary focus:ring-2 focus:ring-accent-primary cursor-pointer"
                                          />
                                          <span className="text-xs text-text-secondary">Habilitado</span>
                                        </label>
                                      </div>
                                      {domainConfig?.defaultCategory && (
                                        <p className="text-xs text-text-secondary mt-1">
                                          Categoria padrão: {domainConfig.defaultCategory}
                                        </p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-text-secondary text-sm">Nenhum tenant configurado</p>
                    )}
                  </div>
                  
                  <div className="mt-6 p-4 bg-accent-light rounded-lg border border-accent-primary/20">
                    <p className="text-sm text-text-secondary">
                      💡 O RAG Service é um serviço Python (FastAPI) que fornece funcionalidades de Retrieval-Augmented Generation.
                      Por padrão, o serviço roda na porta <strong>9000</strong>. Certifique-se de que o serviço está rodando antes de usar.
                    </p>
                    <p className="text-sm text-text-secondary mt-2">
                      Para iniciar o serviço manualmente: <code className="bg-bg-primary px-2 py-1 rounded text-xs">cd rag-service && uvicorn main:app --reload --host 0.0.0.0 --port 9000</code>
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Aba: WhatsApp */}
            {activeTab === 'whatsapp' && (
              <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
                <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
                  <span>💬</span>
                  <span>WhatsApp</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {renderField('URL da API', 'whatsapp.apiUrl', editedConfig.whatsapp?.apiUrl)}
                  {renderField('Phone Number ID', 'whatsapp.phoneNumberId', editedConfig.whatsapp?.phoneNumberId)}
                  {renderField('Access Token', 'whatsapp.accessToken', editedConfig.whatsapp?.accessToken, 'password')}
                  {renderField('Verify Token', 'whatsapp.verifyToken', editedConfig.whatsapp?.verifyToken)}
                </div>
                <div className="mt-6 p-4 bg-accent-light rounded-lg border border-accent-primary/20">
                  <p className="text-sm text-text-secondary">
                    💡 Configure seu WhatsApp Business no painel da Meta:{' '}
                    <a 
                      href="https://business.facebook.com/" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-accent-primary hover:underline"
                    >
                      business.facebook.com
                    </a>
                    {' '}ou acesse o{' '}
                    <a 
                      href="https://developers.facebook.com/apps/" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-accent-primary hover:underline"
                    >
                      painel de desenvolvedores
                    </a>
                  </p>
                </div>
              </div>
            )}

            {/* Aba: Fluxos */}
            {activeTab === 'flows' && (
              <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
                <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
                  <span>🔄</span>
                  <span>Fluxos</span>
                </h3>
                {renderField(
                  'ID do Fluxo Padrão', 
                  'flows.defaultFlowId', 
                  editedConfig.flows?.defaultFlowId,
                  'text',
                  loadingFlows 
                    ? [{ value: '', label: 'Carregando...' }]
                    : flows.length > 0
                      ? [{ value: '', label: 'Nenhum (vazio)' }, ...flows.map(f => ({ value: f.id, label: `${f.name || f.id} (${f.id})` }))]
                      : null
                )}
                {loadingFlows && (
                  <p className="text-sm text-text-secondary mt-2">Carregando lista de fluxos...</p>
                )}
                {!loadingFlows && flows.length === 0 && (
                  <p className="text-sm text-text-secondary mt-2">Nenhum fluxo encontrado. Você pode digitar o ID manualmente.</p>
                )}
              </div>
            )}

            {/* Aba: IA */}
            {activeTab === 'ai' && (
              <div className="space-y-6">
                <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
                  <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
                    <span>🤖</span>
                    <span>Inteligência Artificial</span>
                  </h3>
                  
                  {(() => {
                    const currentTenantId = agent?.tenantId;
                    
                    // Se não houver tenant, mostra mensagem
                    if (!currentTenantId) {
                      return (
                        <div className="p-4 bg-status-warning/10 rounded-lg border border-status-warning/30">
                          <p className="text-sm text-text-primary">
                            <strong>⚠️ Não autenticado:</strong> É necessário estar autenticado para configurar IA.
                          </p>
                        </div>
                      );
                    }

                    // Carregando configuração
                    if (loadingTenantAiConfig) {
                      return (
                        <div className="p-4 text-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-primary mx-auto mb-2"></div>
                          <p className="text-sm text-text-secondary">Carregando configuração de IA...</p>
                        </div>
                      );
                    }

                    const tenantToUse = targetTenantId || agent?.tenantId;
                    const currentConfig = tenantAiConfig || {
                      tenantId: tenantToUse || null,
                      primary: null,
                      secondary: null,
                      configured: false,
                      model: null,
                      temperature: null,
                      max_tokens: null
                    };

                    return (
                      <div className="space-y-4">
                        <div className="p-4 bg-status-info/10 rounded-lg border border-status-info/30">
                          <p className="text-sm text-text-primary">
                            <strong>ℹ️ Tenant:</strong> {tenantToUse}
                            {targetTenantId && targetTenantId !== agent?.tenantId && (
                              <span className="text-xs text-text-secondary ml-2">(configurando como super-admin)</span>
                            )}
                          </p>
                          <p className="text-xs text-text-secondary mt-1">
                            Esta configuração é específica para este tenant. Cada tenant precisa ter seu próprio provider configurado.
                          </p>
                        </div>

                        <div className="mb-4 p-4 bg-status-warning/10 rounded-lg border border-status-warning/30">
                          <p className="text-sm text-text-primary">
                            <strong>⚠️ Importante:</strong> Cada tenant DEVE ter uma configuração específica de provider de IA. 
                            Esta configuração é obrigatória para que o tenant possa usar os recursos de IA.
                          </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div>
                            <label className="block mb-2 text-sm font-medium text-text-primary">
                              Provider Primário (Obrigatório)
                            </label>
                              <select
                                value={currentConfig.primary || ''}
                                onChange={(e) => {
                                  const newPrimary = e.target.value || null;
                                  setTenantAiConfig({
                                    ...currentConfig,
                                    primary: newPrimary,
                                    configured: !!newPrimary,
                                    // Reset modelo quando provider muda (modelos são específicos por provider)
                                    model: null
                                  });
                                  // Reset estado de credenciais quando provider muda
                                  setCredentialsValidatedAndSaved(false);
                                  setApiKeyValidationStatus(null);
                                }}
                              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                            >
                              <option value="">Selecione um provider...</option>
                              <option value="openai">OpenAI</option>
                              <option value="anthropic">Anthropic (Claude)</option>
                            </select>
                          </div>

                          <div>
                            <label className="block mb-2 text-sm font-medium text-text-primary">
                              Provider Secundário (Opcional)
                            </label>
                            <select
                              value={currentConfig.secondary || ''}
                              onChange={(e) => {
                                const newSecondary = e.target.value || null;
                                setTenantAiConfig({
                                  ...currentConfig,
                                  secondary: newSecondary
                                });
                              }}
                              disabled={!currentConfig.primary}
                              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <option value="">Nenhum</option>
                              {currentConfig.primary !== 'openai' && <option value="openai">OpenAI</option>}
                              {currentConfig.primary !== 'anthropic' && <option value="anthropic">Anthropic (Claude)</option>}
                            </select>
                          </div>
                        </div>

                        {/* Modelo e Parâmetros */}
                        {currentConfig.primary && (
                          <div className="pt-6 border-t border-border-default space-y-4">
                            <h4 className="text-lg font-medium text-text-primary">Modelo e Parâmetros</h4>
                            
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                              <div>
                                <label className="block mb-2 text-sm font-medium text-text-primary">
                                  Modelo
                                </label>
                                <select
                                  value={currentConfig.model || ''}
                                  onChange={(e) => {
                                    setTenantAiConfig({
                                      ...currentConfig,
                                      model: e.target.value || null
                                    });
                                  }}
                                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                                >
                                  <option value="">Padrão do provider</option>
                                  {currentConfig.primary === 'openai' && (
                                    <>
                                      <option value="gpt-4">GPT-4</option>
                                      <option value="gpt-4-turbo">GPT-4 Turbo</option>
                                      <option value="gpt-4o">GPT-4o</option>
                                      <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                                    </>
                                  )}
                                  {currentConfig.primary === 'anthropic' && (
                                    <>
                                      <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                                      <option value="claude-3-opus-20240229">Claude 3 Opus</option>
                                      <option value="claude-3-sonnet-20240229">Claude 3 Sonnet</option>
                                      <option value="claude-3-haiku-20240307">Claude 3 Haiku</option>
                                    </>
                                  )}
                                </select>
                              </div>

                              <div>
                                <label className="block mb-2 text-sm font-medium text-text-primary">
                                  Temperatura (0-2)
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  max="2"
                                  step="0.1"
                                  value={currentConfig.temperature ?? ''}
                                  onChange={(e) => {
                                    const value = e.target.value === '' ? null : parseFloat(e.target.value);
                                    setTenantAiConfig({
                                      ...currentConfig,
                                      temperature: value
                                    });
                                  }}
                                  placeholder="Padrão: 0.7"
                                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                                />
                              </div>

                              <div>
                                <label className="block mb-2 text-sm font-medium text-text-primary">
                                  Max Tokens
                                </label>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={currentConfig.max_tokens ?? ''}
                                  onChange={(e) => {
                                    const value = e.target.value === '' ? null : parseInt(e.target.value);
                                    setTenantAiConfig({
                                      ...currentConfig,
                                      max_tokens: value
                                    });
                                  }}
                                  placeholder="Padrão: 2000"
                                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                                />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Credenciais */}
                        {currentConfig.primary && (
                          <div className="pt-6 border-t border-border-default space-y-4">
                            <h4 className="text-lg font-medium text-text-primary">Credenciais</h4>
                            
                            <div className="p-4 bg-status-info/10 rounded-lg border border-status-info/30">
                              <p className="text-sm text-text-primary">
                                <strong>ℹ️ Segurança:</strong> A chave atual nunca é exibida por segurança.
                              </p>
                              <p className="text-xs text-text-secondary mt-1">
                                Para atualizar a chave, informe uma nova chave no campo abaixo e clique em "Salvar Credenciais".
                              </p>
                            </div>

                            <div>
                              <label className="block mb-2 text-sm font-medium text-text-primary">
                                Provider para API Key
                              </label>
                              <select
                                value={apiKeyProvider}
                                onChange={(e) => setApiKeyProvider(e.target.value)}
                                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                              >
                                <option value="">Selecione um provider...</option>
                                {currentConfig.primary && <option value={currentConfig.primary}>{currentConfig.primary === 'openai' ? 'OpenAI' : 'Anthropic (Claude)'}</option>}
                                {currentConfig.secondary && <option value={currentConfig.secondary}>{currentConfig.secondary === 'openai' ? 'OpenAI' : 'Anthropic (Claude)'}</option>}
                              </select>
                            </div>

                            <div>
                              <label className="block mb-2 text-sm font-medium text-text-primary">
                                API Key
                              </label>
                              <div className="flex gap-2">
                                <div className="relative flex-1">
                                  <input
                                    type="password"
                                    value={apiKey}
                                    onChange={(e) => {
                                      setApiKey(e.target.value);
                                      // Limpa status de validação quando o valor muda
                                      setApiKeyValidationStatus(null);
                                    }}
                                    disabled={!apiKeyProvider}
                                    placeholder="Informe uma nova chave para atualizar"
                                    className={`w-full px-3 py-2 pr-10 bg-bg-secondary border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed ${
                                      apiKeyValidationStatus
                                        ? apiKeyValidationStatus.valid
                                          ? 'border-status-success'
                                          : 'border-status-error'
                                        : 'border-border-default'
                                    }`}
                                  />
                                  {apiKeyValidationStatus && (
                                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                                      {apiKeyValidationStatus.valid ? (
                                        <svg className="w-5 h-5 text-status-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                      ) : (
                                        <svg className="w-5 h-5 text-status-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                      )}
                                    </div>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (!apiKey || apiKey.trim() === '') {
                                      showToast('Informe uma API Key para testar', 'warning');
                                      return;
                                    }
                                    if (!apiKeyProvider) {
                                      showToast('Selecione um provider antes de testar', 'error');
                                      return;
                                    }

                                    setValidatingApiKey(true);
                                    setApiKeyValidationStatus(null);

                                    try {
                                      const result = await validateProviderToken(apiKeyProvider, apiKey.trim());
                                      setApiKeyValidationStatus({
                                        valid: result.valid,
                                        error: result.error || null,
                                      });

                                      if (result.valid) {
                                        showToast(`API Key ${apiKeyProvider === 'openai' ? 'OpenAI' : 'Anthropic'} válida!`, 'success');
                                      } else {
                                        showToast(`API Key ${apiKeyProvider === 'openai' ? 'OpenAI' : 'Anthropic'} inválida: ${result.error || 'Erro desconhecido'}`, 'error');
                                      }
                                    } catch (error) {
                                      logger.error('Erro ao validar API Key', error);
                                      setApiKeyValidationStatus({
                                        valid: false,
                                        error: error.message || 'Erro ao validar API Key',
                                      });
                                      showToast(`Erro ao validar API Key: ${error.message || 'Erro desconhecido'}`, 'error');
                                    } finally {
                                      setValidatingApiKey(false);
                                    }
                                  }}
                                  disabled={!apiKey || !apiKey.trim() || !apiKeyProvider || validatingApiKey}
                                  className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium whitespace-nowrap"
                                >
                                  {validatingApiKey ? (
                                    <>
                                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                      <span>Testando...</span>
                                    </>
                                  ) : (
                                    <>
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                      </svg>
                                      <span>Testar API Key</span>
                                    </>
                                  )}
                                </button>
                              </div>
                              {apiKeyValidationStatus && !apiKeyValidationStatus.valid && apiKeyValidationStatus.error && (
                                <p className="mt-1 text-xs text-status-error">{apiKeyValidationStatus.error}</p>
                              )}
                              {apiKeyValidationStatus && apiKeyValidationStatus.valid && (
                                <p className="mt-1 text-xs text-status-success">✓ API Key válida e funcionando corretamente</p>
                              )}
                              <p className="text-xs text-text-secondary mt-1">
                                A chave atual nunca é exibida por segurança. Informe uma nova chave para atualizar.
                              </p>
                            </div>

                            {/* Botão Salvar Credenciais */}
                            <div className="flex gap-3">
                              <button
                                onClick={async () => {
                                  if (!apiKey || apiKey.trim() === '') {
                                    showToast('Informe uma API Key para salvar', 'warning');
                                    return;
                                  }
                                  if (!apiKeyProvider) {
                                    showToast('Selecione um provider antes de salvar credenciais', 'error');
                                    return;
                                  }

                                  setSavingTenantAiCredentials(true);
                                  try {
                                    // Usa targetTenantId se disponível (super-admin), senão undefined (usa current)
                                    await saveTenantAiCredentials({
                                      provider: apiKeyProvider,
                                      apiKey: apiKey.trim()
                                    }, targetTenantId || undefined);
                                    // Se a API Key foi validada antes de salvar, marca como validada e salva
                                    if (apiKeyValidationStatus && apiKeyValidationStatus.valid) {
                                      setCredentialsValidatedAndSaved(true);
                                      showToast('Credenciais validadas e salvas com sucesso!', 'success');
                                    } else {
                                      showToast('Credenciais salvas, mas não foram validadas. Teste a API Key antes de salvar para garantir que está funcionando.', 'warning');
                                    }
                                    setApiKey(''); // Limpa o campo após salvar
                                    setApiKeyProvider(''); // Limpa o provider também
                                    setApiKeyValidationStatus(null); // Limpa status de validação
                                  } catch (error) {
                                    logger.error('Erro ao salvar credenciais de IA', error);
                                    const errorMessage = error.body?.message || error.message || 'Erro ao salvar credenciais';
                                    showToast(`Erro: ${errorMessage}`, 'error');
                                  } finally {
                                    setSavingTenantAiCredentials(false);
                                  }
                                }}
                                disabled={savingTenantAiConfig || savingTenantAiCredentials || !apiKeyProvider || !apiKey.trim() || !apiKeyValidationStatus?.valid}
                                className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium"
                              >
                                {savingTenantAiCredentials ? (
                                  <>
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                    <span>Salvando...</span>
                                  </>
                                ) : (
                                  <>
                                    <span>🔐</span>
                                    <span>Salvar Credenciais</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        )}

                        {currentConfig.configured && credentialsValidatedAndSaved && (
                          <div className="p-3 bg-status-success/10 rounded-lg border border-status-success/30">
                            <p className="text-sm text-status-success">
                              ✓ Configuração de IA ativa para este tenant
                            </p>
                            <p className="text-xs text-status-success mt-1">
                              Provider configurado e credenciais validadas e salvas com sucesso.
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Aba: Features */}
            {activeTab === 'features' && (
              <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
                <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
                  <span>✨</span>
                  <span>Features</span>
                </h3>
                <div className="space-y-4">
                  <label className="flex items-center gap-3 p-4 bg-bg-primary rounded-lg border border-border-default hover:border-border-hover transition-colors cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editedConfig.features?.aiTasksEnabled || false}
                      onChange={(e) => updateValue('features.aiTasksEnabled', e.target.checked)}
                      className="w-5 h-5 rounded border-border-default text-accent-primary focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 focus:ring-offset-bg-secondary cursor-pointer"
                    />
                    <div className="flex-1">
                      <span className="text-text-primary font-medium">Tarefas de IA Habilitadas</span>
                      <p className="text-text-secondary text-sm mt-1">(aiTasksEnabled)</p>
                    </div>
                  </label>
                  <div className="p-4 bg-accent-light rounded-lg border border-accent-primary/20">
                    <p className="text-sm text-text-secondary">
                      💡 Controla se as tarefas de IA estão habilitadas. Quando desabilitado, todas as tarefas de IA retornam fallback.
                    </p>
                  </div>
                  <label className="flex items-center gap-3 p-4 bg-bg-primary rounded-lg border border-border-default hover:border-border-hover transition-colors cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editedConfig.features?.useRealAiApi || false}
                      onChange={(e) => updateValue('features.useRealAiApi', e.target.checked)}
                      className="w-5 h-5 rounded border-border-default text-accent-primary focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 focus:ring-offset-bg-secondary cursor-pointer"
                    />
                    <div className="flex-1">
                      <span className="text-text-primary font-medium">Usar API Real de IA</span>
                      <p className="text-text-secondary text-sm mt-1">(useRealAiApi)</p>
                    </div>
                  </label>
                  <div className="p-4 bg-accent-light rounded-lg border border-accent-primary/20">
                    <p className="text-sm text-text-secondary">
                      💡 Quando habilitado, faz chamadas HTTP reais à API de IA (/api/ai/generate) ao invés de usar a implementação mock local baseada em palavras-chave. As requisições aparecerão na aba Network do DevTools.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Aba: Scripts */}
            {activeTab === 'scripts' && (
              <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
                <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
                  <span>📜</span>
                  <span>Scripts</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {renderField('URL da API', 'scripts.apiUrl', editedConfig.scripts?.apiUrl)}
                  {renderField('Idade Máxima (dias)', 'scripts.maxAgeDays', editedConfig.scripts?.maxAgeDays, 'number')}
                </div>
                <div className="mt-6">
                  <label className="flex items-center gap-3 p-4 bg-bg-primary rounded-lg border border-border-default hover:border-border-hover transition-colors cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editedConfig.scripts?.dryRun || false}
                      onChange={(e) => updateValue('scripts.dryRun', e.target.checked)}
                      className="w-5 h-5 rounded border-border-default text-accent-primary focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 focus:ring-offset-bg-secondary cursor-pointer"
                    />
                    <span className="text-text-primary font-medium">Dry Run (modo simulação)</span>
                  </label>
                </div>
              </div>
            )}

            {/* Aba: Logging */}
            {activeTab === 'logging' && (
              <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
                <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
                  <span>📝</span>
                  <span>Logging</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {renderField(
                    'Nível de Log', 
                    'logging.level', 
                    editedConfig.logging?.level,
                    'text',
                    [
                      { value: 'DEBUG', label: 'DEBUG - Todas as mensagens (0)' },
                      { value: 'INFO', label: 'INFO - Informações, avisos e erros (1)' },
                      { value: 'WARN', label: 'WARN - Apenas avisos e erros (2)' },
                      { value: 'ERROR', label: 'ERROR - Apenas erros (3)' },
                      { value: 'NONE', label: 'NONE - Nenhum log (4)' }
                    ]
                  )}
                  {renderField(
                    'Formato de Saída', 
                    'logging.format', 
                    editedConfig.logging?.format,
                    'text',
                    [
                      { value: 'json', label: 'JSON - Formato estruturado (recomendado)' },
                      { value: 'text', label: 'TEXT - Formato texto legível' }
                    ]
                  )}
                </div>
                <div className="mt-6 p-4 bg-accent-light rounded-lg border border-accent-primary/20">
                  <p className="text-sm text-text-secondary mb-2">
                    <strong>💡 Níveis de Log:</strong>
                  </p>
                  <ul className="text-sm text-text-secondary space-y-1 ml-4 list-disc">
                    <li><strong>DEBUG:</strong> Todas as mensagens, incluindo informações detalhadas para debugging</li>
                    <li><strong>INFO:</strong> Informações gerais, avisos e erros (padrão em produção)</li>
                    <li><strong>WARN:</strong> Apenas avisos e erros</li>
                    <li><strong>ERROR:</strong> Apenas erros</li>
                    <li><strong>NONE:</strong> Nenhum log será exibido</li>
                  </ul>
                </div>
                <div className="mt-4 p-4 bg-status-info/10 rounded-lg border border-status-info/30">
                  <p className="text-sm text-text-primary">
                    <strong>ℹ️ Nota:</strong> Após alterar as configurações de logging, reinicie o servidor da API para aplicar as mudanças.
                  </p>
                </div>
              </div>
            )}

            {/* Aba: Rate Limiting */}
            {activeTab === 'rateLimit' && (
              <div className="space-y-6">
                <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
                  <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
                    <span>🚦</span>
                    <span>Rate Limiting</span>
                  </h3>
                  
                  <div className="mb-6 pb-6 border-b border-border-default">
                    <h4 className="text-lg font-medium text-text-primary mb-4">Redis</h4>
                    {renderField('URL do Redis', 'rateLimit.redis.url', editedConfig.rateLimit?.redis?.url)}
                    <div className="mt-4 p-4 bg-accent-light rounded-lg border border-accent-primary/20">
                      <p className="text-sm text-text-secondary">
                        💡 URL de conexão do Redis para armazenar contadores de rate limiting. Exemplo: <code className="bg-bg-primary px-1 rounded">redis://localhost:6379</code>
                      </p>
                    </div>
                  </div>

                  <div className="mb-6 pb-6 border-b border-border-default">
                    <h4 className="text-lg font-medium text-text-primary mb-4">Políticas - DRY-RUN</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {renderField('Pontos (execuções)', 'rateLimit.policies.dryRun.points', editedConfig.rateLimit?.policies?.dryRun?.points, 'number')}
                      {renderField('Duração (segundos)', 'rateLimit.policies.dryRun.duration', editedConfig.rateLimit?.policies?.dryRun?.duration, 'number')}
                    </div>
                    <div className="mt-4 p-4 bg-status-info/10 rounded-lg border border-status-info/30">
                      <p className="text-sm text-text-secondary">
                        ℹ️ DRY-RUN é mais permissivo (padrão: 50 execuções por minuto) - usado para testes
                      </p>
                    </div>
                  </div>

                  <div className="mb-6 pb-6 border-b border-border-default">
                    <h4 className="text-lg font-medium text-text-primary mb-4">Políticas - Geração Real</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {renderField('Pontos (execuções)', 'rateLimit.policies.generation.points', editedConfig.rateLimit?.policies?.generation?.points, 'number')}
                      {renderField('Duração (segundos)', 'rateLimit.policies.generation.duration', editedConfig.rateLimit?.policies?.generation?.duration, 'number')}
                    </div>
                    <div className="mt-4 p-4 bg-status-warning/10 rounded-lg border border-status-warning/30">
                      <p className="text-sm text-text-secondary">
                        ⚠️ Geração real é restritiva (padrão: 5 execuções por minuto) - usado em produção
                      </p>
                    </div>
                  </div>

                  <div className="mb-6 pb-6 border-b border-border-default">
                    <h4 className="text-lg font-medium text-text-primary mb-4">Políticas - Bootstrap</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {renderField('Pontos (execuções)', 'rateLimit.policies.bootstrap.points', editedConfig.rateLimit?.policies?.bootstrap?.points, 'number')}
                      {renderField('Duração (segundos)', 'rateLimit.policies.bootstrap.duration', editedConfig.rateLimit?.policies?.bootstrap?.duration, 'number')}
                    </div>
                    <div className="mt-4 p-4 bg-status-error/10 rounded-lg border border-status-error/30">
                      <p className="text-sm text-text-secondary">
                        🚨 Bootstrap é extremamente restritivo (padrão: 1 execução a cada 5 minutos) - usado para operações críticas
                      </p>
                    </div>
                  </div>

                  <div className="mb-6 pb-6 border-b border-border-default">
                    <h4 className="text-lg font-medium text-text-primary mb-4">Políticas - Scraping</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {renderField('Pontos (requisições)', 'rateLimit.policies.scraping.points', editedConfig.rateLimit?.policies?.scraping?.points, 'number')}
                      {renderField('Duração (segundos)', 'rateLimit.policies.scraping.duration', editedConfig.rateLimit?.policies?.scraping?.duration, 'number')}
                      {renderField('Requisições por Segundo (por domínio)', 'rateLimit.policies.scraping.requestsPerSecond', editedConfig.rateLimit?.policies?.scraping?.requestsPerSecond, 'number')}
                      {renderField('Páginas por Execução', 'rateLimit.policies.scraping.pagesPerExecution', editedConfig.rateLimit?.policies?.scraping?.pagesPerExecution, 'number')}
                    </div>
                    <div className="mt-4 p-4 bg-status-info/10 rounded-lg border border-status-info/30">
                      <p className="text-sm text-text-secondary">
                        ℹ️ Scraping tem limites por domínio (requests por segundo) e por execução (páginas máximas)
                      </p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <h4 className="text-lg font-medium text-text-primary mb-4">Políticas - Validação de Sistema</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {renderField('Pontos (execuções)', 'rateLimit.policies.systemValidate.points', editedConfig.rateLimit?.policies?.systemValidate?.points, 'number')}
                      {renderField('Duração (segundos)', 'rateLimit.policies.systemValidate.duration', editedConfig.rateLimit?.policies?.systemValidate?.duration, 'number')}
                    </div>
                  </div>

                  <div className="mt-6 p-4 bg-status-info/10 rounded-lg border border-status-info/30">
                    <p className="text-sm text-text-primary mb-2">
                      <strong>ℹ️ Sobre Rate Limiting:</strong>
                    </p>
                    <ul className="text-sm text-text-secondary space-y-1 ml-4 list-disc">
                      <li>Todas as execuções passam por rate limiting antes de qualquer processamento</li>
                      <li>Rate limiting bloqueia execuções que excedem os limites configurados</li>
                      <li>Erros de rate limit retornam HTTP 429 com informação de quando tentar novamente</li>
                      <li>Eventos são registrados em <code className="bg-bg-primary px-1 rounded">reports/rate-limit-events.json</code></li>
                      <li>Redis é obrigatório em produção para rate limiting distribuído</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Aba: Geral */}
            {activeTab === 'general' && (
              <div className="bg-bg-secondary rounded-lg p-6 border border-border-default">
                <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
                  <span>🌐</span>
                  <span>Geral</span>
                </h3>
                {renderField(
                  'Ambiente', 
                  'nodeEnv', 
                  editedConfig.nodeEnv,
                  'text',
                  [
                    { value: 'production', label: 'Production (Produção)' },
                    { value: 'development', label: 'Development (Desenvolvimento)' },
                    { value: 'test', label: 'Test (Teste)' }
                  ]
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              className={`w-full min-h-[500px] p-4 font-mono text-sm rounded-lg bg-bg-secondary border-2 transition-all focus:outline-none focus:ring-2 focus:ring-accent-primary ${
                jsonError 
                  ? 'border-status-error focus:ring-status-error' 
                  : 'border-border-default focus:border-transparent'
              } text-text-primary`}
              spellCheck={false}
            />
            {jsonError && (
              <div className="mt-4 p-4 bg-status-error/10 border border-status-error rounded-lg">
                <p className="text-status-error font-medium flex items-center gap-2">
                  <span>❌</span>
                  <span>Erro no JSON: {jsonError}</span>
                </p>
              </div>
            )}
          </div>
        )}

        <ToastContainer />
        <ConfirmDialog />
        </div>
      </div>
    </>
  );
}
