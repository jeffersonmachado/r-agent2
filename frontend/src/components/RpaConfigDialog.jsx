import React, { useState, useEffect } from 'react';
import { Dialog } from './Dialog';
import { Button } from '../styles/Button';

/**
 * Diálogo de configuração do RPA.
 * Permite configurar velocidade e outras opções antes de executar testes RPA.
 */
export function RpaConfigDialog({ isOpen, onClose, onConfirm, defaultConfig = {} }) {
  const [config, setConfig] = useState({
    slowMo: defaultConfig.slowMo ?? 500,
    headless: false, // SEMPRE false - navegador sempre visível
    timeout: defaultConfig.timeout ?? 30000,
    screenshotOnFailure: defaultConfig.screenshotOnFailure ?? true,
    maxRetries: defaultConfig.maxRetries ?? 3,
    retryDelay: defaultConfig.retryDelay ?? 1000,
    devtools: defaultConfig.devtools ?? true,
    stepByStep: defaultConfig.stepByStep ?? true,
  });

  const handleChange = (key, value) => {
    setConfig(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm(config);
    }
    if (onClose) {
      onClose();
    }
  };

  const handleCancel = () => {
    // Restaura valores padrão
    setConfig({
      slowMo: defaultConfig.slowMo ?? 500,
      headless: false, // SEMPRE false
      timeout: defaultConfig.timeout ?? 30000,
      screenshotOnFailure: defaultConfig.screenshotOnFailure ?? true,
      maxRetries: defaultConfig.maxRetries ?? 3,
      retryDelay: defaultConfig.retryDelay ?? 1000,
      devtools: defaultConfig.devtools ?? true,
      stepByStep: defaultConfig.stepByStep ?? true,
    });
    if (onClose) {
      onClose();
    }
  };

  // Atualiza config quando defaultConfig muda
  useEffect(() => {
    if (isOpen) {
      setConfig({
        slowMo: defaultConfig.slowMo ?? 500,
        headless: false, // SEMPRE false - navegador sempre visível
        timeout: defaultConfig.timeout ?? 30000,
        screenshotOnFailure: defaultConfig.screenshotOnFailure ?? true,
        maxRetries: defaultConfig.maxRetries ?? 3,
        retryDelay: defaultConfig.retryDelay ?? 1000,
        devtools: defaultConfig.devtools ?? true,
        stepByStep: defaultConfig.stepByStep ?? true,
      });
    }
  }, [isOpen, defaultConfig]);

  // Debug
  useEffect(() => {
    console.log('🔧 RpaConfigDialog - isOpen mudou para:', isOpen);
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <Dialog 
      isOpen={isOpen} 
      onClose={handleCancel} 
      title="⚙️ Configuração do RPA" 
      size="lg"
      draggable={true}
      resizable={true}
    >
      <div className="space-y-6">
        {/* Botões de Ação */}
        <div className="flex justify-end gap-3 pb-4 border-b border-border-default">
          <Button variant="secondary" onClick={handleCancel}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleConfirm}>
            ✅ Confirmar e Executar
          </Button>
        </div>

        {/* Velocidade */}
        <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <span>⚡</span>
            <span>Velocidade de Execução</span>
          </h3>
          
          <div className="mb-4">
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Delay entre ações (ms)
            </label>
            <input
              type="number"
              min="0"
              max="5000"
              step="50"
              value={config.slowMo}
              onChange={(e) => handleChange('slowMo', parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 bg-bg-primary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
            <p className="text-xs text-text-secondary mt-1">
              {config.slowMo === 0 && '⚡ Máxima velocidade (sem delay)'}
              {config.slowMo > 0 && config.slowMo < 200 && '🚀 Rápido'}
              {config.slowMo >= 200 && config.slowMo < 500 && '🏃 Normal'}
              {config.slowMo >= 500 && config.slowMo < 1000 && '🚶 Lento'}
              {config.slowMo >= 1000 && '🐌 Muito lento (útil para debug)'}
            </p>
          </div>

          <div className="flex gap-2 mb-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleChange('slowMo', 0)}
              className={config.slowMo === 0 ? 'ring-2 ring-accent-primary' : ''}
            >
              Máxima (0ms)
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleChange('slowMo', 100)}
              className={config.slowMo === 100 ? 'ring-2 ring-accent-primary' : ''}
            >
              Rápido (100ms)
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleChange('slowMo', 500)}
              className={config.slowMo === 500 ? 'ring-2 ring-accent-primary' : ''}
            >
              Normal (500ms)
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleChange('slowMo', 1000)}
              className={config.slowMo === 1000 ? 'ring-2 ring-accent-primary' : ''}
            >
              Lento (1000ms)
            </Button>
          </div>
        </div>

        {/* Modo de Execução */}
        <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <span>🖥️</span>
            <span>Modo de Execução</span>
          </h3>
          
          <div className="p-3 bg-bg-primary rounded-lg border border-border-default">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded border-2 border-accent-primary bg-accent-primary flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1">
                <span className="text-text-primary font-medium">Navegador Visível (Sempre Ativo)</span>
                <p className="text-text-secondary text-sm mt-1">
                  O navegador do RPA sempre será exibido para você acompanhar a execução em tempo real
                </p>
              </div>
            </div>
          </div>
          
          <input
            type="hidden"
            value={false}
            onChange={() => {}} // Sempre false, não pode ser alterado
          />
        </div>

        {/* Timeouts e Retry */}
        <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <span>⏱️</span>
            <span>Timeouts e Tentativas</span>
          </h3>
          
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">
                Timeout padrão (ms)
              </label>
              <input
                type="number"
                min="1000"
                max="120000"
                step="1000"
                value={config.timeout}
                onChange={(e) => handleChange('timeout', parseInt(e.target.value) || 30000)}
                className="w-full px-3 py-2 bg-bg-primary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">
                Máximo de tentativas
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={config.maxRetries}
                onChange={(e) => handleChange('maxRetries', parseInt(e.target.value) || 3)}
                className="w-full px-3 py-2 bg-bg-primary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Delay entre tentativas (ms)
            </label>
            <input
              type="number"
              min="0"
              max="10000"
              step="100"
              value={config.retryDelay}
              onChange={(e) => handleChange('retryDelay', parseInt(e.target.value) || 1000)}
              className="w-full px-3 py-2 bg-bg-primary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
        </div>

        {/* Modo Step-by-Step */}
        <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <span>⏸️</span>
            <span>Modo de Execução</span>
          </h3>
          
          <label className="flex items-center gap-3 p-3 bg-bg-primary rounded-lg border border-border-default hover:border-border-hover transition-colors cursor-pointer">
            <input
              type="checkbox"
              checked={config.stepByStep}
              onChange={(e) => handleChange('stepByStep', e.target.checked)}
              className="w-5 h-5 rounded border-border-default text-accent-primary focus:ring-2 focus:ring-accent-primary cursor-pointer"
            />
            <div className="flex-1">
              <span className="text-text-primary font-medium">Execução Step-by-Step</span>
              <p className="text-text-secondary text-sm mt-1">
                Pausa após cada ação e aguarda confirmação para continuar. Útil para debug e acompanhamento detalhado.
              </p>
            </div>
          </label>
        </div>

        {/* Opções Adicionais */}
        <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <span>📸</span>
            <span>Opções Adicionais</span>
          </h3>
          
          <div className="space-y-3">
            <label className="flex items-center gap-3 p-3 bg-bg-primary rounded-lg border border-border-default hover:border-border-hover transition-colors cursor-pointer">
              <input
                type="checkbox"
                checked={config.screenshotOnFailure}
                onChange={(e) => handleChange('screenshotOnFailure', e.target.checked)}
                className="w-5 h-5 rounded border-border-default text-accent-primary focus:ring-2 focus:ring-accent-primary cursor-pointer"
              />
              <div className="flex-1">
                <span className="text-text-primary font-medium">Capturar Screenshot em Falhas</span>
                <p className="text-text-secondary text-sm mt-1">
                  Tira screenshot automaticamente quando uma ação falha
                </p>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3 bg-bg-primary rounded-lg border border-border-default hover:border-border-hover transition-colors cursor-pointer">
              <input
                type="checkbox"
                checked={config.devtools}
                onChange={(e) => handleChange('devtools', e.target.checked)}
                className="w-5 h-5 rounded border-border-default text-accent-primary focus:ring-2 focus:ring-accent-primary cursor-pointer"
              />
              <div className="flex-1">
                <span className="text-text-primary font-medium">Abrir DevTools</span>
                <p className="text-text-secondary text-sm mt-1">
                  Abre o navegador com DevTools (Console) aberto para debug
                </p>
              </div>
            </label>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

