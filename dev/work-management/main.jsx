import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import WorkManagementApp from './App.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import {
  clearSession,
  getTenant,
  getToken,
  getUsername,
  saveSession,
  setUnauthorizedHandler,
} from './services/api/client.js';

// O App foi desenhado para ser montado pela plataforma sob /dev/work-management.
// Standalone, usamos hash routing preservando o mesmo contrato de
// currentPath/navigate que a ponte da plataforma fornecia.
const BASE_PATH = '/dev/work-management';

function pathFromHash() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash || hash === '/') return BASE_PATH;
  return `${BASE_PATH}${hash.startsWith('/') ? hash : `/${hash}`}`;
}

function navigate(path) {
  const target = String(path || BASE_PATH);
  const hash = target.startsWith(BASE_PATH) ? target.slice(BASE_PATH.length) : target;
  window.location.hash = hash || '/';
}

function StandaloneRoot() {
  const [currentPath, setCurrentPath] = useState(pathFromHash);
  const [token, setToken] = useState(getToken);

  useEffect(() => {
    const onHashChange = () => setCurrentPath(pathFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    // 401 em qualquer chamada da API derruba a sessão e volta para o login.
    setUnauthorizedHandler(() => setToken(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  function handleLogin(session) {
    saveSession(session);
    setToken(session.token);
  }

  function handleLogout() {
    clearSession();
    setToken(null);
  }

  if (!token) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <>
      <div className="wm-session-bar">
        <span>
          {getUsername()} · tenant {getTenant()}
        </span>
        <button type="button" className="wm-button wm-button-secondary" onClick={handleLogout}>
          Sair
        </button>
      </div>
      <WorkManagementApp key={token} currentPath={currentPath} navigate={navigate} />
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <StandaloneRoot />
  </React.StrictMode>
);
