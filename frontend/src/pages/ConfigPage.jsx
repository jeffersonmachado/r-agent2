import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getConfig, updateConfig, reloadConfig, restartServer, getProcessManager, validateProviderToken, validateRedisConnection, getTenantAiConfig, saveTenantAiCredentials, validateBillingCredentials } from '../api/config';
import { getTenantSetting, upsertTenantSetting } from '../api/tenantSettings';
import { listFlows } from '../api/flows';
import { useAuth } from '../context/authContext';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { NavigationLink } from '../components/NavigationLink';
import { useTheme } from '../styles/themeContext';
import { useRouter } from '../hooks/useRouter';
import logger from '../utils/logger';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { CrudPageBase } from '../modules/crud-base';
import { ConfigApiTab } from './config/ConfigApiTab';
import { ConfigFrontendTab } from './config/ConfigFrontendTab';
import { ConfigRagTab } from './config/ConfigRagTab';
import { ConfigWhatsappTab } from './config/ConfigWhatsappTab';
import { ConfigBillingTab } from './config/ConfigBillingTab';
import { ConfigFlowsTab } from './config/ConfigFlowsTab';
import { ConfigAiTab } from './config/ConfigAiTab';
import { ConfigFeaturesTab } from './config/ConfigFeaturesTab';
import { ConfigScriptsTab } from './config/ConfigScriptsTab';
import { ConfigLoggingTab } from './config/ConfigLoggingTab';
import { ConfigRateLimitTab } from './config/ConfigRateLimitTab';
import { ConfigFallbacksTab } from './config/ConfigFallbacksTab';
import { ConfigGeneralTab } from './config/ConfigGeneralTab';
import { ConfigEmailTab } from './config/ConfigEmailTab';
import { ConfigWebhooksTab } from './config/ConfigWebhooksTab';

/**
 * Página de gerenciamento de configuração do sistema.
 * Permite visualizar e editar o arquivo config.json.
 */
