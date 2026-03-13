/**
 * Página de Onboarding - Wizard de Configuração Inicial
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useInFlightGuard } from '../hooks/useInFlightGuard';
import * as onboardingApi from '../api/onboarding';
import { Button } from '../styles/Button';
import { useToast } from '../components/Toast';
import logger from '../utils/logger';

export function OnboardingPage() {
  const { agent: currentAgent, isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [onboarding, setOnboarding] = useState(null);
  const [loading, setLoading] = useState(true);
  const [segment, setSegment] = useState('');
  const [cannotStartOnboarding, setCannotStartOnboarding] = useState(false);

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

  useEffect(() => {
    if (isAuthenticated) {
      loadOnboardingStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, canStartOnboarding]);

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
      <div className="support-page">
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
      </div>
    );
  }

  return (
    <div className="support-page">
      <div className="support-header">
        <h1>🚀 Onboarding - Configuração Inicial</h1>
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

      {/* Progresso */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-text-primary">Progresso</span>
            <span className="text-sm font-medium text-text-primary">{onboarding.progress}%</span>
          </div>
          <div className="w-full bg-bg-secondary rounded-full h-4">
            <div
              className="bg-accent-primary h-4 rounded-full transition-all duration-300"
              style={{ width: `${onboarding.progress}%` }}
            ></div>
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
          </select>
          <div className="text-xs text-text-tertiary">
            Afeta quais templates de fluxo serão criados para o seu tenant.
          </div>
        </div>
        <h2 className="text-xl font-semibold mb-4">Checklist de Configuração</h2>
        <div className="space-y-4">
          {onboarding.steps?.map((step) => (
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
                    ) : (
                      <span className="text-2xl">⭕</span>
                    )}
                    <h3 className="text-lg font-medium text-text-primary">
                      {step.label}
                      {step.required && (
                        <span className="ml-2 text-xs text-yellow-500">(Obrigatório)</span>
                      )}
                    </h3>
                  </div>
                  <p className="text-sm text-text-secondary ml-11">{step.description}</p>
                </div>
                {!step.completed && (
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
            </div>
          ))}
        </div>

        {onboarding.completed && (
          <div className="mt-6">
            <Button
              variant="primary"
              onClick={() => navigate('/dashboard')}
            >
              Ir para Dashboard
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
      </div>

      <ToastContainer />
    </div>
  );
}
