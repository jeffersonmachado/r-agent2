/**
 * Modal de seleção de tenant para Super Admin.
 * Aparece após login de super-admin para escolher qual tenant acessar.
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../styles/themeContext';
import { Button } from '../styles/Button';
import { listTenants } from '../api/tenants';
import { listAllTenants } from '../api/superAdmin';
import logger from '../utils/logger';

const LAST_TENANT_KEY = 'auth_last_tenant_id';
const EFFECTIVE_TENANT_KEY = 'auth_effective_tenant_id';

function readLastTenantId() {
  try {
    const v = localStorage.getItem(LAST_TENANT_KEY);
    return v && typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function persistLastTenantId(tenantId) {
  try {
    if (tenantId && typeof tenantId === 'string') {
      localStorage.setItem(LAST_TENANT_KEY, tenantId);
    }
  } catch {
    // ignora
  }
}

function persistEffectiveTenantId(tenantId) {
  try {
    if (tenantId && typeof tenantId === 'string') {
      localStorage.setItem(EFFECTIVE_TENANT_KEY, tenantId);
    }
  } catch {
    // ignora
  }
}

function normalizeTenant(t) {
  if (!t || typeof t !== 'object') return null;
  const rawId = t.id ?? t.tenant_key ?? t.tenantId ?? t.tenantKey ?? t.identifier ?? null;
  const id = rawId != null ? String(rawId).trim() : '';
  if (!id) return null;
  return {
    ...t,
    id,
    name: t.name ?? t.nome ?? t.displayName ?? null,
    plan: t.plan ?? t.plano ?? null,
  };
}

export function TenantSelectorModal({
  isOpen,
  onSelect,
  onClose,
  tenantsOverride = null,
  requireExplicitSelection = false,
  autoConfirmOnTenantClick = false,
  disallowTenantIds = [],
}) {
  const { theme, themeName } = useTheme();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTenantId, setSelectedTenantId] = useState(null);
  const [error, setError] = useState('');
  const [filterText, setFilterText] = useState('');

  const tenantsOverrideKey = Array.isArray(tenantsOverride)
    ? tenantsOverride.map((t) => String(t?.id || '')).join('|')
    : '';

  const confirmTenant = (tenantOrId) => {
    const tenantObj =
      tenantOrId && typeof tenantOrId === 'object'
        ? tenantOrId
        : { id: String(tenantOrId || '').trim(), name: String(tenantOrId || '').trim() };
    if (!tenantObj?.id) return;
    persistLastTenantId(tenantObj.id);
    persistEffectiveTenantId(tenantObj.id);
    onSelect(tenantObj);
  };

  // Limpa o filtro quando o modal é fechado
  useEffect(() => {
    if (!isOpen) {
      setFilterText('');
    }
  }, [isOpen]);

  // Em modo de seleção explícita, não permite “herdar” tenant anterior ao abrir.
  useEffect(() => {
    if (isOpen && requireExplicitSelection) {
      setSelectedTenantId(null);
    }
  }, [isOpen, requireExplicitSelection]);

  // Carrega lista de tenants
  useEffect(() => {
    if (!isOpen) return;

    const loadTenants = async () => {
      setLoading(true);
      setError('');
      try {
        console.log('[TenantSelectorModal] Iniciando carregamento de tenants...');

        const lastTenantId = requireExplicitSelection ? null : readLastTenantId();
        
        // Modo override (ex.: usuários não super-admin): não chama APIs.
        // Espera um array [{id, name?, plan?}, ...]
        if (Array.isArray(tenantsOverride)) {
          console.log('[TenantSelectorModal] Usando tenantsOverride (sem chamadas de API)...', tenantsOverride);
          const tenantsList = tenantsOverride.map(normalizeTenant).filter(Boolean);
          if (!Array.isArray(tenantsList)) {
            setError('Formato de resposta inválido');
            return;
          }

          // Ordena: "system" primeiro, depois os demais por nome
          const sortedTenants = [...tenantsList].sort((a, b) => {
            if (a.id === 'system') return -1;
            if (b.id === 'system') return 1;
            return (a.name || a.id).localeCompare(b.name || b.id, 'pt-BR');
          });

          setTenants(sortedTenants);

          if (requireExplicitSelection) {
            setSelectedTenantId(null);
          } else {
            // Pré-seleção:
            // 1) último tenant usado (se ainda existir na lista)
            // 2) "system" (fallback histórico)
            // 3) primeiro tenant da lista
            const hasLast = lastTenantId && sortedTenants.some((t) => t.id === lastTenantId);
            if (hasLast) {
              setSelectedTenantId(lastTenantId);
            } else {
              const systemTenant = sortedTenants.find((t) => t.id === 'system');
              if (systemTenant) {
                setSelectedTenantId('system');
              } else if (sortedTenants.length > 0) {
                setSelectedTenantId(sortedTenants[0].id);
              } else {
                setSelectedTenantId(null);
              }
            }
          }
          return;
        }

        // Tenta usar a rota de super-admin primeiro, depois fallback para tenants normal
        let result;
        try {
          console.log('[TenantSelectorModal] Tentando listAllTenants (super-admin)...');
          result = await listAllTenants();
          console.log('[TenantSelectorModal] listAllTenants retornou:', result);
        } catch (err) {
          console.error('[TenantSelectorModal] listAllTenants falhou:', err);
          console.error('[TenantSelectorModal] Erro completo:', {
            message: err.message,
            status: err.status,
            body: err.body,
            stack: err.stack,
          });
          // Se falhar, tenta a rota normal
          try {
            console.log('[TenantSelectorModal] Tentando listTenants como fallback...');
            result = await listTenants();
            console.log('[TenantSelectorModal] listTenants retornou:', result);
          } catch (err2) {
            console.error('[TenantSelectorModal] Ambas as rotas falharam:', err2);
            console.error('[TenantSelectorModal] Erro do listTenants:', {
              message: err2.message,
              status: err2.status,
              body: err2.body,
            });
            throw err2;
          }
        }
        
        console.log('[TenantSelectorModal] Resultado bruto:', result);
        const rawTenantsList = result.tenants || result || [];
        console.log('[TenantSelectorModal] Lista de tenants extraída:', rawTenantsList);
        
        if (!Array.isArray(rawTenantsList)) {
          console.error('[TenantSelectorModal] Resultado não é um array:', rawTenantsList);
          setError('Formato de resposta inválido');
          return;
        }

        const tenantsList = rawTenantsList.map(normalizeTenant).filter(Boolean);
        
        // Ordena: "system" primeiro, depois os demais por nome
        const sortedTenants = [...tenantsList].sort((a, b) => {
          if (a.id === 'system') return -1;
          if (b.id === 'system') return 1;
          return (a.name || a.id).localeCompare(b.name || b.id, 'pt-BR');
        });

        console.log('[TenantSelectorModal] Tenants ordenados:', sortedTenants);
        setTenants(sortedTenants);
        
        if (requireExplicitSelection) {
          setSelectedTenantId(null);
        } else {
          // Pré-seleção:
          // 1) último tenant usado (se ainda existir na lista)
          // 2) "system" (fallback histórico)
          // 3) primeiro tenant da lista
          const hasLast = lastTenantId && sortedTenants.some((t) => t.id === lastTenantId);
          if (hasLast) {
            console.log('[TenantSelectorModal] Pré-selecionando último tenant usado:', lastTenantId);
            setSelectedTenantId(lastTenantId);
          } else {
            const systemTenant = sortedTenants.find((t) => t.id === 'system');
            if (systemTenant) {
              console.log('[TenantSelectorModal] Pré-selecionando tenant system');
              setSelectedTenantId('system');
            } else if (sortedTenants.length > 0) {
              console.log('[TenantSelectorModal] Pré-selecionando primeiro tenant:', sortedTenants[0].id);
              setSelectedTenantId(sortedTenants[0].id);
            } else {
              console.warn('[TenantSelectorModal] Nenhum tenant encontrado');
              setSelectedTenantId(null);
            }
          }
        }
      } catch (err) {
        console.error('[TenantSelectorModal] Erro ao carregar tenants:', err);
        logger.error('Erro ao carregar tenants', err);
        setError(`Erro ao carregar lista de tenants: ${err.message || 'Erro desconhecido'}`);
      } finally {
        setLoading(false);
      }
    };

    loadTenants();
  }, [isOpen, tenantsOverrideKey, requireExplicitSelection]);

  const handleSelect = () => {
    if (selectedTenantId) {
      // Tenta encontrar o tenant completo na lista; se não achar (dados inconsistentes),
      // cria um fallback para ainda permitir prosseguir.
      let selectedTenant = tenants.find((t) => t.id === selectedTenantId) || null;
      if (!selectedTenant) {
        selectedTenant = { id: selectedTenantId, name: selectedTenantId };
      }

      confirmTenant(selectedTenant);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && selectedTenantId && !loading) {
      handleSelect();
    }
  };

  useEffect(() => {
    console.log('[TenantSelectorModal] Estado do modal mudou:', { isOpen, tenantsCount: tenants.length });
  }, [isOpen, tenants.length]);

  // Limpa seleção se o tenant selecionado não estiver mais visível após filtro
  useEffect(() => {
    if (selectedTenantId && filterText.trim()) {
      const searchTerm = filterText.toLowerCase().trim();
      const selectedTenant = tenants.find(t => t.id === selectedTenantId);
      if (selectedTenant) {
        const tenantName = (selectedTenant.name || '').toLowerCase();
        const tenantId = (selectedTenant.id || '').toLowerCase();
        const isVisible = tenantName.includes(searchTerm) || tenantId.includes(searchTerm);
        if (!isVisible) {
          setSelectedTenantId(null);
        }
      }
    }
  }, [filterText, selectedTenantId, tenants]);

  if (!isOpen) {
    return null;
  }

  console.log('[TenantSelectorModal] Renderizando modal, isOpen:', isOpen, 'tenants:', tenants.length);
  const isDark = themeName === 'dark';

  // Filtra tenants baseado no texto de busca
  const filteredTenants = tenants.filter(tenant => {
    if (!filterText.trim()) return true;
    const searchTerm = filterText.toLowerCase().trim();
    const tenantName = (tenant.name || '').toLowerCase();
    const tenantId = (tenant.id || '').toLowerCase();
    return tenantName.includes(searchTerm) || tenantId.includes(searchTerm);
  });

  const isTenantDisallowed = (tenantId) => {
    try {
      return Array.isArray(disallowTenantIds) && disallowTenantIds.includes(tenantId);
    } catch {
      return false;
    }
  };

  const modalContent = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '20px',
      }}
      onClick={(e) => {
        console.log('[TenantSelectorModal] Click no backdrop');
        onClose();
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div
        style={{
          background: theme.colors.bg.secondary,
          borderRadius: '16px',
          boxShadow: isDark
            ? '0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)'
            : '0 20px 60px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.05)',
          width: '100%',
          maxWidth: '500px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          border: `1px solid ${theme.colors.border.default}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '24px',
            borderBottom: `1px solid ${theme.colors.border.default}`,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: '20px',
              fontWeight: 600,
              color: theme.colors.text.primary,
            }}
          >
            Selecione o Tenant
          </h2>
          <p
            style={{
              margin: '8px 0 0 0',
              fontSize: '14px',
              color: theme.colors.text.secondary,
            }}
          >
            Escolha qual tenant deseja acessar
          </p>
        </div>

        {/* Content */}
        <div
          style={{
            padding: '24px',
            flex: 1,
            overflowY: 'auto',
          }}
        >
          {/* Campo de filtro */}
          <div style={{ marginBottom: '16px' }}>
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="🔍 Filtrar por nome ou ID..."
              style={{
                width: '100%',
                padding: '12px 16px',
                background: theme.colors.bg.primary,
                border: `1px solid ${theme.colors.border.default}`,
                borderRadius: '8px',
                fontSize: '14px',
                color: theme.colors.text.primary,
                boxSizing: 'border-box',
                outline: 'none',
                transition: 'all 0.2s ease',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = theme.colors.accent.primary;
                e.currentTarget.style.boxShadow = `0 0 0 3px ${theme.colors.accent.light}`;
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = theme.colors.border.default;
                e.currentTarget.style.boxShadow = 'none';
              }}
            />
          </div>
          {error && (
            <div
              style={{
                padding: '12px 16px',
                marginBottom: '16px',
                background: `${theme.colors.status.error}15`,
                border: `1px solid ${theme.colors.status.error}40`,
                borderRadius: '8px',
                color: theme.colors.status.error,
                fontSize: '14px',
              }}
            >
              {error}
            </div>
          )}

          {loading ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 20px',
                color: theme.colors.text.secondary,
              }}
            >
              <div style={{ marginBottom: '12px' }}>⏳</div>
              <div>Carregando tenants...</div>
            </div>
          ) : tenants.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 20px',
                color: theme.colors.text.secondary,
              }}
            >
              <div style={{ marginBottom: '12px' }}>📭</div>
              <div>Nenhum tenant encontrado</div>
            </div>
          ) : filteredTenants.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 20px',
                color: theme.colors.text.secondary,
              }}
            >
              <div style={{ marginBottom: '12px' }}>🔍</div>
              <div>Nenhum tenant encontrado com "{filterText}"</div>
              <div style={{ fontSize: '12px', marginTop: '8px', opacity: 0.7 }}>
                Tente outro termo de busca
              </div>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              {filteredTenants.map((tenant) => {
                const isSelected = selectedTenantId === tenant.id;
                const isSystem = tenant.id === 'system';
                const isDisallowed = isTenantDisallowed(tenant.id);

                return (
                  <button
                    key={tenant.id}
                    type="button"
                    disabled={isDisallowed}
                    onClick={() => {
                      if (isDisallowed) return;
                      setSelectedTenantId(tenant.id);
                      if (autoConfirmOnTenantClick && !isDisallowed) {
                        confirmTenant(tenant);
                      }
                    }}
                    style={{
                      padding: '16px',
                      background: isSelected
                        ? theme.colors.accent.primary + '15'
                        : theme.colors.bg.primary,
                      border: `2px solid ${
                        isSelected
                          ? theme.colors.accent.primary
                          : theme.colors.border.default
                      }`,
                      borderRadius: '8px',
                      textAlign: 'left',
                      cursor: isDisallowed ? 'not-allowed' : 'pointer',
                      opacity: isDisallowed ? 0.55 : 1,
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected && !isDisallowed) {
                        e.currentTarget.style.background = theme.colors.bg.hover;
                        e.currentTarget.style.borderColor = theme.colors.border.hover;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected && !isDisallowed) {
                        e.currentTarget.style.background = theme.colors.bg.primary;
                        e.currentTarget.style.borderColor = theme.colors.border.default;
                      }
                    }}
                  >
                    <div
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '8px',
                        background: isSystem
                          ? theme.colors.accent.primary
                          : theme.colors.bg.tertiary,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '20px',
                        flexShrink: 0,
                      }}
                    >
                      {isSystem ? '⚙️' : '🏢'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: '15px',
                          color: theme.colors.text.primary,
                          marginBottom: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        {tenant.name || tenant.id}
                        {isSystem && (
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '2px 6px',
                              background: theme.colors.accent.primary,
                              color: '#fff',
                              borderRadius: '4px',
                              fontWeight: 500,
                            }}
                          >
                            SYSTEM
                          </span>
                        )}
                        {isDisallowed && (
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '2px 6px',
                              background: theme.colors.bg.tertiary,
                              color: theme.colors.text.secondary,
                              borderRadius: '4px',
                              fontWeight: 500,
                              border: `1px solid ${theme.colors.border.default}`,
                            }}
                          >
                            indisponível
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: '13px',
                          color: theme.colors.text.secondary,
                        }}
                      >
                        {tenant.id}
                        {tenant.plan && (
                          <>
                            {' • '}
                            <span
                              style={{
                                textTransform: 'capitalize',
                              }}
                            >
                              {tenant.plan}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <div
                        style={{
                          color: theme.colors.accent.primary,
                          fontSize: '20px',
                        }}
                      >
                        ✓
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '24px',
            borderTop: `1px solid ${theme.colors.border.default}`,
            display: 'flex',
            gap: '12px',
            justifyContent: 'flex-end',
          }}
        >
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSelect}
            disabled={loading || !selectedTenantId || filteredTenants.length === 0}
          >
            {loading ? 'Carregando...' : 'Acessar'}
          </Button>
        </div>
      </div>
    </div>
  );

  // Renderiza usando portal para garantir que apareça acima de tudo
  return createPortal(modalContent, document.body);
}
