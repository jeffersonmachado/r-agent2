/**
 * Componente de Resolução de Dependências RPA
 * 
 * Exibe dependências detectadas, dependências já existentes,
 * e seeds que serão executados automaticamente.
 * Permite confirmação antes da execução.
 */

import React, { useState, useEffect } from 'react';
import { useToast } from './Toast';
import { Button } from '../styles/Button';
import logger from '../utils/logger';

/**
 * Componente para exibir e gerenciar resolução de dependências RPA
 * 
 * @param {Object} props
 * @param {string} props.flowId - ID do fluxo
 * @param {Function} props.onConfirm - Callback quando usuário confirma
 * @param {Function} props.onCancel - Callback quando usuário cancela
 * @param {boolean} props.autoExecuteSeeds - Se deve executar seeds automaticamente
 */
export function RpaDependencyResolver({ flowId, onConfirm, onCancel, autoExecuteSeeds = false }) {
  const { showToast, ToastContainer } = useToast();
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [dependencyResolution, setDependencyResolution] = useState(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (flowId) {
      loadDependencyResolution();
    }
  }, [flowId]);

  const loadDependencyResolution = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/flows/${flowId}/resolve-dependencies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        },
      });

      if (!response.ok) {
        throw new Error('Erro ao carregar resolução de dependências');
      }

      const data = await response.json();
      setDependencyResolution(data);

      // Carrega preview se houver dependências
      if (!data.allSatisfied) {
        await loadPreview();
      }
    } catch (error) {
      logger.error('Erro ao carregar resolução de dependências:', error);
      showToast('Erro ao carregar dependências', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadPreview = async () => {
    try {
      const response = await fetch(`/api/flows/${flowId}/preview-rpa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setPreview(data);
      }
    } catch (error) {
      logger.error('Erro ao carregar preview:', error);
    }
  };

  const handleConfirm = async () => {
    setResolving(true);
    try {
      const response = await fetch(`/api/flows/${flowId}/generate-rpa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        },
        body: JSON.stringify({
          autoExecuteSeeds,
          saveRecording: true,
        }),
      });

      const result = await response.json();

      if (result.success) {
        showToast('Gravação RPA criada com sucesso!', 'success');
        if (onConfirm) {
          onConfirm(result);
        }
      } else {
        showToast(`Erro: ${result.errors?.join(', ') || 'Erro ao gerar gravação RPA'}`, 'error');
      }
    } catch (error) {
      logger.error('Erro ao gerar gravação RPA:', error);
      showToast('Erro ao gerar gravação RPA', 'error');
    } finally {
      setResolving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-5 text-center">
        <p>Analisando dependências...</p>
      </div>
    );
  }

  if (!dependencyResolution) {
    return (
      <div className="p-5">
        <p>Nenhuma informação de dependências disponível.</p>
      </div>
    );
  }

  const { dependencies, missingDependencies, requiredSeeds, allSatisfied } = dependencyResolution;

  return (
    <div className="p-5 max-w-[800px] mx-auto">
      <h2 style={{ marginBottom: '20px' }}>Resolução de Dependências RPA</h2>

      {/* Status Geral */}
      <div className={`mb-5 rounded-lg border p-4 ${allSatisfied ? 'bg-status-success/10 border-status-success/30' : 'bg-status-warning/10 border-status-warning/30'}`}>
        <strong>
          {allSatisfied ? '✓ Todas as dependências estão satisfeitas' : '⚠ Existem dependências faltantes'}
        </strong>
        <div style={{ marginTop: '10px', fontSize: '14px' }}>
          Total: {dependencies.length} | 
          Satisfeitas: {dependencies.length - missingDependencies.length} | 
          Faltantes: {missingDependencies.length}
        </div>
      </div>

      {/* Dependências */}
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ marginBottom: '10px' }}>Dependências Detectadas</h3>
        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
          {dependencies.map((dep, index) => (
            <div
              key={index}
              className={`mb-2 flex items-center gap-2.5 rounded border p-2.5 ${dep.exists ? 'bg-bg-secondary border-border-default' : 'bg-status-warning/10 border-status-warning/30'}`}
            >
              <span style={{ fontSize: '18px' }}>
                {dep.exists ? '✓' : '✖'}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold' }}>
                  {dep.type}: {dep.identifier}
                </div>
                {dep.metadata?.nodeId && (
                  <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                    Nó: {dep.metadata.nodeId} ({dep.metadata.nodeType})
                  </div>
                )}
                {!dep.exists && dep.rpaSeedName && (
                  <div style={{ fontSize: '12px', color: 'var(--color-status-warning)', marginTop: '4px' }}>
                    → Será criado via: {dep.rpaSeedName}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Seeds Necessários */}
      {requiredSeeds.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ marginBottom: '10px' }}>Seeds RPA Necessários</h3>
          <ul style={{ paddingLeft: '20px' }}>
            {requiredSeeds.map((seed, index) => (
              <li key={index} style={{ marginBottom: '5px' }}>
                {seed}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Preview da Gravação */}
      {preview && preview.recordingPreview && (
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ marginBottom: '10px' }}>Preview da Gravação RPA</h3>
          <div style={{
            padding: '15px',
            backgroundColor: 'var(--color-bg-secondary)',
            borderRadius: '4px',
            border: '1px solid var(--color-border-default)',
          }}>
            <div><strong>Nome:</strong> {preview.recordingPreview.name}</div>
            <div><strong>Total de passos:</strong> {preview.recordingPreview.stepsCount}</div>
            {preview.recordingPreview.steps.length > 0 && (
              <div style={{ marginTop: '10px' }}>
                <strong>Primeiros passos:</strong>
                <ul style={{ paddingLeft: '20px', marginTop: '5px' }}>
                  {preview.recordingPreview.steps.slice(0, 5).map((step, index) => (
                    <li key={index} className="text-xs">
                      {step.description || step.type}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Ações */}
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <Button
          onClick={onCancel || (() => {})}
          variant="secondary"
          disabled={resolving}
        >
          Cancelar
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={resolving || (!allSatisfied && !autoExecuteSeeds)}
        >
          {resolving ? 'Processando...' : 'Gerar Gravação RPA'}
        </Button>
      </div>

      {!allSatisfied && !autoExecuteSeeds && (
        <div style={{
          marginTop: '10px',
          padding: '10px',
          backgroundColor: 'var(--qa-warning-muted)',
          borderRadius: '4px',
          fontSize: '14px',
        }}>
          ⚠ Para gerar a gravação, é necessário executar os seeds faltantes.
          Ative "autoExecuteSeeds" ou execute os seeds manualmente.
        </div>
      )}

      <ToastContainer />
    </div>
  );
}

export default RpaDependencyResolver;

