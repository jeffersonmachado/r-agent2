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
import { getStaticUrl } from '../utils';
import { setToken } from '../api/auth';

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

  // Redireciona automaticamente quando autenticado (exceto super-admin)
  useEffect(() => {
    if (isAuthenticated && agent && !showTenantModal) {
      const isSuperAdmin = agent.role === 'super_admin' || (agent.role === 'owner' && agent.tenantId === 'system');
      
      logger.debug('[Login] useEffect - isAuthenticated:', isAuthenticated, 'agent:', agent, 'showTenantModal:', showTenantModal);
      
      if (!isSuperAdmin) {
        // Se não é super-admin, redireciona normalmente
        logger.debug('[Login] Redirecionando para /support (não é super-admin no useEffect)');
        navigate('/support');
      }
      // Se for super-admin, o modal já foi aberto no handleSubmit
    }
  }, [isAuthenticated, agent, navigate, showTenantModal]);

  // Redireciona quando tenant for selecionado
  const handleTenantSelected = async (tenant) => {
    try {
      console.log('[Login] Tenant selecionado:', tenant);
      
      // Atualiza o tenantId do agente
      if (loginResult && loginResult.agent) {
        const updatedAgent = {
          ...loginResult.agent,
          tenantId: tenant.id,
        };
        
        console.log('[Login] Atualizando agente com novo tenantId:', updatedAgent);
        
        // Atualiza o agente no contexto de autenticação
        updateAgent(updatedAgent);
        
        // Marca que não é mais login de super-admin (tenant foi selecionado)
        setIsSuperAdminLogin(false);
        
        // Fecha o modal
        setShowTenantModal(false);
        
        showToast(`Acessando tenant: ${tenant.name || tenant.id}`, 'success');
        
        // Aguarda um pouco para garantir que o estado foi atualizado antes de redirecionar
        setTimeout(() => {
          console.log('[Login] Redirecionando para /support após seleção do tenant');
          navigate('/support');
        }, 200);
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
      const result = await login(username, password);
      setLoginResult(result);
      
      console.log('[Login] Resultado do login:', result);
      console.log('[Login] Agente recebido:', result?.agent);
      
      // Verifica se é super-admin
      const isSuperAdmin = result.agent && (
        result.agent.role === 'super_admin' || 
        (result.agent.role === 'owner' && result.agent.tenantId === 'system')
      );
      
      console.log('[Login] É super-admin?', isSuperAdmin, {
        role: result.agent?.role,
        tenantId: result.agent?.tenantId,
        agent: result.agent,
      });
      
      if (isSuperAdmin) {
        // Mostra modal de seleção de tenant
        console.log('[Login] Abrindo modal de seleção de tenant');
        setIsSuperAdminLogin(true);
        setShowTenantModal(true);
        console.log('[Login] showTenantModal definido como:', true);
        showToast('Login realizado com sucesso! Selecione o tenant.', 'success');
      } else {
        // Redireciona normalmente (não é super-admin)
        console.log('[Login] Redirecionando para /support (não é super-admin)');
        setIsSuperAdminLogin(false);
        showToast('Login realizado com sucesso!', 'success');
        // Usa setTimeout para garantir que o estado foi atualizado
        setTimeout(() => {
          navigate('/support');
        }, 100);
      }
      
      setLoading(false);
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
              }}>admin123</code>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de seleção de tenant para super-admin */}
      <TenantSelectorModal
        isOpen={showTenantModal}
        onSelect={handleTenantSelected}
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

