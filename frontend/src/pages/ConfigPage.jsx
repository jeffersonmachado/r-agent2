import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getConfig, updateConfig, reloadConfig, restartServer, getProcessManager, validateProviderToken } from '../api/config';
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
  const { isAuthenticated, loading: authLoading } = useAuth();
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
  const [activeTab, setActiveTab] = useState('api'); // 'api', 'frontend', 'whatsapp', 'flows', 'ai', 'features', 'scripts', 'logging', 'general'
  const [flows, setFlows] = useState([]);
  const [loadingFlows, setLoadingFlows] = useState(false);
  const [validatingTokens, setValidatingTokens] = useState({}); // { 'ai.openai.apiKey': true }
  const [tokenValidationStatus, setTokenValidationStatus] = useState({}); // { 'ai.openai.apiKey': { valid: true, error: null } }

  const configLoadedRef = useRef(false);
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
      setConfig(data);
      setEditedConfig(JSON.parse(JSON.stringify(data))); // Deep copy
      setJsonText(JSON.stringify(data, null, 2));
      setHasChanges(false);
      setJsonError(null);
    } catch (error) {
      logger.error('Erro ao carregar configuração', error);
      showToastRef.current('Erro ao carregar configuração', 'error');
      configLoadedRef.current = false; // Permite tentar novamente
    } finally {
      setLoading(false);
    }
  }, []);

  // Carrega na montagem (apenas uma vez)
  useEffect(() => {
    if (!configLoadedRef.current) {
      loadConfig();
    }
  }, [loadConfig]);

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

    if (!editedConfig) {
      showToast('Nenhuma configuração para salvar', 'warning');
      return;
    }

    setSaving(true);
    try {
      await updateConfig(editedConfig);
      showToast('Configuração salva com sucesso!', 'success');
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

  // Atualiza valor no modo form
  const updateValue = useCallback((path, value) => {
    if (!editedConfig) return;

    const keys = path.split('.');
    const newConfig = JSON.parse(JSON.stringify(editedConfig)); // Deep copy

    let current = newConfig;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }

    const lastKey = keys[keys.length - 1];
    if (value === '' || value === null) {
      delete current[lastKey];
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
  }, [editedConfig, viewMode]);

  // Renderiza campo de input para um valor
  const renderField = (label, path, value, type = 'text', options = null) => {
    const displayValue = value === null || value === undefined ? '' : String(value);
    const isTokenField = path === 'ai.openai.apiKey' || path === 'ai.anthropic.apiKey';
    const isValidating = validatingTokens[path] || false;
    const validationStatus = tokenValidationStatus[path];

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
                  validationStatus
                    ? validationStatus.valid
                      ? 'border-status-success'
                      : 'border-status-error'
                    : 'border-border-default'
                }`}
                placeholder={label}
              />
            )}
            {isTokenField && validationStatus && (
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                {validationStatus.valid ? (
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
          {isTokenField && (
            <button
              type="button"
              onClick={() => validateToken(path, displayValue)}
              disabled={!displayValue || isValidating}
              className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium whitespace-nowrap"
            >
              {isValidating ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Testando...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Testar Token</span>
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
      </div>
    );
  };

  const tabs = [
    { id: 'api', label: 'API', icon: '⚙️' },
    { id: 'frontend', label: 'Frontend', icon: '🖥️' },
    { id: 'whatsapp', label: 'WhatsApp', icon: '💬' },
    { id: 'flows', label: 'Fluxos', icon: '🔄' },
    { id: 'ai', label: 'IA', icon: '🤖' },
    { id: 'features', label: 'Features', icon: '✨' },
    { id: 'scripts', label: 'Scripts', icon: '📜' },
    { id: 'logging', label: 'Logging', icon: '📝' },
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
    <div className="min-h-screen bg-bg-primary p-6">
      <div className="max-w-7xl mx-auto">
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
              disabled={saving || !hasChanges || jsonError} 
              variant="primary"
              className="flex items-center gap-2"
            >
              {saving ? (
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
                    {renderField('Tenant Padrão', 'api.defaultTenantId', editedConfig.api?.defaultTenantId)}
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
                  
                  <div className="mb-6 pb-6 border-b border-border-default">
                    <h4 className="text-lg font-medium text-text-primary mb-4">Configuração Geral</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {renderField(
                        'Provider Padrão', 
                        'ai.defaultProvider', 
                        editedConfig.ai?.defaultProvider,
                        'text',
                        [
                          { value: 'openai', label: 'OpenAI' },
                          { value: 'anthropic', label: 'Anthropic (Claude)' },
                          { value: 'fallback', label: 'Fallback (Simulado)' }
                        ]
                      )}
                      {renderField(
                        'Provider de Fallback', 
                        'ai.defaultFallback', 
                        editedConfig.ai?.defaultFallback,
                        'text',
                        [
                          { value: 'fallback', label: 'Fallback (Simulado)' },
                          { value: 'openai', label: 'OpenAI' },
                          { value: 'anthropic', label: 'Anthropic (Claude)' }
                        ]
                      )}
                    </div>
                  </div>
                  
                  <div className="mb-6 pb-6 border-b border-border-default">
                    <h4 className="text-lg font-medium text-text-primary mb-4">OpenAI</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {renderField('API Key', 'ai.openai.apiKey', editedConfig.ai?.openai?.apiKey, 'password')}
                      {renderField(
                        'Modelo', 
                        'ai.openai.model', 
                        editedConfig.ai?.openai?.model,
                        'text',
                        [
                          { value: 'gpt-5.2', label: 'GPT-5.2 (Mais recente - Recomendado)' },
                          { value: 'gpt-5.1', label: 'GPT-5.1' },
                          { value: 'gpt-4o-2024-11-20', label: 'GPT-4o (Nov 2024)' },
                          { value: 'gpt-4o', label: 'GPT-4o' },
                          { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Rápido e econômico)' },
                          { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
                          { value: 'gpt-4-turbo-preview', label: 'GPT-4 Turbo Preview' },
                          { value: 'gpt-4', label: 'GPT-4' },
                          { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (Recomendado para custo)' },
                          { value: 'gpt-3.5-turbo-16k', label: 'GPT-3.5 Turbo 16k' }
                        ]
                      )}
                    </div>
                    <div className="mt-4 p-4 bg-accent-light rounded-lg border border-accent-primary/20">
                      <p className="text-sm text-text-secondary">
                        💡 Obtenha sua chave em:{' '}
                        <a 
                          href="https://platform.openai.com/api-keys" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-accent-primary hover:underline"
                        >
                          platform.openai.com/api-keys
                        </a>
                      </p>
                    </div>
                  </div>

                  <div className="mb-6">
                    <h4 className="text-lg font-medium text-text-primary mb-4">Anthropic (Claude)</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {renderField('API Key', 'ai.anthropic.apiKey', editedConfig.ai?.anthropic?.apiKey, 'password')}
                      {renderField(
                        'Modelo', 
                        'ai.anthropic.model', 
                        editedConfig.ai?.anthropic?.model,
                        'text',
                        [
                          { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (Mais recente)' },
                          { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
                          { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet (Recomendado)' },
                          { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku (Rápido)' }
                        ]
                      )}
                    </div>
                    <div className="mt-4 p-4 bg-accent-light rounded-lg border border-accent-primary/20">
                      <p className="text-sm text-text-secondary">
                        💡 Obtenha sua chave em:{' '}
                        <a 
                          href="https://console.anthropic.com/" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-accent-primary hover:underline"
                        >
                          console.anthropic.com
                        </a>
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 p-4 bg-status-info/10 rounded-lg border border-status-info/30">
                    <p className="text-sm text-text-primary">
                      <strong>ℹ️ Nota:</strong> Após configurar, reinicie o servidor da API para aplicar as mudanças. 
                      Os providers precisam ter os SDKs instalados (npm install openai ou npm install @anthropic-ai/sdk) 
                      e o código real implementado em <code className="bg-bg-primary px-1 rounded">api/services/aiProviderService.js</code>.
                    </p>
                  </div>
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
  );
}
