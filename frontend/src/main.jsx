import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { EditorProvider } from './state/editorStore';
import { ThemeProvider } from './styles/themeContext';
import { AuthProvider, useAuth } from './context/authContext';
import { FlowEditorPage } from './pages/FlowEditorPage';
import { SupportPage } from './pages/SupportPage';
import { TicketMaintenancePage } from './pages/TicketMaintenancePage';
import { ConfigPage } from './pages/ConfigPage';
import { AgentsPage } from './pages/AgentsPage';
import { AuditPage } from './pages/AuditPage';
import { DashboardPage } from './pages/DashboardPage';
import { QuickRepliesPage } from './pages/QuickRepliesPage';
import { DepartmentsPage } from './pages/DepartmentsPage';
import { BulkMessagingPage } from './pages/BulkMessagingPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { ExportPage } from './pages/ExportPage';
import { AIToolsPage } from './pages/AIToolsPage';
import { SegmentationPage } from './pages/SegmentationPage';
import { WhatsAppTemplatesPage } from './pages/WhatsAppTemplatesPage';
import { KnowledgeBasePage } from './pages/KnowledgeBasePage';
import { ProductDocsPage } from './pages/ProductDocsPage';
import { RAGDocumentsPage } from './pages/RAGDocumentsPage';
import { WebScrapingPage } from './pages/WebScrapingPage';
import { RpaTestPage } from './pages/RpaTestPage';
import { ChatPage } from './pages/ChatPage';
import { QaPage } from './pages/QaPage';
import { FlowRpaGeneratorPage } from './pages/FlowRpaGeneratorPage';
import { Login } from './components/Login';
import { UserMenu } from './components/UserMenu';
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
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppWithAuth />
      </AuthProvider>
    </ThemeProvider>
  );
}

