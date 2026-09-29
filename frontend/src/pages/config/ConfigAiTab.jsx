import React, { useState, useEffect, useCallback } from 'react';
import { validateProviderToken, validateTenantAiCredentials, saveTenantAiCredentials, listAiProviders, createAiProvider, deleteAiProvider, getTenantAiConfig } from '../../api/config';
import logger from '../../utils/logger';

const providerLabel = (providers, p) => {
  if (!p) return '—';
  const def = providers.find((x) => x.key === p || x.id === p);
  return def ? def.label : String(p);
};

function formatBalance(balance) {
  if (!balance || typeof balance.amount !== 'number') return null;
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: balance.currency || 'USD' }).format(balance.amount);
  } catch {
    return `${balance.amount} ${balance.currency || ''}`.trim();
  }
}

/**
 * Traduz o resultado da consulta de saldo feita pelo backend. O backend consulta saldo para TODOS
 * os providers e grava o resultado, não só o número: `available` traz `amount`/`currency`; os
 * demais status explicam por que não há saldo — `requires_admin_key` (o provider exige chave de
 * administrador) e `not_supported` (provider não expõe saldo por API: console-only ou rota
 * inexistente). Registros gravados antes desta mudança têm apenas `{ amount, currency }` e são
 * tratados como disponíveis.
 */
function describeBalance(balance) {
  if (!balance || typeof balance !== 'object') return { text: null, note: null, short: null };
  const status = balance.status || (typeof balance.amount === 'number' ? 'available' : null);
  if (status === 'available') return { text: formatBalance(balance), note: null, short: null };
  if (status === 'requires_admin_key') {
    return {
      text: null,
      short: 'saldo só via chave de admin',
      note: balance.note || 'O provedor exige uma chave de administrador para consultar o saldo.',
    };
  }
  if (status === 'not_supported') {
    return {
      text: null,
      short: 'saldo não consultável',
      note: balance.note || 'O provedor não expõe saldo por API — consulte no console.',
    };
  }
  if (status === 'error') {
    return {
      text: null,
      short: 'saldo indisponível',
      note: balance.note || 'Não foi possível consultar o saldo agora.',
    };
  }
  return { text: null, note: null, short: null };
}

function formatRelativeTime(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'agora mesmo';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.round(diffH / 24);
  return `há ${diffD}d`;
}

/**
 * Badge de status de uma credencial já salva. Antes desta melhoria, a única informação
 * disponível era um booleano "tem chave/não tem" — uma credencial sem saldo ficava indistinguível
 * de uma saudável até alguém tentar usá-la de verdade. Agora reflete o resultado real do último
 * teste (POST /tenants/:id/ai-credentials/test), persistido no backend.
 */
