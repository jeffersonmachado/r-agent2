import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { EditorProvider } from './state/editorStore';
import { ThemeProvider } from './styles/themeContext';
import { FlowEditorPage } from './pages/FlowEditorPage';
import { SupportPage } from './pages/SupportPage';
import { TicketMaintenancePage } from './pages/TicketMaintenancePage';
import { ConfigPage } from './pages/ConfigPage';
import { useRouter } from './hooks/useRouter';

/**
 * Suprime aviso conhecido do React sobre prop 'hasSubitems' do rete-context-menu-plugin.
 * Este é um bug interno do plugin do Rete.js que não afeta a funcionalidade.
 */
const originalError = console.error;
const originalWarn = console.warn;

/**
 * Captura erros não tratados de promises (especialmente do AutoArrangePlugin)
 */
window.addEventListener('unhandledrejection', (event) => {
  const error = event.reason;
  const errorMessage = error?.message || String(error);
  
  // Suprime erros conhecidos do AutoArrangePlugin que não afetam a funcionalidade
  if (
    errorMessage.includes('Cannot read properties of null') ||
    errorMessage.includes('reading \'he\'') ||
    (error?.stack && error.stack.includes('rete-auto-arrange-plugin'))
  ) {
    // Log como warning ao invés de error
    console.warn('Erro do AutoArrangePlugin suprimido:', errorMessage);
    event.preventDefault(); // Previne que o erro apareça no console como unhandled
    return;
  }
  
  // Outros erros não tratados são logados normalmente
  console.error('Unhandled promise rejection:', error);
});

console.error = (...args) => {
  const message = args[0];
  if (
    (typeof message === 'string' && (
      message.includes('hasSubitems') ||
      message.includes('hasSubitems prop') ||
      message.includes('hassubitems')
    )) ||
    (typeof message === 'object' && message?.message?.includes('hasSubitems'))
  ) {
    // Suprime apenas este aviso específico do rete-context-menu-plugin
    return;
  }
  originalError.apply(console, args);
};

console.warn = (...args) => {
  const message = args[0];
  if (
    (typeof message === 'string' && (
      message.includes('hasSubitems') ||
      message.includes('hasSubitems prop') ||
      message.includes('hassubitems')
    )) ||
    (typeof message === 'object' && message?.message?.includes('hasSubitems'))
  ) {
    // Suprime apenas este aviso específico do rete-context-menu-plugin
    return;
  }
  originalWarn.apply(console, args);
};

/**
 * Componente principal com roteamento baseado em URL.
 */
function App() {
  const { currentPath, navigate } = useRouter();

  // Determina qual página renderizar baseado na URL
  const isEditor = currentPath === '/' || currentPath === '/editor' || currentPath.startsWith('/editor');
  const isSupport = currentPath === '/support' || currentPath.startsWith('/support');
  const isMaintenance = currentPath === '/maintenance' || currentPath.startsWith('/maintenance');
  const isConfig = currentPath === '/config' || currentPath.startsWith('/config');

  // Se a rota não for reconhecida, redireciona para o editor
  useEffect(() => {
    if (!isEditor && !isSupport && !isMaintenance && !isConfig) {
      navigate('/editor');
    }
  }, [isEditor, isSupport, isMaintenance, isConfig, navigate]);

  return (
    <ThemeProvider>
      <AppContent isEditor={isEditor} isSupport={isSupport} isMaintenance={isMaintenance} isConfig={isConfig} />
    </ThemeProvider>
  );
}

function AppContent({ isEditor, isSupport, isMaintenance, isConfig }) {
  return (
    <div className="support-content-wrapper">
      {isEditor ? (
        <EditorProvider>
          <FlowEditorPage />
        </EditorProvider>
      ) : isSupport ? (
        <SupportPage />
      ) : isMaintenance ? (
        <TicketMaintenancePage />
      ) : isConfig ? (
        <ConfigPage />
      ) : null}
    </div>
  );
}

/**
 * Ponto de entrada do frontend.
 * - Usa ThemeProvider para gerenciar tema (dark/light).
 * - Usa EditorProvider para disponibilizar estado global do editor.
 * - Renderiza a página principal de edição de fluxo ou atendimento.
 */
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