export function ConfigPage() {
  const { isAuthenticated, loading: authLoading, agent, capabilities, updateCapabilities } = useAuth();
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
      <CrudPageBase title="⚙️ Configuração do Sistema">
        <div className="page-loading">
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
    );
  }

  if (!isAuthenticated) {
    return null; // Será redirecionado pelo useEffect
  }
  const [config, setConfig] = useState(null);
  const [editedConfig, setEditedConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [billingValidation, setBillingValidation] = useState({}); // { provider: { apiKey: {valid,error}, webhookSecret: {valid,error} } }
  const [validatingBilling, setValidatingBilling] = useState(false);

  // Padrões rejeitados: placeholders que indicam campo não configurado
  const REJECTED_PATTERNS = [
    /^REPLACE/i,
    /OBTER_NO_META/i,
    /PLACEHOLDER/i,
    /REPLACE_WITH/i,
    /GERAR_COM/i,
  ];

  // Função de validação para campos de secret/webhook
  const validateFieldValue = useCallback((path, value) => {
    const str = String(value || '').trim();
    if (!str) return 'Campo obrigatório';
    for (const pattern of REJECTED_PATTERNS) {
      if (pattern.test(str)) return 'Valor placeholder — configure o segredo real';
    }
    if (str.length < 8) return 'Mínimo de 8 caracteres';
    return null;
  }, []);
  
  // Lê o parâmetro 'tab' da URL para abrir a aba correta
  // Tabs restritas a super_admin: rag, billing, whatsapp, email, ai, webhooks
  const SUPER_ADMIN_TABS = ['rag', 'billing', 'whatsapp', 'email', 'ai', 'webhooks'];
  const ALLOWED_TABS = ['api', 'frontend', 'flows', 'features', 'scripts', 'logging', 'rateLimit', 'fallbacks', 'general'];

  const getInitialTab = () => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get('tab');
      const allowedTabs = agent?.role === 'super_admin'
        ? [...ALLOWED_TABS, ...SUPER_ADMIN_TABS]
        : ALLOWED_TABS;
      if (tabParam && allowedTabs.includes(tabParam)) {
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
  
  const [activeTab, setActiveTab] = useState(getInitialTab); // 'api', 'frontend', 'rag', 'billing', 'whatsapp', 'email', 'flows', 'ai', 'features', 'scripts', 'logging', 'rateLimit', 'fallbacks', 'general'
  const [flows, setFlows] = useState([]);
  const [loadingFlows, setLoadingFlows] = useState(false);
  const [validatingRedis, setValidatingRedis] = useState(false);
  const [redisValidationStatus, setRedisValidationStatus] = useState(null); // { valid: true, error: null }
  
  // Estado específico para configuração de IA do tenant
  const [tenantAiConfig, setTenantAiConfig] = useState(null); // { tenantId, primary, secondary, configured, model, temperature, max_tokens }
  const [loadingTenantAiConfig, setLoadingTenantAiConfig] = useState(false);
  const [savingTenantAiConfig, setSavingTenantAiConfig] = useState(false);
  const [savingTenantAiCredentials, setSavingTenantAiCredentials] = useState(false);
  const [phoneMaskingEnabled, setPhoneMaskingEnabled] = useState(false);
  const [loadingPhoneMasking, setLoadingPhoneMasking] = useState(false);
  const [savingPhoneMasking, setSavingPhoneMasking] = useState(false);
  const [savingCapabilities, setSavingCapabilities] = useState(false);
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
              setHasChanges(false);
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
      // Campo somente leitura, calculado no backend para diagnóstico.
      delete filteredData.configValidation;
      
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
      setHasChanges(false);
      setFieldErrors({});
      
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

  const integrationReadiness = useMemo(() => {
    const integrations = config?.configValidation?.integrations;
    if (!integrations || typeof integrations !== 'object') return null;
    return {
      ready: Boolean(integrations.ready),
      missing: Array.isArray(integrations.missing) ? integrations.missing : [],
    };
  }, [config]);

  const hasEmailIntegrationGap = useMemo(() => (
    Boolean(integrationReadiness?.missing?.some((item) => String(item?.path || '').startsWith('notifications.email')))
  ), [integrationReadiness]);

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
        max_tokens: aiConfig?.max_tokens || null,
        providers: aiConfig?.providers || null
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
          max_tokens: null,
          providers: null
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
          max_tokens: null,
          providers: null
        });
      }
      setApiKey(''); // Sempre limpa apiKey
      setApiKeyProvider('');
      setCredentialsValidatedAndSaved(false); // Reset ao recarregar
    } finally {
      setLoadingTenantAiConfig(false);
    }
  }, [agent?.tenantId, targetTenantId]);

  const loadPhoneMasking = useCallback(async () => {
    setLoadingPhoneMasking(true);
    try {
      const resp = await getTenantSetting('phone-masking');
      const value = resp?.value || resp?.data?.value || null;
      setPhoneMaskingEnabled(!!(value && typeof value === 'object' && value.enabled));
    } catch (err) {
      setPhoneMaskingEnabled(false);
    } finally {
      setLoadingPhoneMasking(false);
    }
  }, []);

  // Capacidades de atendimento do tenant (Case Management) — editável por owner/admin/super_admin.
  // O estado de exibição vem direto do authContext (capabilities); em caso de erro o contexto não muda.
  const canManageCapabilities = ['owner', 'admin', 'super_admin'].includes(agent?.role);
  const handleUpdateCapabilities = useCallback(async (partialCapabilities) => {
    setSavingCapabilities(true);
    try {
      await updateCapabilities(partialCapabilities);
      showToast('Capacidades de atendimento atualizadas', 'success');
    } catch (err) {
      logger.warn('Falha ao atualizar capacidades do tenant:', err);
      showToast(err?.message || 'Erro ao atualizar capacidades de atendimento', 'error');
    } finally {
      setSavingCapabilities(false);
    }
  }, [updateCapabilities, showToast]);

  // Carrega configuração de IA quando a aba IA está ativa ou quando o tenant muda
  useEffect(() => {
    if (activeTab === 'ai') {
      loadTenantAiConfig();
    }
  }, [activeTab, loadTenantAiConfig]);

  useEffect(() => {
    if (activeTab === 'general') {
      loadPhoneMasking();
    }
  }, [activeTab, loadPhoneMasking]);

  // Detecta se há erros de validação em qualquer campo
  const hasValidationErrors = useMemo(() => {
    return Object.values(fieldErrors).some(err => err !== null && err !== undefined);
  }, [fieldErrors]);

  // Detecta mudanças usando useMemo com comparação direta
  const hasChangesMemo = useMemo(() => {
    if (!editedConfig || !config) return false;
    const editedString = JSON.stringify(editedConfig);
    const configString = JSON.stringify(config);
    return editedString !== configString;
  }, [editedConfig, config]);

  useEffect(() => {
    setHasChanges(hasChangesMemo);
  }, [hasChangesMemo]);

  // Salva configuração
  const handleSave = async () => {
    setSaving(true);
    try {
      // Se estiver na aba IA, providers e credenciais são salvos individualmente
      if (activeTab === 'ai') {
        showToast('Providers e credenciais são salvos individualmente na aba IA', 'info');
        setSaving(false);
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
    setHasChanges(false);
    setFieldErrors({});
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

  // Validação de token global removida: credenciais de IA são por-tenant e ficam no DB (criptografadas).

  // Valida conexão do Redis
  // Validação de credenciais de billing contra o provedor
  const handleValidateBilling = useCallback(async () => {
    if (!editedConfig) return;
    const provider = editedConfig?.billing?.provider || 'asaas';
    const apiKey = editedConfig?.billing?.providers?.[provider]?.apiKey || '';
    const webhookSecret = editedConfig?.billing?.providers?.[provider]?.webhookSecret || '';

    setValidatingBilling(true);
    try {
      const result = await validateBillingCredentials({ provider, apiKey, webhookSecret });
      setBillingValidation(prev => ({
        ...prev,
        [provider]: result,
      }));
      if (result.apiKey?.valid) showToast('✅ API Key validada com sucesso', 'success');
      else showToast('❌ API Key inválida: ' + (result.apiKey?.error || 'erro'), 'error');
    } catch (err) {
      showToast('Erro ao validar credenciais', 'error');
    } finally {
      setValidatingBilling(false);
    }
  }, [editedConfig, showToast]);

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

    // Valida campos do tipo password / secrets
    setFieldErrors(prev => {
      const next = { ...prev };
      next[path] = validateFieldValue(path, value);
      return next;
    });

    // Validação de token global removida: credenciais são por-tenant (DB).
    if (path === 'rateLimit.redis.url') {
      setRedisValidationStatus(null);
    }
  }, [editedConfig, showToast, validateFieldValue]);

  // Renderiza campo de input para um valor
  const renderField = (label, path, value, type = 'text', options = null) => {
    const displayValue = value === null || value === undefined ? '' : String(value);
    const isRedisField = path === 'rateLimit.redis.url';
    const redisValidating = isRedisField && validatingRedis;
    const redisStatus = isRedisField ? redisValidationStatus : null;
    const fieldError = fieldErrors[path] || null;
    const hasError = !!fieldError;

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
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all min-h-[80px] resize-y"
                placeholder={label}
              />
            ) : (
              <input
                type={type}
                value={displayValue}
                onChange={(e) => updateValue(path, e.target.value)}
                className={`w-full px-3 py-2 pr-10 bg-bg-secondary border rounded-lg text-text-primary focus:outline-none focus:ring-2 transition-all ${
                  hasError
                    ? 'border-status-error focus:ring-status-error'
                    : (redisStatus)
                      ? (redisStatus?.valid)
                        ? 'border-status-success focus:ring-accent-primary'
                        : 'border-status-error focus:ring-status-error'
                      : 'border-border-default focus:ring-accent-primary focus:border-transparent'
                }`}
                placeholder={label}
              />
            )}
            {(isRedisField && redisStatus) ? (
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                {(redisStatus?.valid) ? (
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
          {(isRedisField) && (
            <button
              type="button"
              onClick={() => validateRedis(displayValue)}
              disabled={!displayValue || redisValidating}
              className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium whitespace-nowrap"
            >
              {(redisValidating) ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>Testando...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Testar Conexão</span>
                </>
              )}
            </button>
          )}
        </div>
        {isRedisField && redisStatus && !redisStatus.valid && redisStatus.error && (
          <p className="mt-1 text-xs text-status-error">{redisStatus.error}</p>
        )}
        {isRedisField && redisStatus && redisStatus.valid && (
          <p className="mt-1 text-xs text-status-success">✓ Conexão com Redis válida e funcionando corretamente</p>
        )}
        {hasError && (
          <p className="mt-1 text-xs text-status-error flex items-center gap-1">
            <span>⚠️</span>
            <span>{fieldError}</span>
          </p>
        )}
      </div>
    );
  };

  const isSuperAdmin = agent?.role === 'super_admin';

  const ALL_TABS = {
    frontend:       { id: 'frontend', label: 'Frontend', icon: '🖥️', superAdminOnly: false },
    rag:            { id: 'rag', label: 'RAG', icon: '🔍', superAdminOnly: true },
    billing:        { id: 'billing', label: 'Billing', icon: '💳', superAdminOnly: true },
    whatsapp:       { id: 'whatsapp', label: 'WhatsApp', icon: '💬', superAdminOnly: true },
    email:          { id: 'email', label: 'Email SMTP', icon: '📧', superAdminOnly: true },
    flows:          { id: 'flows', label: 'Fluxos', icon: '🔄', superAdminOnly: false },
    ai:             { id: 'ai', label: 'IA', icon: '🤖', superAdminOnly: true },
    features:       { id: 'features', label: 'Features', icon: '✨', superAdminOnly: false },
    scripts:        { id: 'scripts', label: 'Scripts', icon: '📜', superAdminOnly: false },
    logging:        { id: 'logging', label: 'Logging', icon: '📝', superAdminOnly: false },
    rateLimit:      { id: 'rateLimit', label: 'Rate Limiting', icon: '🚦', superAdminOnly: false },
    fallbacks:      { id: 'fallbacks', label: 'Fallbacks', icon: '🛟', superAdminOnly: false },
    general:        { id: 'general', label: 'Geral', icon: '🌐', superAdminOnly: false },
    webhooks:       { id: 'webhooks', label: 'Webhooks', icon: '🪝', superAdminOnly: true },
  };

  const tabs = Object.values(ALL_TABS).filter(t => !t.superAdminOnly || isSuperAdmin);

  if (loading && !config) {
    return (
      <CrudPageBase title="⚙️ Configuração do Sistema">
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
            <p className="text-text-secondary">Carregando configuração...</p>
          </div>
        </div>
      </CrudPageBase>
    );
  }

  return (
    <CrudPageBase title="⚙️ Configuração do Sistema">
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
      <div className="min-h-0 w-full bg-bg-primary p-4 sm:p-6 overflow-y-auto config-page-scroll">
        <div className="w-full">
        <div className="mb-6">
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
              disabled={(saving || savingTenantAiConfig) || activeTab === 'ai' || (activeTab !== 'ai' && (!hasChanges || hasValidationErrors))} 
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
            {isSuperAdmin && (
            <Button 
              onClick={handleRestart} 
              disabled={loading || saving}
              variant="secondary"
              className="flex items-center gap-2 border-status-warning/50 hover:bg-status-warning/10"
            >
              <span>🔄</span>
              <span>Reiniciar Servidor</span>
            </Button>
            )}
            <div className="ml-auto"></div>
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

        {integrationReadiness && !integrationReadiness.ready && (
          <div className="mb-6 p-4 bg-status-warning/10 border border-status-warning/30 rounded-xl">
            <p className="text-text-primary font-medium mb-2">⚠️ Configuração pendente de integrações</p>
            <p className="text-text-secondary text-sm mb-3">
              O servidor continua em execução, mas alguns providers obrigatórios não estão configurados.
            </p>
            {hasEmailIntegrationGap && (
              <div className="mb-3">
                <Button type="button" variant="secondary" onClick={() => setActiveTab('email')}>
                  Abrir configuração de Email SMTP
                </Button>
              </div>
            )}
            <div className="text-sm text-text-primary space-y-1">
              {integrationReadiness.missing.slice(0, 8).map((item, index) => (
                <div key={`${item?.path || 'unknown'}-${index}`}>
                  • {item?.path || 'campo_desconhecido'}{item?.reason ? ` — ${item.reason}` : ''}
                </div>
              ))}
              {integrationReadiness.missing.length > 8 && (
                <div>• ...e mais {integrationReadiness.missing.length - 8} item(ns)</div>
              )}
            </div>
          </div>
        )}

        {/* Abas de navegação */}
          <div className="mb-6 border-b border-border-default">
            <div className="flex flex-wrap gap-0">
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

        {/* Conteúdo */}
        {editedConfig && (
          <div className="bg-transparent sm:bg-bg-elevated rounded-none sm:rounded-xl border-0 sm:border border-border-default p-0 sm:p-6 shadow-none sm:shadow-lg">
            {/* Aba: API */}
            {activeTab === 'api' && (
              <ConfigApiTab editedConfig={editedConfig} renderField={renderField} />
            )}

            {/* Aba: Frontend */}
            {activeTab === 'frontend' && (
              <ConfigFrontendTab editedConfig={editedConfig} renderField={renderField} />
            )}

            {/* Aba: RAG */}
            {activeTab === 'rag' && (
              <ConfigRagTab editedConfig={editedConfig} renderField={renderField} updateValue={updateValue} />
            )}

            {activeTab === 'billing' && (
              <ConfigBillingTab
                editedConfig={editedConfig}
                renderField={renderField}
                billingValidation={billingValidation}
                validatingBilling={validatingBilling}
                onValidateBilling={handleValidateBilling}
              />
            )}

            {/* Aba: WhatsApp */}
            {activeTab === 'whatsapp' && (
              <ConfigWhatsappTab editedConfig={editedConfig} renderField={renderField} />
            )}

            {activeTab === 'email' && (
              <ConfigEmailTab editedConfig={editedConfig} renderField={renderField} updateValue={updateValue} />
            )}

            {/* Aba: Fluxos */}
            {activeTab === 'flows' && (
              <ConfigFlowsTab editedConfig={editedConfig} renderField={renderField} flows={flows} loadingFlows={loadingFlows} />
            )}

            {/* Aba: IA */}
            {activeTab === 'ai' && (
              <ConfigAiTab
                editedConfig={editedConfig}
                agent={agent}
                targetTenantId={targetTenantId}
                loadingTenantAiConfig={loadingTenantAiConfig}
                tenantAiConfig={tenantAiConfig}
                apiKey={apiKey}
                apiKeyProvider={apiKeyProvider}
                validatingApiKey={validatingApiKey}
                apiKeyValidationStatus={apiKeyValidationStatus}
                savingTenantAiConfig={savingTenantAiConfig}
                savingTenantAiCredentials={savingTenantAiCredentials}
                credentialsValidatedAndSaved={credentialsValidatedAndSaved}
                setTenantAiConfig={setTenantAiConfig}
                setApiKey={setApiKey}
                setApiKeyProvider={setApiKeyProvider}
                setApiKeyValidationStatus={setApiKeyValidationStatus}
                setValidatingApiKey={setValidatingApiKey}
                setSavingTenantAiCredentials={setSavingTenantAiCredentials}
                setCredentialsValidatedAndSaved={setCredentialsValidatedAndSaved}
                showToast={showToast}
              />
            )}

            {/* Aba: Features */}
            {activeTab === 'features' && (
              <ConfigFeaturesTab editedConfig={editedConfig} updateValue={updateValue} />
            )}

            {/* Aba: Scripts */}
            {activeTab === 'scripts' && (
              <ConfigScriptsTab editedConfig={editedConfig} renderField={renderField} updateValue={updateValue} />
            )}

            {/* Aba: Logging */}
            {activeTab === 'logging' && (
              <ConfigLoggingTab editedConfig={editedConfig} renderField={renderField} />
            )}

            {/* Aba: Rate Limiting */}
            {activeTab === 'rateLimit' && (
              <ConfigRateLimitTab editedConfig={editedConfig} renderField={renderField} updateValue={updateValue} />
            )}

            {/* Aba: Fallbacks */}
            {activeTab === 'fallbacks' && (
              <ConfigFallbacksTab
                editedConfig={editedConfig}
                updateValue={updateValue}
                setEditedConfig={setEditedConfig}
              />
            )}

            {/* Aba: Webhooks */}
            {activeTab === 'webhooks' && (
              <ConfigWebhooksTab editedConfig={editedConfig} renderField={renderField} />
            )}

            {/* Aba: Geral */}
            {activeTab === 'general' && (
              <ConfigGeneralTab
                editedConfig={editedConfig}
                renderField={renderField}
                updateValue={updateValue}
                phoneMaskingEnabled={phoneMaskingEnabled}
                loadingPhoneMasking={loadingPhoneMasking}
                savingPhoneMasking={savingPhoneMasking}
                setPhoneMaskingEnabled={setPhoneMaskingEnabled}
                setSavingPhoneMasking={setSavingPhoneMasking}
                showToast={showToast}
                upsertTenantSetting={upsertTenantSetting}
                capabilities={capabilities}
                canManageCapabilities={canManageCapabilities}
                savingCapabilities={savingCapabilities}
                onUpdateCapabilities={handleUpdateCapabilities}
              />
            )}
          </div>
        )}

        <ToastContainer />
        <ConfirmDialog />
        </div>
      </div>
    </CrudPageBase>
  );
}
