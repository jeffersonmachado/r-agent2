/**
 * Modal de seleção de plano para tenants
 */

import React, { useState } from 'react';
import { Button } from '../styles/Button';
import { useAuth } from '../context/authContext';
import { getAgentClassification } from '../utils/classification';

const PLAN_INFO = {
  free: {
    name: 'Free',
    description: 'Plano gratuito com recursos básicos',
    color: 'gray',
    limits: {
      usuarios: 1,
      agentes_ia: 1,
      execucoes_rpa: 10,
      tokens_ia: '10K',
      documentos_rag: 10,
      storage_mb: 100,
    },
  },
  trial: {
    name: 'Trial',
    description: 'Plano de teste por 14 dias',
    color: 'yellow',
    limits: {
      usuarios: 3,
      agentes_ia: 2,
      execucoes_rpa: 50,
      tokens_ia: '50K',
      documentos_rag: 50,
      storage_mb: 500,
    },
  },
  pro: {
    name: 'Pro',
    description: 'Plano profissional para empresas',
    color: 'blue',
    limits: {
      usuarios: 10,
      agentes_ia: 5,
      execucoes_rpa: 500,
      tokens_ia: '500K',
      documentos_rag: 500,
      storage_mb: 5000,
    },
  },
  enterprise: {
    name: 'Enterprise',
    description: 'Plano empresarial com recursos ilimitados',
    color: 'purple',
    limits: {
      usuarios: 'Ilimitado',
      agentes_ia: 'Ilimitado',
      execucoes_rpa: 'Ilimitado',
      tokens_ia: 'Ilimitado',
      documentos_rag: 'Ilimitado',
      storage_mb: 'Ilimitado',
    },
  },
};

export function PlanSelectionModal({ isOpen, onClose, currentPlan, onSelectPlan, tenantName }) {
  const { agent } = useAuth();
  // Limites técnicos de execução automatizada só aparecem para engenharia da plataforma;
  // planos comunicam valor operacional para os demais perfis.
  const isDevelopment = getAgentClassification(agent) === 'DEVELOPMENT';
  const [selectedPlan, setSelectedPlan] = useState(currentPlan || 'trial');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (selectedPlan === currentPlan) {
      onClose();
      return;
    }

    setLoading(true);
    try {
      await onSelectPlan(selectedPlan);
      onClose();
    } catch (err) {
      // Erro será tratado pelo componente pai
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const getColorClasses = (planKey) => {
    const plan = PLAN_INFO[planKey];
    const colorMap = {
      gray: 'bg-text-tertiary/20 text-text-tertiary border-text-tertiary/30',
      yellow: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30',
      blue: 'bg-blue-500/20 text-blue-500 border-blue-500/30',
      purple: 'bg-purple-500/20 text-purple-500 border-purple-500/30',
    };
    return colorMap[plan.color] || colorMap.gray;
  };

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) {
          onClose();
        }
      }}
    >
      <div 
        className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-text-primary">
            {tenantName ? `Alterar Plano - ${tenantName}` : 'Selecionar Plano'}
          </h2>
          {!loading && (
            <button
              onClick={onClose}
              className="text-text-secondary hover:text-text-primary transition-colors"
              aria-label="Fechar"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {currentPlan && (
          <div className="mb-6 p-4 bg-bg-secondary rounded-lg border border-border-default">
            <p className="text-sm text-text-secondary">
              <strong className="text-text-primary">Plano atual:</strong>{' '}
              <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${getColorClasses(currentPlan)}`}>
                {PLAN_INFO[currentPlan]?.name || currentPlan.toUpperCase()}
              </span>
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {Object.entries(PLAN_INFO).map(([planKey, plan]) => {
            const isSelected = selectedPlan === planKey;
            const isCurrent = currentPlan === planKey;
            
            return (
              <div
                key={planKey}
                onClick={() => !loading && setSelectedPlan(planKey)}
                className={`
                  relative p-5 rounded-xl border-2 cursor-pointer transition-all
                  ${isSelected 
                    ? `border-accent-primary bg-accent-primary/10 shadow-lg` 
                    : 'border-border-default hover:border-border-hover bg-bg-secondary'
                  }
                  ${isCurrent ? 'ring-2 ring-accent-primary/50' : ''}
                  ${loading ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                {isCurrent && (
                  <div className="absolute top-2 right-2">
                    <span className="px-2 py-1 bg-accent-primary text-white text-xs font-medium rounded">
                      Atual
                    </span>
                  </div>
                )}
                
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className={`text-xl font-bold mb-1 ${isSelected ? 'text-accent-primary' : 'text-text-primary'}`}>
                      {plan.name}
                    </h3>
                    <p className="text-sm text-text-secondary">{plan.description}</p>
                  </div>
                  <div className={`
                    w-5 h-5 rounded-full border-2 flex items-center justify-center
                    ${isSelected 
                      ? 'border-accent-primary bg-accent-primary' 
                      : 'border-border-default'
                    }
                  `}>
                    {isSelected && (
                      <div className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </div>
                </div>

                <div className="space-y-2 mt-4 pt-4 border-t border-border-default">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-text-secondary">Usuários:</span>
                      <span className="ml-2 font-medium text-text-primary">{plan.limits.usuarios}</span>
                    </div>
                    <div>
                      <span className="text-text-secondary">Agentes IA:</span>
                      <span className="ml-2 font-medium text-text-primary">{plan.limits.agentes_ia}</span>
                    </div>
                    {isDevelopment ? (
                      <div>
                        <span className="text-text-secondary">Exec. RPA:</span>
                        <span className="ml-2 font-medium text-text-primary">{plan.limits.execucoes_rpa}</span>
                      </div>
                    ) : null}
                    <div>
                      <span className="text-text-secondary">Tokens IA:</span>
                      <span className="ml-2 font-medium text-text-primary">{plan.limits.tokens_ia}</span>
                    </div>
                    <div>
                      <span className="text-text-secondary">Docs RAG:</span>
                      <span className="ml-2 font-medium text-text-primary">{plan.limits.documentos_rag}</span>
                    </div>
                    <div>
                      <span className="text-text-secondary">Storage:</span>
                      <span className="ml-2 font-medium text-text-primary">
                        {typeof plan.limits.storage_mb === 'number' 
                          ? `${plan.limits.storage_mb} MB` 
                          : plan.limits.storage_mb
                        }
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-3 pt-4 border-t border-border-default">
          <Button 
            type="button" 
            variant="primary" 
            className="flex-1"
            onClick={handleConfirm}
            disabled={loading || selectedPlan === currentPlan}
          >
            {loading ? 'Alterando...' : selectedPlan === currentPlan ? 'Plano já selecionado' : 'Confirmar Alteração'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}
