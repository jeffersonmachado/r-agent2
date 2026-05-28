import React from 'react';
import { validateProviderToken, saveTenantAiCredentials } from '../../api/config';
import logger from '../../utils/logger';

export function ConfigAiTab({ 
  editedConfig, agent, targetTenantId, loadingTenantAiConfig, tenantAiConfig,
  providerAutoValidation, apiKey, apiKeyProvider, validatingApiKey, apiKeyValidationStatus,
  savingTenantAiConfig, savingTenantAiCredentials, credentialsValidatedAndSaved,
  setTenantAiConfig, setApiKey, setApiKeyProvider, setApiKeyValidationStatus,
  setValidatingApiKey, setSavingTenantAiCredentials, setCredentialsValidatedAndSaved,
  setProviderAutoValidationNonce, showToast
}) {
  return (
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

      const providerLabel = (p) => {
        if (!p) return '—';
        if (p === 'openai') return 'OpenAI';
        if (p === 'anthropic') return 'Anthropic (Claude)';
        return String(p);
      };

      const providerStatus = (() => {
        // Status do provider (similar ao indicador de WebSocket)
        if (!currentConfig.primary) {
          return {
            dotColor: 'rgb(156, 163, 175)', // cinza
            dotPulse: false,
            text: 'Não configurado',
            title: 'Provider primário de IA não configurado para este tenant.',
          };
        }

        if (providerAutoValidation.validating) {
          return {
            dotColor: 'rgb(59, 130, 246)', // azul
            dotPulse: true,
            text: `Validando (${providerLabel(currentConfig.primary)})...`,
            title: 'Validando credenciais salvas do provider (chamada real).',
          };
        }

        if (providerAutoValidation.status) {
          if (providerAutoValidation.status.valid) {
            return {
              dotColor: 'rgb(16, 185, 129)', // verde
              dotPulse: true,
              text: `Válido (${providerLabel(currentConfig.primary)})`,
              title: 'Provider validado com sucesso (API Key válida).',
            };
          }
          return {
            dotColor: 'rgb(239, 68, 68)', // vermelho
            dotPulse: false,
            text: `Inválido (${providerLabel(currentConfig.primary)})`,
            title: `Provider inválido: ${providerAutoValidation.status.error || 'erro desconhecido'}`,
          };
        }

        // Durante carga inicial, assume validação em andamento
        return {
          dotColor: 'rgb(59, 130, 246)', // azul
          dotPulse: true,
          text: `Validando (${providerLabel(currentConfig.primary)})...`,
          title: 'Validando credenciais salvas do provider...',
        };
      })();

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

          {/* Indicador de status do provider (estilo WebSocket) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              title={providerStatus.title}
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: providerStatus.dotColor,
                animation: providerStatus.dotPulse
                  ? 'pulse 2s ease 0s infinite normal none running pulse'
                  : 'none',
              }}
            />
            <span style={{ fontSize: 14, color: 'rgb(102, 102, 102)' }}>
              {providerStatus.text}
            </span>
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
                        <optgroup label="GPT-5.5">
                          <option value="gpt-5.5">GPT-5.5</option>
                          <option value="gpt-5.5-pro">GPT-5.5 Pro</option>
                        </optgroup>
                        <optgroup label="GPT-5.4">
                          <option value="gpt-5.4">GPT-5.4</option>
                          <option value="gpt-5.4-pro">GPT-5.4 Pro</option>
                          <option value="gpt-5.4-mini">GPT-5.4 Mini</option>
                          <option value="gpt-5.4-nano">GPT-5.4 Nano</option>
                        </optgroup>
                        <optgroup label="GPT-5">
                          <option value="gpt-5">GPT-5</option>
                          <option value="gpt-5-mini">GPT-5 Mini</option>
                          <option value="gpt-5-nano">GPT-5 Nano</option>
                        </optgroup>
                        <optgroup label="Codex">
                          <option value="gpt-5-codex">GPT-5 Codex</option>
                          <option value="gpt-5.3-codex">GPT-5.3 Codex</option>
                        </optgroup>
                        <optgroup label="GPT-4.1">
                          <option value="gpt-4.1">GPT-4.1</option>
                          <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                          <option value="gpt-4.1-nano">GPT-4.1 Nano</option>
                        </optgroup>
                        <optgroup label="o-Series (raciocínio)">
                          <option value="o4">o4</option>
                          <option value="o4-mini">o4-mini</option>
                          <option value="o3">o3</option>
                          <option value="o3-mini">o3-mini</option>
                        </optgroup>
                        <optgroup label="GPT-4 (legado)">
                          <option value="gpt-4o">GPT-4o</option>
                          <option value="gpt-4-turbo">GPT-4 Turbo</option>
                          <option value="gpt-4">GPT-4</option>
                          <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                        </optgroup>
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
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-text-primary">
                    API Key
                  </label>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${
                      validatingApiKey
                        ? 'bg-status-info/20 text-status-info border-status-info/30'
                        : apiKeyValidationStatus
                          ? apiKeyValidationStatus.valid
                            ? 'bg-status-success/20 text-status-success border-status-success/30'
                            : 'bg-status-error/20 text-status-error border-status-error/30'
                          : 'bg-bg-primary text-text-secondary border-border-default'
                    }`}
                  >
                    {validatingApiKey ? (
                      <>
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current"></div>
                        <span>Validando...</span>
                      </>
                    ) : apiKeyValidationStatus ? (
                      apiKeyValidationStatus.valid ? (
                        <span>Válido</span>
                      ) : (
                        <span>Inválido</span>
                      )
                    ) : (
                      <span>{(apiKey || '').trim() ? 'Não testado' : 'Informe e teste'}</span>
                    )}
                  </span>
                </div>
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
                      // Força revalidação automática do provider após salvar credenciais
                      setProviderAutoValidationNonce((n) => n + 1);
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
);
}
