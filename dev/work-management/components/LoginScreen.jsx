import React, { useState } from 'react';
import { login } from '../services/api/client.js';

// Tela de login do standalone: autentica na API real da plataforma
// (POST /auth/login?tenantId=<tenant>) e entrega a sessão ao main.jsx.
export function LoginScreen({ onLogin }) {
  const [tenant, setTenant] = useState('system');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const session = await login({ tenant, username, password });
      onLogin?.(session);
    } catch (loginError) {
      setError(loginError?.message || 'Falha ao autenticar. Verifique tenant, usuário e senha.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="wm-login-screen">
      <form className="wm-login-card" onSubmit={handleSubmit}>
        <div className="wm-overline">Results Autonomous Platform</div>
        <h1>Work Management</h1>
        <p>Entre com uma conta da plataforma para carregar dados reais de operações, QA e execuções.</p>

        <label>
          <span>Tenant</span>
          <input
            type="text"
            value={tenant}
            onChange={(event) => setTenant(event.target.value)}
            autoComplete="organization"
          />
        </label>

        <label>
          <span>Usuário</span>
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label>
          <span>Senha</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error ? <div className="wm-empty-state is-error">{error}</div> : null}

        <button type="submit" className="wm-button wm-button-primary" disabled={submitting}>
          {submitting ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

export default LoginScreen;
