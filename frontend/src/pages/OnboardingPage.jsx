/**
 * Página de Onboarding - Wizard de Configuração Inicial
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useInFlightGuard } from '../hooks/useInFlightGuard';
import * as onboardingApi from '../api/onboarding';
import { getConfig, getIntegrationConfigReadiness, updateConfig } from '../api/config';
import { Button } from '../styles/Button';
import { useToast } from '../components/Toast';
import logger from '../utils/logger';
import { CrudPageBase } from '../modules/crud-base';

function readSearchParam(name) {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(name);
}

// Verticais canônicas (ids de config/verticals.json, kind=vertical).
const ONBOARDING_VERTICAL_OPTIONS = [
  { id: 'beauty', label: 'Beleza e Estética' },
  { id: 'fitness', label: 'Academia e Fitness' },
  { id: 'bakery', label: 'Padaria' },
  { id: 'food', label: 'Alimentação/Restaurante' },
  { id: 'services', label: 'Serviços' },
  { id: 'clinic', label: 'Clínica e Saúde' },
  { id: 'market', label: 'Varejo/Mercado' },
];

// Vertical canônica → segmento do plano de templates iniciais
// (espelha VERTICAL_TO_TEMPLATE_SEGMENT em api/services/onboardingService.js).
const VERTICAL_TO_TEMPLATE_SEGMENT = {
  beauty: 'servicos',
  fitness: 'academia',
  bakery: 'padaria',
  food: 'varejo',
  services: 'servicos',
  clinic: 'saude',
  market: 'varejo',
};

function updateNestedConfigValue(baseConfig, configPath, nextValue) {
  const nextConfig = JSON.parse(JSON.stringify(baseConfig || {}));
  const keys = String(configPath || '').split('.').filter(Boolean);
  let current = nextConfig;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!current[key] || typeof current[key] !== 'object' || Array.isArray(current[key])) {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = nextValue;
  return nextConfig;
}

export function OnboardingPage() {
  const { agent: currentAgent, isAuthenticated, loading: authLoading, capabilities, updateCapabilities } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [onboarding, setOnboarding] = useState(null);
  // Step inicial: modo de atendimento (caixa única vs. chamados).
  const [attendanceMode, setAttendanceMode] = useState(null);
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [segment, setSegment] = useState('');
  const [vertical, setVertical] = useState('');
  const [verticalSaving, setVerticalSaving] = useState(false);
  const [cannotStartOnboarding, setCannotStartOnboarding] = useState(false);
  const [requiredStep, setRequiredStep] = useState(() => readSearchParam('required') || '');
  const [integrationReadiness, setIntegrationReadiness] = useState(null);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpConfig, setSmtpConfig] = useState({
    enabled: false,
    host: '',
    port: '587',
    secure: false,
    username: '',
    password: '',
    fromAddress: '',
    fromName: '',
  });

  // Evita duplicação de chamadas em dev (React StrictMode) e/ou re-renders.
  const onboardingLoadGuard = useInFlightGuard();
  const startAttemptedRef = useRef(false);

  const canStartOnboarding = useMemo(() => {
    const role = currentAgent?.role;
    return role === 'owner' || role === 'admin' || role === 'super_admin';
  }, [currentAgent?.role]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  // Reflete a capability atual do tenant na escolha inicial (fonte: servidor)
  useEffect(() => {
    if (attendanceMode === null && capabilities) {
      setAttendanceMode(capabilities.caseManagement === false ? 'simple' : 'cases');
    }
  }, [capabilities, attendanceMode]);

  const handleSelectAttendanceMode = async (mode) => {
    setAttendanceMode(mode);
    setAttendanceSaving(true);
    try {
      await updateCapabilities({ caseManagement: mode === 'cases' });
    } catch (err) {
      // 403: usuário sem papel admin/owner — segue com o default sem bloquear.
      if (err?.status === 403) {
        logger.warn('Sem permissão para salvar modo de atendimento; seguindo com default', err);
      } else {
        logger.error('Erro ao salvar modo de atendimento', err);
        showToast('Não foi possível salvar o modo de atendimento agora', 'error');
      }
    } finally {
      setAttendanceSaving(false);
    }
  };

  const handleSelectVertical = async (nextVertical) => {
    setVertical(nextVertical);
    // A vertical também alimenta o plano de templates iniciais (default por vertical).
    setSegment(VERTICAL_TO_TEMPLATE_SEGMENT[nextVertical] || '');
    setVerticalSaving(true);
    try {
      await onboardingApi.setTenantVertical(nextVertical || null);
    } catch (err) {
      // 403: usuário sem papel admin/owner — segue sem bloquear.
      if (err?.status === 403) {
        logger.warn('Sem permissão para salvar a vertical do tenant; seguindo sem persistir', err);
      } else {
        logger.error('Erro ao salvar vertical do tenant', err);
        showToast('Não foi possível salvar o segmento da empresa agora', 'error');
      }
    } finally {
      setVerticalSaving(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadOnboardingStatus();
      if (requiredStep === 'integrations') {
        loadIntegrationConfig();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, canStartOnboarding, requiredStep]);

  useEffect(() => {
    const onPopState = () => setRequiredStep(readSearchParam('required') || '');
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', onPopState);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('popstate', onPopState);
      }
    };
  }, []);

  const loadIntegrationConfig = async () => {
    try {
      const [config, readiness] = await Promise.all([
        getConfig(),
        getIntegrationConfigReadiness(),
      ]);
      setIntegrationReadiness(readiness);
      setSmtpConfig({
        enabled: config?.notifications?.email?.enabled === true,
        host: String(config?.notifications?.email?.smtp?.host || ''),
        port: String(config?.notifications?.email?.smtp?.port || '587'),
        secure: config?.notifications?.email?.smtp?.secure === true,
        username: String(config?.notifications?.email?.smtp?.username || ''),
        password: String(config?.notifications?.email?.smtp?.password || ''),
        fromAddress: String(config?.notifications?.email?.fromAddress || ''),
        fromName: String(config?.notifications?.email?.fromName || ''),
      });
    } catch (err) {
      logger.error('Erro ao carregar configuração SMTP no onboarding', err);
      showToast('Erro ao carregar configuração SMTP', 'error');
    }
  };

  const handleSmtpFieldChange = (field, value) => {
    setSmtpConfig((current) => ({ ...current, [field]: value }));
  };

  const handleSaveSmtpConfig = async () => {
    setSmtpSaving(true);
    try {
      let config = await getConfig();
      config = updateNestedConfigValue(config, 'notifications.email.enabled', smtpConfig.enabled === true);
      config = updateNestedConfigValue(config, 'notifications.email.smtp.host', smtpConfig.host.trim());
      config = updateNestedConfigValue(config, 'notifications.email.smtp.port', Number(smtpConfig.port || 587));
      config = updateNestedConfigValue(config, 'notifications.email.smtp.secure', smtpConfig.secure === true);
      config = updateNestedConfigValue(config, 'notifications.email.smtp.username', smtpConfig.username.trim());
      config = updateNestedConfigValue(config, 'notifications.email.smtp.password', smtpConfig.password);
      config = updateNestedConfigValue(config, 'notifications.email.fromAddress', smtpConfig.fromAddress.trim());
      config = updateNestedConfigValue(config, 'notifications.email.fromName', smtpConfig.fromName.trim());
      await updateConfig(config);
      const readiness = await getIntegrationConfigReadiness();
      setIntegrationReadiness(readiness);
      showToast('Configuração SMTP salva com sucesso!', 'success');
    } catch (err) {
      logger.error('Erro ao salvar configuração SMTP no onboarding', err);
      showToast(err?.body?.message || 'Erro ao salvar configuração SMTP', 'error');
    } finally {
      setSmtpSaving(false);
    }
  };

  const loadOnboardingStatus = async () => {
    if (!onboardingLoadGuard.start()) return;
    try {
      setLoading(true);
      setCannotStartOnboarding(false);
      const result = await onboardingApi.getOnboardingStatus();
      setOnboarding(result.onboarding);
      
      // Se onboarding não foi iniciado, inicia automaticamente
      if (!result.onboarding?.startedAt) {
        if (!canStartOnboarding) {
          setCannotStartOnboarding(true);
          return;
        }

        // Garante no máximo 1 tentativa de start por montagem.
        if (!startAttemptedRef.current) {
          startAttemptedRef.current = true;
          try {
            await onboardingApi.startOnboarding();
          } catch (err) {
            // Caso o backend negue por RBAC, tratar como estado esperado.
            if (err?.status === 403) {
              setCannotStartOnboarding(true);
              return;
            }
            throw err;
          }
        }

        // Recarrega status após iniciar (fluxo linear, sem recursão).
        const statusAfterStart = await onboardingApi.getOnboardingStatus();
        setOnboarding(statusAfterStart.onboarding);
      }
    } catch (err) {
      logger.error('Erro ao carregar status de onboarding', err);
      // Se for 403 na tentativa de start (ou RBAC), não é erro fatal para o usuário.
      if (err?.status !== 403) {
        showToast('Erro ao carregar onboarding', 'error');
      }
    } finally {
      setLoading(false);
      onboardingLoadGuard.end();
    }
  };

  const handleCompleteStep = async (stepId) => {
    try {
      await onboardingApi.completeOnboardingStep(stepId);
      showToast('Step completado!', 'success');
      await loadOnboardingStatus();
    } catch (err) {
      showToast(err.body?.message || 'Erro ao completar step', 'error');
    }
  };

  const handleCompleteOnboarding = async () => {
    try {
      await onboardingApi.completeOnboarding();
      showToast('Onboarding finalizado!', 'success');
      await loadOnboardingStatus();
    } catch (err) {
      showToast(err.body?.message || 'Erro ao finalizar onboarding', 'error');
    }
  };

  const handleCreateTemplates = async () => {
    try {
      await onboardingApi.createInitialTemplates(segment ? { segment } : undefined);
      showToast('Templates criados com sucesso!', 'success');
      await handleCompleteStep('index_documents');
    } catch (err) {
      showToast(err.body?.message || 'Erro ao criar templates', 'error');
    }
  };

  // Renderiza um step da checklist
  const renderStep = (step) => (
    <div
      key={step.id}
      className={`p-4 rounded-lg border ${
        step.completed
          ? 'bg-green-500/10 border-green-500/30'
          : step.required
          ? 'bg-yellow-500/10 border-yellow-500/30'
          : 'bg-bg-secondary border-border-default'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            {step.completed ? (
              <span className="text-2xl">✅</span>
            ) : step.autoDetect ? (
              <span className="text-2xl">🔍</span>
            ) : (
              <span className="text-2xl">⭕</span>
            )}
            <h3 className="text-lg font-medium text-text-primary">
              {step.label}
              {step.required && (
                <span className="ml-2 text-xs text-red-500">(Obrigatório)</span>
              )}
            </h3>
          </div>
          <p className="text-sm text-text-secondary ml-11">{step.description}</p>
        </div>
        {!step.completed && (
          <div className="flex items-center gap-2">
            {step.autoDetect && (
              <span className="text-xs text-text-tertiary px-2 py-1 rounded bg-bg-tertiary">
                🔍 Auto-detect
              </span>
            )}
            {step.id === 'connect_channel' ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => navigate('/whatsapp-connections')}
              >
                Conectar canal
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  if (step.id === 'create_first_queue' || step.id === 'index_documents') {
                    handleCreateTemplates();
                  } else {
                    handleCompleteStep(step.id);
                  }
                }}
              >
                Completar
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
          <p className="text-text-secondary">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (!onboarding) {
    return (
      <CrudPageBase>
        <div className="support-header">
          <h1>🚀 Onboarding</h1>
        
        <div className="support-controls">
          <button
            type="button"
            className="btn-default px-4 py-2 text-sm"
            onClick={() => window.location.reload()}
          >
            🔄 Atualizar
          </button>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <p className="text-sm text-text-secondary">Sem filtros específicos para esta tela.</p>
      </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 text-center">
          <p className="text-text-secondary">Carregando onboarding...</p>
        </div>
      </CrudPageBase>
    );
  }

  const hasBlockingSteps = onboarding?.steps?.filter(s => s.required && !s.completed).length > 0;

  // Corpo do onboarding (reutilizado nos dois modos: overlay e normal)
  const body = (
    <>
      <div className="support-header">
        <h1>🚀 Onboarding - Configuração Inicial</h1>
      </div>

      {/* Step inicial: modo de atendimento */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
        <h2 className="text-xl font-semibold text-text-primary mb-1">Como sua empresa atende seus clientes?</h2>
        <p className="text-sm text-text-secondary mb-4">
          Essa escolha define se a operação usa apenas a caixa de entrada ou também chamados com acompanhamento.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" role="group" aria-label="Modo de atendimento">
          <button
            type="button"
            disabled={attendanceSaving}
            onClick={() => handleSelectAttendanceMode('simple')}
            className={`text-left p-5 rounded-xl border-2 transition-all ${
              attendanceMode === 'simple'
                ? 'border-accent-primary bg-accent-primary/10'
                : 'border-border-default bg-bg-secondary hover:border-border-hover'
            }`}
          >
            <h3 className="text-lg font-semibold text-text-primary mb-1">Atendimento simples</h3>
            <p className="text-sm text-text-secondary">
              Receber e responder mensagens, ligações e contatos em uma caixa de entrada única.
            </p>
          </button>
          <button
            type="button"
            disabled={attendanceSaving}
            onClick={() => handleSelectAttendanceMode('cases')}
            className={`text-left p-5 rounded-xl border-2 transition-all ${
              attendanceMode === 'cases'
                ? 'border-accent-primary bg-accent-primary/10'
                : 'border-border-default bg-bg-secondary hover:border-border-hover'
            }`}
          >
            <h3 className="text-lg font-semibold text-text-primary mb-1">Atendimento com chamados</h3>
            <p className="text-sm text-text-secondary">
              Acompanhar solicitações até a resolução, com responsável, status, prioridade e SLA.
            </p>
          </button>
        </div>
      </div>

      {/* Step: segmento/vertical da empresa */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
        <h2 className="text-xl font-semibold text-text-primary mb-1">Qual é o segmento da sua empresa?</h2>
        <p className="text-sm text-text-secondary mb-4">
          Essa escolha ativa os painéis e templates do seu segmento (ex.: agenda para Beleza, presença para Fitness).
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={vertical}
            onChange={(e) => handleSelectVertical(e.target.value)}
            disabled={verticalSaving}
            className="px-3 py-2 text-sm bg-bg-tertiary border border-border-default rounded-md text-text-secondary"
            aria-label="Selecionar segmento da empresa"
          >
            <option value="">Selecione o segmento...</option>
            {ONBOARDING_VERTICAL_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
          {verticalSaving && (
            <span className="text-xs text-text-tertiary">Salvando...</span>
          )}
        </div>
      </div>

      {cannotStartOnboarding && !onboarding?.startedAt && (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
          <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <p className="text-sm text-text-secondary">
              Este tenant ainda não iniciou o onboarding. Somente <strong>owner</strong>, <strong>admin</strong> ou{' '}
              <strong>super_admin</strong> podem iniciar.
            </p>
          </div>
        </div>
      )}

      {requiredStep === 'integrations' && (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Integrações obrigatórias</h2>
              <p className="text-sm text-text-secondary mt-1">
                Configure o SMTP do tenant aqui no onboarding e também pela tela de configurações quando precisar revisar o provider.
              </p>
            </div>
            <Button variant="secondary" onClick={() => navigate('/config?tab=email')}>
              Abrir tela de configurações
            </Button>
          </div>

          {integrationReadiness && !integrationReadiness.ready && (
            <div className="mb-4 p-4 bg-status-warning/10 border border-status-warning/30 rounded-lg text-sm text-text-primary space-y-1">
              <div className="font-medium">Pendências detectadas</div>
              {(integrationReadiness.missing || []).slice(0, 6).map((item, index) => (
                <div key={`${item?.path || 'unknown'}-${index}`}>
                  • {item?.path || 'campo_desconhecido'}{item?.reason ? ` — ${item.reason}` : ''}
                </div>
              ))}
            </div>
          )}

          {integrationReadiness?.ready && (
            <div className="mb-4 p-4 bg-green-500/10 border border-green-500/30 rounded-lg text-sm text-green-600">
              SMTP e integrações obrigatórias estão configurados.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2 flex items-center gap-3">
              <input id="smtp-enabled" type="checkbox" checked={smtpConfig.enabled} onChange={(e) => handleSmtpFieldChange('enabled', e.target.checked)} />
              <label htmlFor="smtp-enabled" className="text-sm font-medium text-text-primary">Habilitar Email transacional</label>
            </div>
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">Host SMTP</label>
              <input className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary" value={smtpConfig.host} onChange={(e) => handleSmtpFieldChange('host', e.target.value)} placeholder="smtp.exemplo.com" />
            </div>
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">Porta SMTP</label>
              <input className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary" value={smtpConfig.port} onChange={(e) => handleSmtpFieldChange('port', e.target.value)} placeholder="587" />
            </div>
            <div className="md:col-span-2 flex items-center gap-3">
              <input id="smtp-secure" type="checkbox" checked={smtpConfig.secure} onChange={(e) => handleSmtpFieldChange('secure', e.target.checked)} />
              <label htmlFor="smtp-secure" className="text-sm font-medium text-text-primary">Usar conexão segura (SMTPS/TLS)</label>
            </div>
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">Usuário SMTP</label>
              <input className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary" value={smtpConfig.username} onChange={(e) => handleSmtpFieldChange('username', e.target.value)} placeholder="usuario" />
            </div>
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">Senha SMTP</label>
              <input type="password" className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary" value={smtpConfig.password} onChange={(e) => handleSmtpFieldChange('password', e.target.value)} placeholder="••••••••" />
            </div>
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">Email remetente</label>
              <input type="email" className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary" value={smtpConfig.fromAddress} onChange={(e) => handleSmtpFieldChange('fromAddress', e.target.value)} placeholder="no-reply@exemplo.com" />
            </div>
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">Nome do remetente</label>
              <input className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary" value={smtpConfig.fromName} onChange={(e) => handleSmtpFieldChange('fromName', e.target.value)} placeholder="Operações" />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="primary" onClick={handleSaveSmtpConfig} disabled={smtpSaving}>
              {smtpSaving ? 'Salvando SMTP...' : 'Salvar SMTP'}
            </Button>
            <Button variant="secondary" onClick={loadIntegrationConfig}>
              Revalidar integrações
            </Button>
          </div>
        </div>
      )}

      {/* Progresso */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-text-primary">Progresso geral</span>
            <span className="text-sm font-medium text-text-primary">{onboarding.progress}%</span>
          </div>
          {/* Barra segmentada: obrigatórios + outros */}
          <div className="w-full bg-bg-secondary rounded-full h-6 overflow-hidden flex">
            {(() => {
              const requiredSteps = onboarding.steps?.filter(s => s.required) || [];
              const otherSteps = onboarding.steps?.filter(s => !s.required) || [];
              const totalSteps = onboarding.steps?.length || 1;
              const reqDone = requiredSteps.filter(s => s.completed).length;
              const reqTotal = requiredSteps.length || 0;
              const otherDone = otherSteps.filter(s => s.completed).length;
              const otherTotal = otherSteps.length || 0;
              const reqPct = (reqDone / totalSteps) * 100;
              const otherPct = (otherDone / totalSteps) * 100;
              return (
                <>
                  {reqTotal > 0 && (
                    <div
                      className="h-full transition-all duration-300 flex items-center justify-center text-xs font-bold text-white"
                      style={{
                        width: `${reqPct}%`,
                        background: reqDone === reqTotal
                          ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                          : 'linear-gradient(90deg, #ef4444, #dc2626)',
                      }}
                      title={`${reqDone}/${reqTotal} obrigatórios`}
                    >
                      {reqPct > 8 ? `${reqDone}/${reqTotal}` : ''}
                    </div>
                  )}
                  {otherTotal > 0 && (
                    <div
                      className="h-full transition-all duration-300 flex items-center justify-center text-xs font-bold text-white"
                      style={{
                        width: `${otherPct}%`,
                        background: 'linear-gradient(90deg, #6366f1, #4f46e5)',
                      }}
                      title={`${otherDone}/${otherTotal} outros`}
                    >
                      {otherPct > 8 ? `${otherDone}/${otherTotal}` : ''}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
          {/* Legenda */}
          <div className="flex gap-4 mt-2 text-xs text-text-secondary">
            {(() => {
              const requiredSteps = onboarding.steps?.filter(s => s.required) || [];
              const reqDone = requiredSteps.filter(s => s.completed).length;
              const reqTotal = requiredSteps.length;
              if (reqTotal === 0) return null;
              return (
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-sm inline-block" style={{
                    background: reqDone === reqTotal
                      ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                      : 'linear-gradient(90deg, #ef4444, #dc2626)',
                  }}></span>
                  🔴 Obrigatórios: {reqDone}/{reqTotal}
                  {reqDone === reqTotal && ' ✅'}
                  {reqDone < reqTotal && ' — bloqueia acesso'}
                </span>
              );
            })()}
            {(() => {
              const otherSteps = onboarding.steps?.filter(s => !s.required) || [];
              const otherDone = otherSteps.filter(s => s.completed).length;
              const otherTotal = otherSteps.length;
              if (otherTotal === 0) return null;
              return (
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'linear-gradient(90deg, #6366f1, #4f46e5)' }}></span>
                  Outros: {otherDone}/{otherTotal}
                </span>
              );
            })()}
          </div>
        </div>
        {onboarding.completed && (
          <div className="mt-4 p-4 bg-green-500/20 border border-green-500/30 rounded-lg">
            <p className="text-green-500 font-medium">✅ Onboarding completo!</p>
          </div>
        )}
      </div>

      {/* Checklist */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6">
        <div className="mb-6 flex items-center gap-3 flex-wrap">
          <div className="text-sm text-text-secondary">
            Segmento (opcional):
          </div>
          <select
            value={segment}
            onChange={(e) => setSegment(e.target.value)}
            className="px-3 py-2 text-sm bg-bg-tertiary border border-border-default rounded-md text-text-secondary"
            aria-label="Selecionar segmento para templates iniciais"
          >
            <option value="">Automático (geral)</option>
            <option value="ecommerce">E-commerce</option>
            <option value="varejo">Varejo</option>
            <option value="servicos">Serviços</option>
            <option value="saude">Saúde</option>
            <option value="educacao">Educação</option>
            <option value="financeiro">Financeiro</option>
            <option value="cobranca">Cobrança</option>
            <option value="academia">Academia</option>
            <option value="padaria">Padaria</option>
          </select>
          <div className="text-xs text-text-tertiary">
            Afeta quais templates de fluxo serão criados para o seu tenant.
          </div>
        </div>
        <h2 className="text-xl font-semibold mb-4">Checklist de Configuração</h2>

        {/* 🔴 Obrigatório */}
        {onboarding.steps?.filter(s => s.category === 'required').length > 0 && (
          <>
            <h3 className="text-lg font-medium text-status-error mb-3 mt-6 flex items-center gap-2">
              <span>🔴</span> Obrigatório — bloqueia o acesso se não completo
            </h3>
            <div className="space-y-4 mb-6">
              {onboarding.steps?.filter(s => s.category === 'required').map(renderStep)}
            </div>
          </>
        )}

        {/* 🟡 Recomendado */}
        {onboarding.steps?.filter(s => s.category === 'recommended').length > 0 && (
          <>
            <h3 className="text-lg font-medium text-status-warning mb-3 mt-6 flex items-center gap-2">
              <span>🟡</span> Recomendado
            </h3>
            <div className="space-y-4 mb-6">
              {onboarding.steps?.filter(s => s.category === 'recommended').map(renderStep)}
            </div>
          </>
        )}

        {/* ⚪ Opcional */}
        {onboarding.steps?.filter(s => s.category === 'optional').length > 0 && (
          <>
            <h3 className="text-lg font-medium text-text-secondary mb-3 mt-6 flex items-center gap-2">
              <span>⚪</span> Opcional
            </h3>
            <div className="space-y-4">
              {onboarding.steps?.filter(s => s.category === 'optional').map(renderStep)}
            </div>
          </>
        )}

        {onboarding.steps?.filter(s => s.category === 'required' && !s.completed).length === 0 && (
          <div className="mt-4 p-4 bg-green-500/20 border border-green-500/30 rounded-lg">
            <p className="text-green-500 font-medium">✅ Todos os itens obrigatórios estão completos!</p>
          </div>
        )}
      </div>

        {onboarding.completed && (
          <div className="mt-6">
            <Button
              variant="primary"
              onClick={() => navigate('/workspace')}
            >
              Ir para o Workspace
            </Button>
          </div>
        )}

        {!onboarding.completed && onboarding.currentStep && (
          <div className="mt-6">
            <Button
              variant="primary"
              onClick={handleCompleteOnboarding}
              disabled={onboarding.steps?.filter(s => s.required && !s.completed).length > 0}
            >
              Finalizar Onboarding
            </Button>
          </div>
        )}

      <ToastContainer />
    </>
  );

  // Overlay full-screen quando há steps obrigatórios pendentes
  if (hasBlockingSteps) {
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 9999, background: 'var(--bg-primary, #0f1117)', overflow: 'auto',
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '40px 24px' }}>
          {body}
        </div>
      </div>
    );
  }

  return (
    <CrudPageBase>
      {body}
    </CrudPageBase>
  );
}
