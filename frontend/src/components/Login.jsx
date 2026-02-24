/**
 * Componente de login de agentes com suporte a temas.
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/authContext';
import { useTheme } from '../styles/themeContext';
import { useRouter } from '../hooks/useRouter';
import { Button } from '../styles/Button';
import { useToast } from './Toast';
import { TenantSelectorModal } from './TenantSelectorModal';
import logger from '../utils/logger';
import { getBasePath, getStaticUrl } from '../utils';
import { validateTenantAiCredentials } from '../api/config';
import { isSuperAdmin as checkIsSuperAdmin } from '../utils/menuPermissions';

export function Login() {
  const { login, isAuthenticated, agent, updateAgent } = useAuth();
  const { theme, themeName, toggleTheme } = useTheme();
  const { navigate } = useRouter();
  const { showToast } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [focusedField, setFocusedField] = useState(null);
  const [showTenantModal, setShowTenantModal] = useState(false);
  const [loginResult, setLoginResult] = useState(null);
  const [isSuperAdminLogin, setIsSuperAdminLogin] = useState(false);

  // IMPORTANTE: Não redireciona automaticamente via useEffect
  // A verificação de provider e redirecionamento são feitos explicitamente no handleSubmit e handleTenantSelected
  // Isso garante que a verificação de provider seja feita ANTES de redirecionar
  // useEffect desabilitado para evitar redirecionamento prematuro

  // Redireciona quando tenant for selecionado
  const handleTenantSelected = async (tenant) => {
    try {
      console.log('[Login] Tenant selecionado:', tenant);
      console.log('[Login] loginResult disponível:', !!loginResult);
      console.log('[Login] loginResult.agent disponível:', !!loginResult?.agent);

      if (!tenant || !tenant.id) {
        showToast('Erro: tenant inválido', 'error');
        return;
      }
      
      // Atualiza o tenantId do agente
      if (loginResult && loginResult.agent) {
        const isSuperAdmin = checkIsSuperAdmin(loginResult.agent);
        const updatedAgent = {
          ...loginResult.agent,
          tenantId: tenant.id,
          ...(isSuperAdmin ? { originalTenantId: loginResult.agent.tenantId } : {}),
        };
        
        console.log('[Login] Atualizando agente com novo tenantId:', updatedAgent);
        
        // Verifica se o tenant tem provider de IA válido ANTES de atualizar o agente e fechar o modal
        // IMPORTANTE: O login via formulário sempre exige confirmação do tenant
        try {
          console.log('[Login] Verificando provider de IA para o tenant selecionado:', tenant.id);
          const aiCredentialsStatus = await validateTenantAiCredentials({ tenantId: tenant.id });
          console.log('[Login] Resposta completa da verificação (ai-credentials/test):', JSON.stringify(aiCredentialsStatus, null, 2));
          
          // Regra estrita: precisa ser explicitamente valid === true
          const hasValidProvider = aiCredentialsStatus && 
                               typeof aiCredentialsStatus === 'object' && 
                               aiCredentialsStatus.valid === true;
          
          if (!hasValidProvider) {
            console.log('[Login] ❌ Tenant NÃO tem provider de IA válido. Status:', aiCredentialsStatus);
            console.log('[Login] Detalhes da verificação:', {
              hasStatus: !!aiCredentialsStatus,
              isObject: typeof aiCredentialsStatus === 'object',
              validValue: aiCredentialsStatus?.valid,
              validType: typeof aiCredentialsStatus?.valid,
              isTrue: aiCredentialsStatus?.valid === true,
              provider: aiCredentialsStatus?.provider ?? null,
              error: aiCredentialsStatus?.error ?? null,
            });
            
            // IMPORTANTE: Atualiza o agente ANTES de redirecionar para que o campo de config apareça
            console.log('[Login] Atualizando agente antes de redirecionar para /config...');
            updateAgent(updatedAgent);
            setIsSuperAdminLogin(false);
            // Fecha o modal antes de redirecionar para evitar "travamento" visual
            // (a navegação ocorre, mas o modal ficava por cima e dava a impressão de que não acessou)
            setShowTenantModal(false);
            
            showToast(
              aiCredentialsStatus?.error
                ? `Provider de IA inválido/não configurado: ${aiCredentialsStatus.error}`
                : 'Configure um provider de IA para o tenant antes de continuar',
              'warning'
            );
            
            // Usa requestAnimationFrame para garantir que o React processou a atualização do estado
            requestAnimationFrame(() => {
              setTimeout(() => {
                console.log('[Login] Redirecionando para /config após verificação de provider');
                try {
                  navigate(`/config?tab=ai&tenant=${encodeURIComponent(tenant.id)}`);
                  console.log('[Login] Comando navigate para /config executado');
                  
                  // Verifica se o redirecionamento funcionou após um tempo
                  setTimeout(() => {
                    const stillInLogin = window.location.pathname.includes('/login');
                    const inConfig = window.location.pathname.includes('/config');
                    if (stillInLogin || !inConfig) {
                      console.warn('[Login] ⚠️ Redirecionamento via SPA falhou, usando hard redirect');
                      const basePath = getBasePath() || '';
                      window.location.href = `${basePath}/config?tab=ai&tenant=${encodeURIComponent(tenant.id)}`;
                    }
                  }, 500);
                } catch (err) {
                  console.error('[Login] Erro ao usar navigate, tentando window.location:', err);
                  const basePath = getBasePath() || '';
                  window.location.href = `${basePath}/config?tab=ai&tenant=${encodeURIComponent(tenant.id)}`;
                }
              }, 300);
            });
            return; // Não continua para /support, mas agente já foi atualizado
          }
          
          console.log('[Login] ✅ Tenant tem provider de IA válido, continuando para /support');
        } catch (err) {
          console.error('[Login] Erro ao verificar provider de IA:', err);
          logger.warn('Erro ao verificar provider de IA do tenant, bloqueando fluxo e redirecionando para configuração', err);
          
          // Neste caso, NÃO podemos ignorar: sem saber o status do provider, não deixamos prosseguir.
          // Atualiza o agente e redireciona para a configuração de IA do tenant selecionado.
          updateAgent(updatedAgent);
          setIsSuperAdminLogin(false);
          setShowTenantModal(false);
          
          showToast('Não foi possível verificar o provider de IA do tenant. Redirecionando para configuração.', 'warning', 8000);
          
          requestAnimationFrame(() => {
            setTimeout(() => {
              try {
                navigate(`/config?tab=ai&tenant=${encodeURIComponent(tenant.id)}`);
              } catch (navErr) {
                console.error('[Login] Erro ao usar navigate, tentando window.location:', navErr);
                const basePath = getBasePath() || '';
                window.location.href = `${basePath}/config?tab=ai&tenant=${encodeURIComponent(tenant.id)}`;
              }
            }, 300);
          });
          return;
        }
        
        // Só atualiza agente e fecha modal se chegou até aqui (provider válido ou erro na verificação)
        // Atualiza o agente no contexto de autenticação
        console.log('[Login] Atualizando agente antes de redirecionar...');
        updateAgent(updatedAgent);
        
        // Marca que não é mais login de super-admin (tenant foi selecionado)
        setIsSuperAdminLogin(false);
        
        // Fecha o modal
        setShowTenantModal(false);
        
        showToast(`Acessando tenant: ${tenant.name || tenant.id}`, 'success');
        
        // Aguarda um pouco mais para garantir que o estado foi atualizado antes de redirecionar
        // Usa requestAnimationFrame para garantir que o React processou a atualização do estado
        requestAnimationFrame(() => {
          setTimeout(() => {
            console.log('[Login] Redirecionando para /support após seleção do tenant');
            console.log('[Login] Estado antes do redirecionamento:', {
              isAuthenticated,
              agent: !!agent,
              tenantId: agent?.tenantId,
            });
            
            // Força o redirecionamento usando window.location se navigate não funcionar
            try {
              navigate('/support');
              console.log('[Login] Comando navigate executado');
              
              // Verifica se o redirecionamento funcionou após um tempo
              setTimeout(() => {
                if (window.location.pathname.includes('/login')) {
                  console.warn('[Login] ⚠️ Ainda em /login após navigate, tentando window.location');
                  const basePath = window.location.pathname.split('/login')[0] || '';
                  window.location.href = `${basePath}/support`;
                }
              }, 500);
            } catch (err) {
              console.error('[Login] Erro ao usar navigate, tentando window.location:', err);
              const basePath = window.location.pathname.split('/login')[0] || '';
              window.location.href = `${basePath}/support`;
            }
          }, 300);
        });
      } else {
        // Se não há loginResult ou agent, tenta usar o agente atual do contexto
        console.warn('[Login] ⚠️ loginResult ou agent não disponível, tentando usar agente do contexto');
        if (agent) {
          const updatedAgent = {
            ...agent,
            tenantId: tenant.id,
            originalTenantId: agent.tenantId,
          };
          updateAgent(updatedAgent);
          setIsSuperAdminLogin(false);
          setShowTenantModal(false);
          showToast(`Acessando tenant: ${tenant.name || tenant.id}`, 'success');
          setTimeout(() => {
            console.log('[Login] Redirecionando para /support (usando agente do contexto)');
            navigate('/support');
          }, 200);
        } else {
          console.error('[Login] ❌ Não foi possível atualizar agente: loginResult e agent não disponíveis');
          showToast('Erro: informações de autenticação não disponíveis', 'error');
        }
      }
    } catch (err) {
      console.error('[Login] Erro ao selecionar tenant:', err);
      logger.error('Erro ao selecionar tenant', err);
      showToast('Erro ao selecionar tenant', 'error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Login via formulário deve sempre iniciar uma sessão limpa.
      // Isso evita reutilizar tenant/sessão anteriores via localStorage.
      try {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_agent');
        // Não reaproveita tenant anterior em login via formulário
        localStorage.removeItem('auth_last_tenant_id');
        // Força seleção explícita do tenant efetivo no login via formulário
        localStorage.removeItem('auth_effective_tenant_id');
      } catch (err) {
        console.warn('[Login] Falha ao limpar sessão local (ignorado):', err);
      }
      // Zera estado local do contexto para não “vazar” autenticação anterior.
      updateAgent(null);
      setLoginResult(null);

      const result = await login(username, password);
      setLoginResult(result);
      
      console.log('[Login] Resultado do login:', result);
      console.log('[Login] Agente recebido:', result?.agent);
      
      // Verifica se é super-admin
      // Usa a mesma lógica central do app:
      // - role 'super_admin'
      // - owner do tenant 'system' (considera originalTenantId quando aplicável)
      // - fallback por username (systemadmin)
      const isSuperAdmin = checkIsSuperAdmin(result.agent);
      
      console.log('[Login] É super-admin?', isSuperAdmin, {
        role: result.agent?.role,
        tenantId: result.agent?.tenantId,
        agent: result.agent,
      });

      // Lógica de redirecionamento após login:
      // 1. Super-admin: SEMPRE abre modal de seleção de tenants
      // 2. Admin normal com tenantId: redireciona direto para /support (sem modal)
      // 3. Outros: abre modal de seleção
      if (isSuperAdmin) {
        // Super-admin: sempre força seleção de tenant
        console.log('[Login] Super-admin: abrindo modal de seleção de tenant');
        setIsSuperAdminLogin(true);
        setShowTenantModal(true);
        showToast('Selecione o tenant para acessar.', 'success');
        setLoading(false);
      } else if (result.agent?.tenantId) {
        // Admin normal com tenantId já integrado: faz login direto
        console.log('[Login] Admin normal com tenantId: redirecionando para /support');
        showToast('Login realizado com sucesso!', 'success');
        setLoading(false);
        // Redireciona imediatamente para /support
        setTimeout(() => {
          navigate('/support');
        }, 100);
      } else {
        // Admin sem tenantId: precisa selecionar
        console.log('[Login] Admin sem tenantId: abrindo modal de seleção');
        setIsSuperAdminLogin(false);
        setShowTenantModal(true);
        showToast('Selecione o tenant para acessar.', 'success');
        setLoading(false);
      }
    } catch (err) {
      const errorMessage = err.body?.message || err.message || 'Erro ao fazer login';
      setError(errorMessage);
      logger.error('Erro no login', err);
      showToast(errorMessage, 'error');
      setLoading(false);
    }
  };

  const isDark = themeName === 'dark';

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      background: theme.colors.bg.primary,
      padding: '20px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background decorativo */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: isDark
          ? 'radial-gradient(circle at 20% 50%, rgba(94, 106, 210, 0.1) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(139, 92, 246, 0.08) 0%, transparent 50%)'
          : 'radial-gradient(circle at 20% 50%, rgba(94, 106, 210, 0.05) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(139, 92, 246, 0.03) 0%, transparent 50%)',
        pointerEvents: 'none',
      }} />

      {/* Seletor de tema no canto superior direito */}
      <button
        onClick={toggleTheme}
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          padding: '10px 16px',
          background: theme.colors.bg.secondary,
          border: `1px solid ${theme.colors.border.default}`,
          borderRadius: '8px',
          color: theme.colors.text.secondary,
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          transition: 'all 0.2s ease',
          zIndex: 10,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = theme.colors.bg.hover;
          e.currentTarget.style.borderColor = theme.colors.border.hover;
          e.currentTarget.style.color = theme.colors.text.primary;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = theme.colors.bg.secondary;
          e.currentTarget.style.borderColor = theme.colors.border.default;
          e.currentTarget.style.color = theme.colors.text.secondary;
        }}
      >
        <span>{isDark ? '☀️' : '🌙'}</span>
        <span>{isDark ? 'Claro' : 'Escuro'}</span>
      </button>

      <div style={{
        background: theme.colors.bg.secondary,
        padding: '48px',
        borderRadius: '16px',
        boxShadow: isDark
          ? '0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)'
          : '0 20px 60px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.05)',
        width: '100%',
        maxWidth: '420px',
        position: 'relative',
        zIndex: 1,
        border: `1px solid ${theme.colors.border.default}`,
      }}>
        {/* Logo/Ícone */}
        <div style={{
          textAlign: 'center',
          marginBottom: '32px',
        }}>
          <div style={{
            width: '120px',
            height: '120px',
            margin: '0 auto 16px',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            boxShadow: `0 8px 16px ${theme.colors.accent.light}`,
          }}>
            <img 
              src={getStaticUrl("/images/home_results_29.png")} 
              alt="Results Logo" 
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
              }}
            />
          </div>
          <h1 style={{
            margin: 0,
            marginBottom: '8px',
            fontSize: '28px',
            fontWeight: 600,
            color: theme.colors.text.primary,
            letterSpacing: '-0.5px',
          }}>
            Login de Agente
          </h1>
          <p style={{
            margin: 0,
            fontSize: '14px',
            color: theme.colors.text.secondary,
          }}>
            Acesse o sistema de atendimento
          </p>
        </div>

        {error && (
          <div style={{
            padding: '12px 16px',
            marginBottom: '24px',
            background: `${theme.colors.status.error}15`,
            border: `1px solid ${theme.colors.status.error}40`,
            borderRadius: '8px',
            color: theme.colors.status.error,
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              fontWeight: 500,
              fontSize: '14px',
              color: theme.colors.text.primary,
            }}>
              Username
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onFocus={() => setFocusedField('username')}
                onBlur={() => setFocusedField(null)}
                required
                autoFocus
                autoComplete="username"
                placeholder="Digite seu username"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  background: theme.colors.bg.primary,
                  border: `1px solid ${focusedField === 'username' ? theme.colors.accent.primary : theme.colors.border.default}`,
                  borderRadius: '8px',
                  fontSize: '15px',
                  color: theme.colors.text.primary,
                  boxSizing: 'border-box',
                  outline: 'none',
                  transition: 'all 0.2s ease',
                  boxShadow: focusedField === 'username' ? `0 0 0 3px ${theme.colors.accent.light}` : 'none',
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              fontWeight: 500,
              fontSize: '14px',
              color: theme.colors.text.primary,
            }}>
              Senha
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField(null)}
                required
                autoComplete="current-password"
                placeholder="Digite sua senha"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  background: theme.colors.bg.primary,
                  border: `1px solid ${focusedField === 'password' ? theme.colors.accent.primary : theme.colors.border.default}`,
                  borderRadius: '8px',
                  fontSize: '15px',
                  color: theme.colors.text.primary,
                  boxSizing: 'border-box',
                  outline: 'none',
                  transition: 'all 0.2s ease',
                  boxShadow: focusedField === 'password' ? `0 0 0 3px ${theme.colors.accent.light}` : 'none',
                }}
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading || !username || !password}
            style={{
              width: '100%',
              padding: '14px',
              fontSize: '15px',
              fontWeight: 500,
              marginBottom: '24px',
            }}
          >
            {loading ? (
              <>
                <span style={{ marginRight: '8px' }}>⏳</span>
                Entrando...
              </>
            ) : (
              <>
                <span style={{ marginRight: '8px' }}>→</span>
                Entrar
              </>
            )}
          </Button>
        </form>

        <div style={{
          padding: '16px',
          background: theme.colors.bg.tertiary,
          borderRadius: '8px',
          fontSize: '13px',
          color: theme.colors.text.secondary,
          border: `1px solid ${theme.colors.border.default}`,
        }}>
          <div style={{
            fontWeight: 600,
            marginBottom: '8px',
            color: theme.colors.text.primary,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            <span>ℹ️</span>
            <span>Primeiro acesso?</span>
          </div>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            fontFamily: 'var(--font-family-mono)',
            fontSize: '12px',
          }}>
            <div>
              <span style={{ color: theme.colors.text.tertiary }}>Username:</span>{' '}
              <code style={{
                background: theme.colors.bg.primary,
                padding: '2px 6px',
                borderRadius: '4px',
                color: theme.colors.accent.primary,
              }}>admin</code>
            </div>
            <div>
              <span style={{ color: theme.colors.text.tertiary }}>Senha:</span>{' '}
              <code style={{
                background: theme.colors.bg.primary,
                padding: '2px 6px',
                borderRadius: '4px',
                color: theme.colors.accent.primary,
              }}>Admin123!</code>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de seleção de tenant para super-admin */}
      <TenantSelectorModal
        isOpen={showTenantModal}
        onSelect={handleTenantSelected}
        requireExplicitSelection={true}
        tenantsOverride={
          !isSuperAdminLogin && loginResult?.agent?.tenantId
            ? [{ id: loginResult.agent.tenantId, name: loginResult.agent.tenantId }]
            : null
        }
        onClose={() => {
          console.log('[Login] Modal fechado sem selecionar tenant - fazendo logout');
          setShowTenantModal(false);
          setIsSuperAdminLogin(false);
          // Se cancelar, faz logout
          if (loginResult) {
            setLoginResult(null);
            // Remove token e agente
            localStorage.removeItem('auth_token');
            localStorage.removeItem('auth_agent');
            // Recarrega a página para voltar à tela de login
            window.location.reload();
          }
        }}
      />
    </div>
  );
}

