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
import { getOnboardingCheck } from '../api/onboarding';
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
      logger.debug('[Login] Tenant selecionado', {
        tenantId: tenant?.id,
        hasLoginResult: !!loginResult,
        hasAgent: !!loginResult?.agent,
      });

      if (!tenant || !tenant.id) {
        showToast('Erro: tenant inválido', 'error');
        return;
      }
      
      // Atualiza o tenantId do agente
      if (loginResult && loginResult.agent) {
        const isSuperAdmin = checkIsSuperAdmin(loginResult.agent);
        const isSystemTenant = String(tenant.id || '').trim().toLowerCase() === 'system';
        const updatedAgent = {
          ...loginResult.agent,
          tenantId: tenant.id,
          ...(isSuperAdmin ? { originalTenantId: loginResult.agent.tenantId } : {}),
        };
        
        logger.debug('[Login] Atualizando agente com novo tenantId', {
          tenantId: tenant.id,
          isSuperAdmin,
          isSystemTenant,
        });
        
        // Super-admin OU tenant system: pula verificações de provider/integrações
        // Tenant system é para administração da plataforma, não operação de negócio
        if (isSuperAdmin || isSystemTenant) {
          logger.debug('[Login] Pulando verificações de onboarding (super-admin ou tenant system)');
          updateAgent(updatedAgent);
          setIsSuperAdminLogin(false);
          setShowTenantModal(false);
          showToast(`Acessando tenant: ${tenant.name || tenant.id}`, 'success');
          requestAnimationFrame(() => {
            setTimeout(() => {
              try {
                navigate('/workspace');
              } catch (_) {
                const basePath = getBasePath() || '';
                window.location.href = `${basePath}/workspace`;
              }
            }, 300);
          });
          return;
        }
        
        // Atualiza o agente PRIMEIRO (salva tenantId no localStorage)
        // para que getOnboardingCheck() consiga enviar X-Tenant-Id no header
        updateAgent(updatedAgent);
        
        // Pequena pausa para garantir que localStorage foi atualizado
        await new Promise(r => setTimeout(r, 100));

        // Verifica se o onboarding está bloqueando o acesso
        // Usa GET /onboarding/check que consolida todas as verificações obrigatórias
        try {
          logger.debug('[Login] Verificando onboarding para o tenant', { tenantId: tenant.id });
          const onboardingCheck = await getOnboardingCheck();
          logger.debug('[Login] Onboarding check', {
            blocking: !!onboardingCheck?.blocking,
            missingSteps: onboardingCheck?.missingSteps || [],
          });

          if (onboardingCheck?.blocking) {
            const missingPreview = (onboardingCheck.missingSteps || []).join(', ');
            logger.debug('[Login] Onboarding bloqueado. Steps pendentes', { missingSteps: missingPreview });

            setIsSuperAdminLogin(false);
            setShowTenantModal(false);

            showToast(
              'Configure os itens obrigatórios do onboarding para continuar.',
              'warning',
              8000
            );

            requestAnimationFrame(() => {
              setTimeout(() => {
                try {
                  navigate(`/onboarding?source=login&tenant=${encodeURIComponent(tenant.id)}`);
                } catch (_) {
                  const basePath = getBasePath() || '';
                  window.location.href = `${basePath}/onboarding?source=login&tenant=${encodeURIComponent(tenant.id)}`;
                }
              }, 300);
            });
            return;
          }
        } catch (err) {
          logger.warn('Erro ao verificar onboarding, permitindo acesso', err);
          // Se falhar a verificação, permite acesso (não bloqueia por erro de rede)
        }

        logger.debug('[Login] Onboarding check passou, continuando para /workspace');

        // Marca que não é mais login de super-admin (tenant foi selecionado)
        setIsSuperAdminLogin(false);
        
        // Fecha o modal
        setShowTenantModal(false);
        
        showToast(`Acessando tenant: ${tenant.name || tenant.id}`, 'success');
        
        // Aguarda um pouco mais para garantir que o estado foi atualizado antes de redirecionar
        // Usa requestAnimationFrame para garantir que o React processou a atualização do estado
        requestAnimationFrame(() => {
          setTimeout(() => {
            logger.debug('[Login] Redirecionando para /workspace após seleção do tenant', {
              isAuthenticated,
              hasAgent: !!agent,
              tenantId: agent?.tenantId,
            });
            
            // Força o redirecionamento usando window.location se navigate não funcionar
            try {
              navigate('/workspace');
              logger.debug('[Login] Comando navigate executado');
              
              // Verifica se o redirecionamento funcionou após um tempo
              setTimeout(() => {
                if (window.location.pathname.includes('/login')) {
                  logger.warn('[Login] Ainda em /login após navigate, tentando window.location');
                  const basePath = window.location.pathname.split('/login')[0] || '';
                  window.location.href = `${basePath}/workspace`;
                }
              }, 500);
            } catch (err) {
              logger.error('[Login] Erro ao usar navigate, tentando window.location', err);
              const basePath = window.location.pathname.split('/login')[0] || '';
              window.location.href = `${basePath}/workspace`;
            }
          }, 300);
        });
      } else {
        // Se não há loginResult ou agent, tenta usar o agente atual do contexto
        logger.warn('[Login] loginResult ou agent não disponível, tentando usar agente do contexto');
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
            logger.debug('[Login] Redirecionando para /workspace (usando agente do contexto)');
            navigate('/workspace');
          }, 200);
        } else {
          logger.error('[Login] Não foi possível atualizar agente: loginResult e agent não disponíveis');
          showToast('Erro: informações de autenticação não disponíveis', 'error');
        }
      }
    } catch (err) {
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
        logger.warn('[Login] Falha ao limpar sessão local (ignorado)', err);
      }
      // Zera estado local do contexto para não “vazar” autenticação anterior.
      updateAgent(null);
      setLoginResult(null);

      const result = await login(username, password);
      setLoginResult(result);
      
      // Nunca logar dados de sessão/agent em produção: apenas metadados mínimos em debug
      logger.debug('[Login] Resultado do login', {
        hasAgent: !!result?.agent,
        tenantId: result?.agent?.tenantId,
        role: result?.agent?.role,
      });
      
      // Verifica se é super-admin
      // Usa a mesma lógica central do app:
      // - role 'super_admin'
      // - owner do tenant 'system' (considera originalTenantId quando aplicável)
      // - fallback por username (systemadmin)
      const isSuperAdmin = checkIsSuperAdmin(result.agent);
      
      logger.debug('[Login] É super-admin?', {
        isSuperAdmin,
        role: result.agent?.role,
        tenantId: result.agent?.tenantId,
      });

      // Lógica de redirecionamento após login:
      // 1. Super-admin: SEMPRE abre modal de seleção de tenants
      // 2. Admin normal com tenantId: redireciona direto para /workspace (sem modal)
      // 3. Outros: abre modal de seleção
      if (isSuperAdmin) {
        // Super-admin: sempre força seleção de tenant
        logger.debug('[Login] Super-admin: abrindo modal de seleção de tenant');
        setIsSuperAdminLogin(true);
        setShowTenantModal(true);
        showToast('Login realizado. Selecione o tenant para continuar.', 'info');
        setLoading(false);
      } else if (result.agent?.tenantId) {
        // Admin/usuário normal com tenantId: verifica onboarding antes de redirecionar
        logger.debug('[Login] Usuário com tenantId', { tenantId: result.agent.tenantId });
        updateAgent(result.agent);
        await new Promise(r => setTimeout(r, 100));
        
        try {
          const onboardingCheck = await getOnboardingCheck();
          logger.debug('[Login] Onboarding check', {
            blocking: !!onboardingCheck?.blocking,
            missingSteps: onboardingCheck?.missingSteps || [],
          });
          
          if (onboardingCheck?.blocking) {
            logger.debug('[Login] Onboarding bloqueado, redirecionando...');
            showToast('Configure os itens obrigatórios do onboarding para continuar.', 'warning', 8000);
            setLoading(false);
            setTimeout(() => navigate('/onboarding?source=login'), 100);
            return;
          }
        } catch (err) {
          logger.warn('[Login] Erro ao verificar onboarding, continuando', err);
        }
        
        logger.debug('[Login] Redirecionando para /workspace');
        showToast('Login realizado com sucesso!', 'success');
        setLoading(false);
        setTimeout(() => navigate('/workspace'), 100);
      } else {
        // Admin sem tenantId: precisa selecionar
        logger.debug('[Login] Admin sem tenantId: abrindo modal de seleção');
        setIsSuperAdminLogin(false);
        setShowTenantModal(true);
        showToast('Login realizado. Selecione o tenant para continuar.', 'info');
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
    <div className="shell-centered">
      {/* Background decorativo */}
      <div
        className="decorative-bg"
        style={{
          background: isDark
            ? 'radial-gradient(circle at 20% 50%, rgba(94, 106, 210, 0.1) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(139, 92, 246, 0.08) 0%, transparent 50%)'
            : 'radial-gradient(circle at 20% 50%, rgba(94, 106, 210, 0.05) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(139, 92, 246, 0.03) 0%, transparent 50%)',
        }}
      />

      {/* Seletor de tema no canto superior direito */}
      <button
        onClick={toggleTheme}
        className="login-theme-toggle"
      >
        <span>{isDark ? '☀️' : '🌙'}</span>
        <span>{isDark ? 'Claro' : 'Escuro'}</span>
      </button>

      <div
        className="shell-card"
        style={{
          boxShadow: isDark
            ? '0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)'
            : '0 20px 60px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.05)',
        }}
      >
        {/* Logo/Ícone */}
        <div className="login-branding">
          <div className="login-logo-wrapper">
            <img 
              src={getStaticUrl("/images/home_results_29.png")} 
              alt="Results Logo"
              className="login-logo-img"
            />
          </div>
          <h1 className="login-title">Login de Agente</h1>
          <p className="login-subtitle">Acesse o sistema de atendimento</p>
        </div>

        {error && (
          <div className="login-error-box">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="login-field">
            <label className="form-label">Username</label>
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
              className={`login-input ${focusedField === 'username' ? 'login-input--focused' : ''}`}
            />
          </div>

          <div className="login-field">
            <label className="form-label">Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setFocusedField('password')}
              onBlur={() => setFocusedField(null)}
              required
              autoComplete="current-password"
              placeholder="Digite sua senha"
              className={`login-input ${focusedField === 'password' ? 'login-input--focused' : ''}`}
            />
          </div>

          <Button
            type="submit"
            disabled={loading || !username || !password}
            className="login-submit-btn"
          >
            {loading ? (
              <>
                <span className="mr-2">⏳</span>
                Entrando...
              </>
            ) : (
              <>
                <span className="mr-2">→</span>
                Entrar
              </>
            )}
          </Button>
        </form>

        <div className="login-info-box">
          <div className="login-info-header">
            <span>ℹ️</span>
            <span>Primeiro acesso?</span>
          </div>
          <p className="login-info-text">
            Crie sua conta para configurar seu ambiente.
          </p>

          <div className="login-register-row">
            <span className="text-muted">Ainda nao tem conta?</span>
            <button
              type="button"
              onClick={() => navigate('/saas/signup')}
              className="login-register-btn"
            >
              Criar conta SaaS
            </button>
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
          logger.debug('[Login] Modal fechado sem selecionar tenant - fazendo logout');
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