function AppWithAuth() {
  const { currentPath, navigate } = useRouter();
  const { isAuthenticated, loading } = useAuth();

  // Determina qual página renderizar baseado na URL
  const isDashboard = currentPath === '/' || currentPath === '/dashboard';
  const isEditor = currentPath === '/editor' || currentPath.startsWith('/editor');
  const isSupport = currentPath === '/support' || currentPath.startsWith('/support');
  const isMaintenance = currentPath === '/maintenance' || currentPath.startsWith('/maintenance');
  const isConfig = currentPath === '/config' || currentPath.startsWith('/config');
  const isAgents = currentPath === '/agents' || currentPath.startsWith('/agents');
  const isAudit = currentPath === '/audit' || currentPath.startsWith('/audit');
  const isQuickReplies = currentPath === '/quick-replies' || currentPath.startsWith('/quick-replies');
  const isDepartments = currentPath === '/departments' || currentPath.startsWith('/departments');
  const isBulkMessaging = currentPath === '/bulk-messaging' || currentPath.startsWith('/bulk-messaging');
  const isAnalytics = currentPath === '/analytics' || currentPath.startsWith('/analytics');
  const isExport = currentPath === '/export' || currentPath.startsWith('/export');
  const isAITools = currentPath === '/ai-tools' || currentPath.startsWith('/ai-tools');
  const isSegmentation = currentPath === '/segmentation' || currentPath.startsWith('/segmentation');
  const isWhatsAppTemplates = currentPath === '/whatsapp-templates' || currentPath.startsWith('/whatsapp-templates');
  const isKnowledgeBase = currentPath === '/knowledge-base' || currentPath.startsWith('/knowledge-base');
  const isProductDocs = currentPath === '/product-docs' || currentPath.startsWith('/product-docs');
  const isRAGDocuments = currentPath === '/rag-documents' || currentPath.startsWith('/rag-documents');
  const isWebScraping = currentPath === '/web-scraping' || currentPath.startsWith('/web-scraping');
  const isRpaTest = currentPath === '/rpa-test' || currentPath.startsWith('/rpa-test');
  const isChat = currentPath === '/chat' || currentPath.startsWith('/chat');
  const isQa = currentPath === '/qa' || currentPath.startsWith('/qa');
  const isFlowRpaGenerator = currentPath === '/flow-rpa-generator' || currentPath.startsWith('/flow-rpa-generator');
  const isLogin = currentPath === '/login' || currentPath.startsWith('/login');

  // Todas as rotas requerem autenticação, exceto /login
  const publicRoutes = []; // Nenhuma rota pública além de /login

  // Se a rota não for reconhecida, redireciona para login se não autenticado, ou /dashboard se autenticado
  useEffect(() => {
    const allRoutes = [
      isDashboard, isEditor, isSupport, isMaintenance, isConfig, isAgents, isAudit,
      isQuickReplies, isDepartments, isBulkMessaging, isAnalytics, isExport,
      isAITools, isSegmentation, isWhatsAppTemplates, isKnowledgeBase, isProductDocs, isRAGDocuments, isWebScraping, isRpaTest, isChat, isQa, isFlowRpaGenerator, isLogin
    ];
    
    if (!allRoutes.some(route => route)) {
      if (isAuthenticated) {
        navigate('/dashboard');
      } else {
        navigate('/login');
      }
    }
  }, [
    isDashboard, isEditor, isSupport, isMaintenance, isConfig, isAgents, isAudit,
    isQuickReplies, isDepartments, isBulkMessaging, isAnalytics, isExport,
    isAITools, isSegmentation, isWhatsAppTemplates, isKnowledgeBase, isProductDocs, isRAGDocuments, isWebScraping, isRpaTest, isChat, isQa, isFlowRpaGenerator, isLogin, isAuthenticated, navigate
  ]);

  // Redireciona para /dashboard quando autenticado e está em rota de login
  useEffect(() => {
    if (isAuthenticated && (isLogin || currentPath === '/login')) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, isLogin, currentPath, navigate]);

  // Atualiza o título do documento baseado na rota atual
  useEffect(() => {
    const pageTitles = {
      '/': '📊 Dashboard',
      '/dashboard': '📊 Dashboard',
      '/editor': '📝 Editor de Fluxos',
      '/support': '💬 Atendimento',
      '/maintenance': '🔧 Manutenção de Tickets',
      '/config': '⚙️ Configuração do Sistema',
      '/agents': '👥 Gerenciamento de Agentes',
      '/audit': '🔍 Auditoria',
      '/quick-replies': '⚡ Respostas Rápidas',
      '/departments': '🏢 Departamentos',
      '/bulk-messaging': '📢 Disparos em Massa',
      '/analytics': '📈 Analytics & Métricas',
      '/export': '📤 Exportação de Dados',
      '/ai-tools': '🤖 Ferramentas de IA',
      '/segmentation': '🎯 Segmentação',
      '/whatsapp-templates': '💬 Templates WhatsApp Business API',
      '/knowledge-base': '🧠 Base de Conhecimento',
      '/product-docs': '📖 Documentação de Produtos',
      '/rag-documents': '📚 Gerenciamento de Documentos RAG',
      '/web-scraping': '🕷️ Raspagem de Sites',
      '/rpa-test': '🚀 Flow & RPA Generator',
      '/chat': '💬 Chat de Teste',
      '/qa': '✅ Painel de Qualidade (QA)',
      '/flow-rpa-generator': '🚀 Flow & RPA Generator',
      '/login': '🔐 Login',
    };

    // Encontra o título correspondente à rota atual
    let pageTitle = 'Chatbot Flow Editor'; // Título padrão
    
    for (const [route, title] of Object.entries(pageTitles)) {
      if (currentPath === route || (route !== '/' && currentPath.startsWith(route))) {
        pageTitle = title;
        break;
      }
    }

    document.title = pageTitle;
  }, [currentPath]);

  // Mostra loading enquanto verifica autenticação
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
      }}>
        <p>Carregando...</p>
      </div>
    );
  }

  // Todas as rotas requerem autenticação, exceto /login
  const protectedRoutes = ['/', '/editor', '/support', '/maintenance', '/config', '/agents', '/audit'];
  const isProtectedRoute = protectedRoutes.some(route => currentPath === route || currentPath.startsWith(route));
  
  // Verifica se é rota pública (apenas /login)
  const isPublicRoute = publicRoutes.some(route => currentPath === route || currentPath.startsWith(route));

  // Se está na rota de login explicitamente, mostra login
  if (isLogin) {
    return <Login />;
  }

  // Se não está autenticado, mostra login (todas as outras rotas requerem autenticação)
  if (!isAuthenticated) {
    return <Login />;
  }

  // Se chegou aqui, está autenticado OU é rota pública
  return (
    <div className="support-content-wrapper">
      <UserMenu />
      {isDashboard ? (
        <DashboardPage />
      ) : isEditor ? (
        <EditorProvider>
          <FlowEditorPage />
        </EditorProvider>
      ) : isSupport ? (
        <SupportPage />
      ) : isMaintenance ? (
        <TicketMaintenancePage />
      ) : isConfig ? (
        <ConfigPage />
      ) : isAgents ? (
        <AgentsPage />
      ) : isAudit ? (
        <AuditPage />
      ) : isQuickReplies ? (
        <QuickRepliesPage />
      ) : isDepartments ? (
        <DepartmentsPage />
      ) : isBulkMessaging ? (
        <BulkMessagingPage />
      ) : isAnalytics ? (
        <AnalyticsPage />
      ) : isExport ? (
        <ExportPage />
      ) : isAITools ? (
        <AIToolsPage />
      ) : isSegmentation ? (
        <SegmentationPage />
      ) : isWhatsAppTemplates ? (
        <WhatsAppTemplatesPage />
      ) : isKnowledgeBase ? (
        <KnowledgeBasePage />
      ) : isProductDocs ? (
        <ProductDocsPage />
      ) : isRAGDocuments ? (
        <RAGDocumentsPage />
      ) : isWebScraping ? (
        <WebScrapingPage />
      ) : isRpaTest ? (
        <RpaTestPage />
      ) : isChat ? (
        <ChatPage />
      ) : isQa ? (
        <QaPage />
      ) : isFlowRpaGenerator ? (
        <FlowRpaGeneratorPage />
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

