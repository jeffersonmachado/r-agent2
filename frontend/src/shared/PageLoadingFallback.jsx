import React from 'react';

/**
 * Fallback leve para páginas carregadas sob demanda (React.lazy/Suspense).
 * Segue o mesmo estilo do indicador de loading de autenticação em main.jsx.
 */
export function PageLoadingFallback() {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: 'var(--rap-viewport-height, 100vh)',
      color: 'var(--color-text-secondary, #94a3b8)',
    }}>
      <p>Carregando...</p>
    </div>
  );
}