function CredentialStatusBadge({ providerStatus }) {
  const { hasCredential, status, lastError, lastTestedAt, balance } = providerStatus || {};
  if (!hasCredential) {
    return <span className="shrink-0 px-2 py-0.5 rounded text-xs font-medium bg-bg-secondary text-text-secondary">Sem chave</span>;
  }

  const { text: balanceText, note: balanceNote, short: balanceShort } = describeBalance(balance);
  const relativeTime = formatRelativeTime(lastTestedAt);

  const byStatus = {
    no_credit: { label: 'Sem saldo', tone: 'bg-status-error/20 text-status-error' },
    invalid_token: { label: 'Token inválido/expirado', tone: 'bg-status-error/20 text-status-error' },
    error: { label: 'Erro ao testar', tone: 'bg-status-warning/20 text-status-warning' },
    valid: {
      label: balanceText
        ? `Válida · saldo ${balanceText}`
        : (balanceShort ? `Válida · ${balanceShort}` : 'Válida'),
      tone: 'bg-status-success/20 text-status-success',
    },
    unknown: { label: 'Configurada (não testada)', tone: 'bg-bg-secondary text-text-secondary' },
  };
  const info = byStatus[status] || byStatus.unknown;

  return (
    <span
      className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${info.tone}`}
      title={[lastError, balanceNote, relativeTime ? `Testado ${relativeTime}` : null].filter(Boolean).join(' — ') || undefined}
    >
      {info.label}
      {relativeTime && status !== 'unknown' && <span className="opacity-60">· {relativeTime}</span>}
    </span>
  );
}

export function ConfigAiTab({ 
  editedConfig, agent, targetTenantId, loadingTenantAiConfig, tenantAiConfig,
  apiKey, apiKeyProvider, validatingApiKey, apiKeyValidationStatus,
  savingTenantAiConfig, savingTenantAiCredentials, credentialsValidatedAndSaved,
  setTenantAiConfig, setApiKey, setApiKeyProvider, setApiKeyValidationStatus,
  setValidatingApiKey, setSavingTenantAiCredentials, setCredentialsValidatedAndSaved,
  showToast
}) {
  const [providers, setProviders] = useState([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);
  const [deletingProviderKey, setDeletingProviderKey] = useState(null);
  const [newProvider, setNewProvider] = useState({ key: '', label: '', kind: 'openai-compatible', baseUrl: '', defaultModel: '', models: '' });

  const loadProviders = useCallback(async () => {
    setProvidersLoading(true);
    try {
      const res = await listAiProviders();
      setProviders(Array.isArray(res?.providers) ? res.providers : []);
    } catch (err) {
      logger.error('Erro ao listar providers de IA', err);
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

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
      const configuredCount = providers.filter((p) => !!tenantAiConfig?.providers?.[p.key]?.hasCredential).length;

      const handleAddProvider = async () => {
        if (!newProvider.key.trim() || !newProvider.label.trim() || !newProvider.baseUrl.trim() || !newProvider.defaultModel.trim()) {
          showToast('Preencha key, label, baseUrl e defaultModel', 'warning');
          return;
        }
        const models = newProvider.models
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [value, ...rest] = line.split('|').map((s) => s.trim());
            return { value, label: rest.join(' | ') || value };
          });
        setSavingProvider(true);
        try {
          await createAiProvider({
            key: newProvider.key.trim(),
            label: newProvider.label.trim(),
            kind: newProvider.kind,
            baseUrl: newProvider.baseUrl.trim(),
            defaultModel: newProvider.defaultModel.trim(),
            models,
          });
          showToast(`Provider "${newProvider.label.trim()}" criado`, 'success');
          setNewProvider({ key: '', label: '', kind: 'openai-compatible', baseUrl: '', defaultModel: '', models: '' });
          setShowAddForm(false);
          await loadProviders();
        } catch (err) {
          const msg = err?.body?.message || err?.message || 'Erro ao criar provider';
          showToast(`Erro: ${msg}`, 'error');
        } finally {
          setSavingProvider(false);
        }
      };

      const handleDeleteProvider = async (def) => {
        if (def.isBuiltin) {
          showToast(`Provider "${def.label}" é integrado e não pode ser removido`, 'warning');
          return;
        }
        if (!window.confirm(`Remover o provider "${def.label}"?`)) return;
        setDeletingProviderKey(def.key);
        try {
          await deleteAiProvider(def.key);
          showToast(`Provider "${def.label}" removido`, 'success');
          await loadProviders();
        } catch (err) {
          const msg = err?.body?.message || err?.message || 'Erro ao remover provider';
          showToast(`Erro: ${msg}`, 'error');
        } finally {
          setDeletingProviderKey(null);
        }
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
              A engine decide qual provider usar em runtime (roteamento com circuit breaker e failover). Aqui você gerencia os providers e suas credenciais.
            </p>
          </div>

          <div className="p-4 bg-status-info/10 rounded-lg border border-status-info/30">
            <p className="text-sm text-text-primary">
              <strong>🔌 Credenciais:</strong> {configuredCount} de {providers.length} providers com chave configurada para este tenant.
            </p>
          </div>

          {/* Provedores (data grid) */}
          <div className="pt-4 border-t border-border-default space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-medium text-text-primary">Provedores disponíveis ({providers.length})</h4>
              <button
                type="button"
                onClick={() => setShowAddForm((v) => !v)}
                className="px-3 py-1.5 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 text-sm font-medium flex items-center gap-1"
              >
                <span aria-hidden>＋</span>
                <span>Novo</span>
              </button>
            </div>

            {showAddForm && (
              <div className="p-4 rounded-lg border border-border-default bg-bg-primary space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block mb-1 text-xs font-medium text-text-secondary">Key (id)</label>
                    <input value={newProvider.key} onChange={(e) => setNewProvider((s) => ({ ...s, key: e.target.value }))} placeholder="meu-provider" className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-sm text-text-primary" />
                  </div>
                  <div>
                    <label className="block mb-1 text-xs font-medium text-text-secondary">Label</label>
                    <input value={newProvider.label} onChange={(e) => setNewProvider((s) => ({ ...s, label: e.target.value }))} placeholder="Meu Provider" className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-sm text-text-primary" />
                  </div>
                  <div>
                    <label className="block mb-1 text-xs font-medium text-text-secondary">Kind</label>
                    <select value={newProvider.kind} onChange={(e) => setNewProvider((s) => ({ ...s, kind: e.target.value }))} className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-sm text-text-primary">
                      <option value="openai-compatible">openai-compatible</option>
                      <option value="openai-sdk">openai-sdk</option>
                      <option value="anthropic">anthropic</option>
                    </select>
                  </div>
                  <div>
                    <label className="block mb-1 text-xs font-medium text-text-secondary">Base URL</label>
                    <input value={newProvider.baseUrl} onChange={(e) => setNewProvider((s) => ({ ...s, baseUrl: e.target.value }))} placeholder="https://api.exemplo.com/v1" className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-sm text-text-primary" />
                  </div>
                  <div>
                    <label className="block mb-1 text-xs font-medium text-text-secondary">Modelo padrão</label>
                    <input value={newProvider.defaultModel} onChange={(e) => setNewProvider((s) => ({ ...s, defaultModel: e.target.value }))} placeholder="modelo-default" className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-sm text-text-primary" />
                  </div>
                  <div>
                    <label className="block mb-1 text-xs font-medium text-text-secondary">Modelos (um por linha: valor|Label)</label>
                    <textarea value={newProvider.models} onChange={(e) => setNewProvider((s) => ({ ...s, models: e.target.value }))} placeholder={'modelo-a|Modelo A\nmodelo-b|Modelo B'} rows={2} className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-sm text-text-primary" />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setShowAddForm(false)} className="px-3 py-1.5 rounded-lg bg-bg-secondary text-text-primary text-sm font-medium border border-border-default">Cancelar</button>
                  <button type="button" onClick={handleAddProvider} disabled={savingProvider} className="px-3 py-1.5 rounded-lg bg-accent-primary text-white text-sm font-medium disabled:opacity-50">
                    {savingProvider ? 'Salvando...' : 'Salvar provider'}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {providersLoading ? (
                <p className="text-sm text-text-secondary">Carregando providers...</p>
              ) : providers.length === 0 ? (
                <p className="text-sm text-text-secondary">Nenhum provider disponível.</p>
              ) : (
                providers.map((def) => {
                  const key = def.key || def.id;
                  const providerStatus = tenantAiConfig?.providers?.[key];
                  const isDeleting = deletingProviderKey === key;
                  return (
                    <div key={key} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border-default bg-bg-primary">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-text-primary truncate">{def.label || key}</p>
                          {def.isBuiltin ? (
                            <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-secondary text-text-secondary border border-border-default">integrado</span>
                          ) : null}
                        </div>
                        <p className="text-xs text-text-secondary truncate">{def.kind} · {def.baseUrl}</p>
                        <p className="text-xs text-text-secondary truncate">modelo: {def.defaultModel}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <CredentialStatusBadge providerStatus={providerStatus} />
                        <button
                          type="button"
                          onClick={() => {
                            setApiKeyProvider(key);
                            setApiKeyValidationStatus(null);
                            setCredentialsValidatedAndSaved(false);
                            showToast(`Provider ${def.label || key} selecionado — informe a API key abaixo`, 'info');
                            requestAnimationFrame(() => {
                              const inputEl = document.getElementById('ai-api-key-input');
                              if (inputEl) {
                                inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                setTimeout(() => inputEl.focus(), 350);
                              }
                            });
                          }}
                          className="px-2 py-1 rounded text-xs font-medium bg-bg-secondary text-text-primary hover:bg-accent-primary/10 border border-border-default"
                        >
                          Configurar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteProvider(def)}
                          disabled={isDeleting || def.isBuiltin}
                          title={def.isBuiltin ? 'Provider integrado não pode ser removido' : 'Remover provider'}
                          className="px-2 py-1 rounded text-xs font-medium text-status-error hover:bg-status-error/10 border border-border-default disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {isDeleting ? '…' : '🗑'}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Credenciais */}
          {(
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
                  {providers.map((def) => (
                    <option key={def.key || def.id} value={def.key || def.id}>{def.label || def.key}</option>
                  ))}
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
                      id="ai-api-key-input"
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
                          balance: result.balance || null,
                        });

                        if (result.valid) {
                          showToast(`API Key ${providerLabel(providers, apiKeyProvider)} válida!`, 'success');
                        } else {
                          showToast(`API Key ${providerLabel(providers, apiKeyProvider)} inválida: ${result.error || 'Erro desconhecido'}`, 'error');
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
                {apiKeyValidationStatus && apiKeyValidationStatus.valid && (() => {
                  const info = describeBalance(apiKeyValidationStatus.balance);
                  if (info.text) {
                    return <p className="mt-1 text-xs text-text-secondary">Saldo consultado no provedor: <strong>{info.text}</strong></p>;
                  }
                  if (info.note) {
                    return <p className="mt-1 text-xs text-text-secondary">Saldo não exibido — {info.note}</p>;
                  }
                  return null;
                })()}
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
                      // Testa de verdade a chave recém-salva (chamada real ao provider) — o
                      // backend persiste o resultado (status/erro/saldo) na própria credencial,
                      // nunca a apaga em caso de falha. É esse teste que popula o badge de
                      // status abaixo, sem exigir um passo manual separado.
                      try {
                        await validateTenantAiCredentials({ tenantId: targetTenantId || undefined, provider: apiKeyProvider });
                      } catch (testErr) {
                        logger.warn('Não foi possível testar a credencial recém-salva', testErr);
                      }
                      // Atualiza o status por provider (agora com status/saldo reais) sem limpar o banner de sucesso
                      try {
                        const refreshed = await getTenantAiConfig(targetTenantId || undefined);
                        if (refreshed?.providers) {
                          setTenantAiConfig((prev) => ({ ...(prev || {}), providers: refreshed.providers }));
                        }
                      } catch (refreshErr) {
                        logger.warn('Não foi possível atualizar o status de credenciais', refreshErr);
                      }
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
                  disabled={savingTenantAiConfig || savingTenantAiCredentials || !apiKeyProvider || !apiKey.trim()}
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

          {credentialsValidatedAndSaved && (
            <div className="p-3 bg-status-success/10 rounded-lg border border-status-success/30">
              <p className="text-sm text-status-success">
                ✓ Credenciais validadas e salvas com sucesso
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
