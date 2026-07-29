import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import WorkManagementApp from './App.jsx';

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

  useEffect(() => {
    const onHashChange = () => setCurrentPath(pathFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return <WorkManagementApp currentPath={currentPath} navigate={navigate} />;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <StandaloneRoot />
  </React.StrictMode>
);
