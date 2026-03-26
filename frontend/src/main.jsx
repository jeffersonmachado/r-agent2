import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { EditorProvider } from './state/editorStore';
import { ThemeProvider } from './styles/themeContext';
import { AuthProvider, useAuth } from './context/authContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { FileUploadProvider } from './context/FileUploadContext';
import { FlowEditorPage } from './pages/FlowEditorPage';
import { BpmnEditorPage } from './pages/BpmnEditorPage';
import { SupportPage } from './pages/SupportPage';
import { InboxPage } from './pages/InboxPage';
import { TicketMaintenancePage } from './pages/TicketMaintenancePage';
import { ConfigPage } from './pages/ConfigPage';
import { AgentsPage } from './pages/AgentsPage';
import { TenantsPage } from './pages/TenantsPage';
import { SuperAdminPage } from './pages/SuperAdminPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { AuditPage } from './pages/AuditPage';
import { DashboardPage } from './pages/DashboardPage';
import { QuickRepliesPage } from './pages/QuickRepliesPage';
import { FaqManagementPage } from './pages/FaqManagementPage';
import { DepartmentsPage } from './pages/DepartmentsPage';
import { BulkMessagingPage } from './pages/BulkMessagingPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { TenantIntelligencePage } from './pages/TenantIntelligencePage';
import { SupervisorPage } from './pages/SupervisorPage';
import { RbacPage } from './pages/RbacPage';
import { MfaPage } from './pages/MfaPage';
import { WhatsAppIvrPage } from './pages/WhatsAppIvrPage';
import { WhatsAppConnectionsPage } from './pages/WhatsAppConnectionsPage';
import { DeveloperKeysPage } from './pages/DeveloperKeysPage';
import { AutomationsPage } from './pages/AutomationsPage';
import { TasksPage } from './pages/TasksPage';
import { CalendarPage } from './pages/CalendarPage';
import { SlaPoliciesPage } from './pages/SlaPoliciesPage';
import { ExportPage } from './pages/ExportPage';
import { AIToolsPage } from './pages/AIToolsPage';
import { SegmentationPage } from './pages/SegmentationPage';
import { WhatsAppTemplatesPage } from './pages/WhatsAppTemplatesPage';
import { KnowledgeBasePage } from './pages/KnowledgeBasePage';
import { ProductDocsPage } from './pages/ProductDocsPage';
import { RAGDocumentsPage } from './pages/RAGDocumentsPage';
import { WebScrapingPage } from './pages/WebScrapingPage';
import { RpaTestPage } from './pages/RpaTestPage';
import { RpaReplaysPage } from './pages/RpaReplaysPage';
import { RpaSeedsPage } from './pages/RpaSeedsPage';
import { ChatPage } from './pages/ChatPage';
import { QaPage } from './pages/QaPage';
import { GenerateSystemPage } from './pages/GenerateSystemPage';
import { SystemStatusPage } from './pages/SystemStatusPage';
import { ChannelHealthPage } from './pages/ChannelHealthPage';
import { ChannelAccountsPage } from './pages/ChannelAccountsPage';
import { PlanUsagePage } from './pages/PlanUsagePage';
import { DevDashboardPage } from './pages/DevDashboardPage';
import { PbxPage } from './pages/PbxPage';
import { PbxRoutesPage } from './pages/PbxRoutesPage';
import { PbxExtensionsPage } from './pages/PbxExtensionsPage';
import { PbxTrunksPage } from './pages/PbxTrunksPage';
import { PbxModulePage } from './pages/PbxModulePage';
import { ChatHumanoDashboardPage } from './pages/ChatHumanoDashboardPage';
import { FailedMessagesPage } from './pages/FailedMessagesPage';
import { QueuePhysicalDashboardPage } from './pages/QueuePhysicalDashboardPage';
import { MarketingPage } from './pages/MarketingPage';
import { AccessControlPage } from './pages/AccessControlPage';
import { OperationsDashboardPage } from './pages/OperationsDashboardPage';
import { FitnessStudentsPage } from './pages/FitnessStudentsPage';
import { FitnessMembershipsPage } from './pages/FitnessMembershipsPage';
import { FitnessAttendancePage } from './pages/FitnessAttendancePage';
import { BeautySchedulePage } from './pages/BeautySchedulePage';
import { BeautyCustomersPage } from './pages/BeautyCustomersPage';
import { BeautyBundlesPage } from './pages/BeautyBundlesPage';
import { VerticalOperationalDashboardPage } from './pages/VerticalOperationalDashboardPage';
import { SolutionsPage } from './pages/SolutionsPage';
import { NodeMarketplacePage } from './pages/NodeMarketplacePage';
import { SsoScimPage } from './pages/SsoScimPage';
import { BackupPage } from './pages/BackupPage';
import { StorefrontOrderPage } from './pages/StorefrontOrderPage';
import { StorefrontOrderStatusPage } from './pages/StorefrontOrderStatusPage';
import { OrdersPage } from './pages/OrdersPage';
import { KitchenPage } from './pages/KitchenPage';
import { DispatchPage } from './pages/DispatchPage';
import { KioskPage } from './pages/KioskPage';
import { PanelPage } from './pages/PanelPage';
import { StationPage } from './pages/StationPage';
import { CrmDashboardPage } from './pages/crm/CrmDashboardPage';
import { Login } from './components/Login';
import { UserMenu } from './components/UserMenu';
import { TenantGate } from './components/TenantGate';
import { PwaUpdateManager } from './components/PwaUpdateManager';
import { useRouter } from './hooks/useRouter';
import { useWebSocketAuthGuard } from './hooks/useWebSocketAuthGuard';
import { canAccessPath, isSuperAdmin as checkIsSuperAdmin } from './utils/menuPermissions';

function isFilterTitle(text = '') {
  const normalized = String(text || '').trim().toLowerCase();
  return normalized === 'filtros'
    || normalized.startsWith('filtros ')
    || normalized.startsWith('filtros da ')
    || normalized.startsWith('filtros e ');
}

function collectFilterSections(root) {
  const sections = [];
  const candidates = Array.from(root.querySelectorAll('div'));
  for (const container of candidates) {
    if (!(container instanceof HTMLElement)) continue;
    if (container.dataset.autoFilterIgnore === '1') continue;
    if (!container.className || !String(container.className).includes('bg-bg-elevated')) continue;
    if (!container.firstElementChild || container.children.length < 2) continue;

    const titleNodes = container.querySelectorAll('h1, h2, h3, h4, h5, h6, span, strong');
    let titleNode = null;
    for (const node of titleNodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (isFilterTitle(node.textContent || '')) {
        titleNode = node;
        break;
      }
    }
    if (!titleNode) continue;
    if (titleNode.closest('button')) continue;
    container.classList.add('auto-filter-section');
    sections.push(container);
  }
  return sections;
}

function applyGlobalFilterToggleState(root, sections, expanded) {
  root.dataset.autoFilterExpanded = expanded ? '1' : '0';
  for (const container of sections) {
    container.classList.toggle('auto-filter-collapsed', !expanded);
  }
  const controls = root.querySelector('.support-controls');
  if (controls instanceof HTMLElement) {
    const btn = controls.querySelector('.auto-filter-toggle-btn');
    if (btn instanceof HTMLButtonElement) {
      btn.setAttribute('aria-pressed', expanded ? 'true' : 'false');
      btn.title = expanded ? 'Ocultar filtros' : 'Mostrar filtros';
    }
  }
}

function setupAutoCollapsibleFilters(root) {
  if (!root) return;
  const sections = collectFilterSections(root);
  const controls = root.querySelector('.support-controls');
  if (!(controls instanceof HTMLElement) || sections.length === 0) return;

  const bindToggleHandler = (button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    if (button.dataset.autoFilterBound === '1') return;
    button.dataset.autoFilterBound = '1';
    button.addEventListener('click', () => {
      const expanded = root.dataset.autoFilterExpanded === '1';
      const liveSections = collectFilterSections(root);
      applyGlobalFilterToggleState(root, liveSections, !expanded);
    });
  };

  let toggleButton = controls.querySelector('.auto-filter-toggle-btn');
  if (!(toggleButton instanceof HTMLButtonElement)) {
    toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'btn-default px-4 py-2 text-sm auto-filter-toggle-btn';
    toggleButton.textContent = '🔍';
    toggleButton.setAttribute('aria-label', 'Mostrar ou ocultar filtros');
    controls.prepend(toggleButton);
  }

  bindToggleHandler(toggleButton);

  const shouldExpand = root.dataset.autoFilterExpanded === '1';
  applyGlobalFilterToggleState(root, sections, shouldExpand);
}

function enhanceSupportHeaders({ navigate, currentPath }) {
  const headers = Array.from(document.querySelectorAll('.support-header'));
  for (const header of headers) {
    if (!(header instanceof HTMLElement)) continue;
    const title = header.querySelector('h1');
    if (!(title instanceof HTMLElement)) continue;
    if (title.querySelector('.support-back-button')) continue;

    const titleContent = document.createElement('span');
    titleContent.className = 'support-header-title-text';
    while (title.firstChild) {
      titleContent.appendChild(title.firstChild);
    }

    const backButton = document.createElement('button');
    backButton.type = 'button';
    backButton.className = 'support-back-button';
    backButton.textContent = '<';
    backButton.setAttribute('aria-label', 'Voltar para a pagina anterior');
    backButton.title = 'Voltar';
    backButton.addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      navigate(currentPath === '/dashboard' ? '/support' : '/dashboard');
    });

    title.classList.add('support-header-title');
    title.replaceChildren(backButton, titleContent);
  }
}

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
        <WebSocketProvider>
          <FileUploadProvider>
            <PwaUpdateManager />
            <AppWithAuth />
          </FileUploadProvider>
        </WebSocketProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

function AppWithAuth() {
  const { currentPath, navigate } = useRouter();
  const { isAuthenticated, loading, agent } = useAuth();
  
  // Monitora falhas de autenticação do WebSocket e redireciona para login
  useWebSocketAuthGuard();
  
  const isRoute = (basePath) =>
    currentPath === basePath ||
    currentPath.startsWith(`${basePath}/`) ||
    currentPath.startsWith(`${basePath}?`);

  // Determina qual página renderizar baseado na URL
  const isStorefrontOrder = currentPath === '/storefront/order' || currentPath.startsWith('/storefront/order?');
  const isStorefrontOrderStatus = currentPath.startsWith('/storefront/order/');
  const isKiosk = isRoute('/kiosk');
  const isPanel = isRoute('/panel');
  const isStation = isRoute('/station');
  const isDashboard = currentPath === '/' || currentPath === '/dashboard';
  const isEditor = isRoute('/editor');
  const isBpmnEditor = isRoute('/bpmn-editor');
  const isSupport = isRoute('/support');
  const isInbox = isRoute('/inbox');
  const isMaintenance = isRoute('/maintenance');
  const isConfig = isRoute('/config');
  const isAgents = isRoute('/agents');
  const isTenants = isRoute('/tenants');
  const isSuperAdminPage = isRoute('/super-admin');
  const isOnboarding = isRoute('/onboarding');
  const isAudit = isRoute('/audit');
  const isQuickReplies = isRoute('/quick-replies');
  const isFaq = isRoute('/faq');
  const isDepartments = isRoute('/departments');
  const isBulkMessaging = isRoute('/bulk-messaging');
  const isAnalytics = isRoute('/analytics');
  const isTenantIntelligence = isRoute('/tenant-intelligence');
  const isSupervisor = isRoute('/supervisor');
  const isRbac = isRoute('/rbac');
  const isMfa = isRoute('/mfa');
  const isWhatsAppIvr = isRoute('/whatsapp-ivr');
  const isWhatsAppConnections = isRoute('/whatsapp-connections');
  const isDeveloperKeys = isRoute('/developer-keys');
  const isAutomations = isRoute('/automations');
  const isTasks = isRoute('/tasks');
  const isAgenda = isRoute('/agenda');
  const isSlaPolicies = isRoute('/sla-policies');
  const isExport = isRoute('/export');
  const isAITools = isRoute('/ai-tools');
  const isSegmentation = isRoute('/segmentation');
  const isWhatsAppTemplates = isRoute('/whatsapp-templates');
  const isKnowledgeBase = isRoute('/knowledge-base');
  const isProductDocs = isRoute('/product-docs');
  const isRAGDocuments = isRoute('/rag-documents');
  const isWebScraping = isRoute('/web-scraping');
  const isRpaTest = isRoute('/rpa-test');
  const isRpaReplays = isRoute('/rpa-replays');
  const isRpaSeeds = isRoute('/rpa-seeds');
  const isChat = isRoute('/chat');
  const isQa = isRoute('/qa');
  const isGenerateSystem = isRoute('/generate-system');
  const isSystemStatus = isRoute('/system-status');
  const isChannelHealth = isRoute('/channel-health');
  const isChannelAccounts = isRoute('/channel-accounts');
  const isPlanUsage = isRoute('/plan-usage');
  const isPbxExtensions = isRoute('/pbx/extensions');
  const isPbxTrunks = isRoute('/pbx/trunks');
  const isPbxRoutes = isRoute('/pbx/routes');
  const isPbxBulkProvisioning = isRoute('/pbx/provisioning-lote');
  const isPbxModule = currentPath.startsWith('/pbx/') && !isPbxExtensions && !isPbxTrunks && !isPbxRoutes && !isPbxBulkProvisioning;
  const isPbx = isRoute('/pbx');
  const isChatHumanoDashboard = isRoute('/chat-humano');
  // Suporta CRM com ou sem prefixo /r-agent2 em produção
  const isCrmDashboard = currentPath.startsWith('/crm') || currentPath.startsWith('/r-agent2/crm');
  const isFailedMessages = isRoute('/failed-messages');
  const isQueuePhysicalDashboard = isRoute('/fila-fisica');
  const isDevDashboard = isRoute('/dev') || isRoute('/dev-dashboard');
  const isOrders = isRoute('/orders');
  const isKitchen = isRoute('/kitchen');
  const isDispatch = isRoute('/dispatch');
  const isMarketing = isRoute('/marketing');
  const isAccessControl = isRoute('/access-control');
  const isOperationsDashboard = isRoute('/operations-dashboard');
  const isFitnessStudents = isRoute('/fitness/students');
  const isFitnessMemberships = isRoute('/fitness/memberships');
  const isFitnessAttendance = isRoute('/fitness/attendance');
  const isBeautySchedule = isRoute('/beauty/schedule');
  const isBeautyCustomers = isRoute('/beauty/customers');
  const isBeautyBundles = isRoute('/beauty/bundles');
  const isVerticalDashboard = isRoute('/vertical/dashboard');
  const isSolutions = isRoute('/solutions');
  const isNodeMarketplace = isRoute('/node-marketplace');
  const isSsoScim = isRoute('/sso-scim');
  const isBackup = isRoute('/backup');
  const isLogin = isRoute('/login');

  // Verifica se é Super Admin usando a função completa que considera originalTenantId
  const isSuperAdmin = checkIsSuperAdmin(agent);

  // Rotas públicas (sem login): Storefront v1
  const publicRoutes = ['/storefront', '/kiosk', '/panel', '/station']; // além de /login

  // Se a rota não for reconhecida, redireciona para login se não autenticado, ou /dashboard se autenticado
  useEffect(() => {
    // Aguarda o loading terminar antes de verificar rotas
    if (loading) return;
    
    const allRoutes = [
      isStorefrontOrder, isStorefrontOrderStatus,
      isKiosk, isPanel, isStation,
      isDashboard, isEditor, isBpmnEditor, isSupport, isInbox, isMaintenance, isConfig, isAgents, isTenants, isSuperAdminPage, isOnboarding, isAudit,
      isQuickReplies, isFaq, isDepartments, isBulkMessaging, isAnalytics, isTenantIntelligence, isSupervisor, isRbac, isMfa, isWhatsAppIvr, isWhatsAppConnections, isDeveloperKeys, isAutomations, isTasks, isAgenda, isSlaPolicies, isExport,
      isAITools, isSegmentation, isWhatsAppTemplates, isKnowledgeBase, isProductDocs, isRAGDocuments, isWebScraping, isRpaTest, isRpaReplays, isRpaSeeds, isChat, isQa, isGenerateSystem, isSystemStatus, isChannelHealth, isChannelAccounts, isPlanUsage, isPbxExtensions, isPbxTrunks, isPbxRoutes, isPbxModule, isPbx, isChatHumanoDashboard, isCrmDashboard, isFailedMessages, isQueuePhysicalDashboard, isDevDashboard,
      isMarketing, isAccessControl, isSolutions, isNodeMarketplace, isSsoScim, isBackup,
      isOperationsDashboard, isFitnessStudents, isFitnessMemberships, isFitnessAttendance, isBeautySchedule, isBeautyCustomers, isBeautyBundles, isVerticalDashboard,
      isOrders, isKitchen, isDispatch,
      isLogin
    ];
    
    if (!allRoutes.some(route => route)) {
      if (isAuthenticated) {
        navigate('/support');
      } else {
        navigate('/login');
      }
    }
  }, [
    isDashboard, isEditor, isBpmnEditor, isSupport, isInbox, isMaintenance, isConfig, isAgents, isTenants, isSuperAdminPage, isOnboarding, isAudit,
    isQuickReplies, isFaq, isDepartments, isBulkMessaging, isAnalytics, isTenantIntelligence, isSupervisor, isRbac, isMfa, isWhatsAppIvr, isWhatsAppConnections, isDeveloperKeys, isAutomations, isTasks, isAgenda, isSlaPolicies, isExport,
    isAITools, isSegmentation, isWhatsAppTemplates, isKnowledgeBase, isProductDocs, isRAGDocuments, isWebScraping, isRpaTest, isRpaReplays, isRpaSeeds, isChat, isQa, isGenerateSystem, isSystemStatus, isChannelHealth, isChannelAccounts, isPlanUsage, isPbxExtensions, isPbxTrunks, isPbxRoutes, isPbxModule, isPbx, isChatHumanoDashboard, isCrmDashboard, isFailedMessages, isQueuePhysicalDashboard, isDevDashboard,
    isOrders, isKitchen, isDispatch, isMarketing, isAccessControl, isOperationsDashboard, isFitnessStudents, isFitnessMemberships, isFitnessAttendance, isBeautySchedule, isBeautyCustomers, isBeautyBundles, isVerticalDashboard, isSolutions, isNodeMarketplace, isSsoScim, isBackup, isLogin, isAuthenticated, navigate, loading, currentPath
  ]);

  // NÃO redireciona automaticamente quando autenticado na rota de login
  // Deixa o componente Login fazer o redirecionamento após seleção do tenant (para super-admin)
  // ou imediatamente (para outros usuários)
  // useEffect removido para permitir que Login.jsx controle o redirecionamento

  // Atualiza o título do documento baseado na rota atual
  useEffect(() => {
    const pageTitles = {
      '/': '📊 Dashboard',
      '/dashboard': '📊 Dashboard',
      '/editor': '📝 Editor de Fluxos',
      '/bpmn-editor': '📐 Editor BPMN',
      '/support': '💬 Atendimento',
      '/inbox': '📥 Inbox',
      '/maintenance': '🔧 Manutenção de Tickets',
      '/config': '⚙️ Configuração do Sistema',
      '/agents': '👥 Gerenciamento de Agentes',
      '/tenants': '🏢 Gerenciamento de Tenants',
      '/audit': '🔍 Auditoria',
      '/quick-replies': '⚡ Respostas Rápidas',
      '/faq': '❓ FAQ',
      '/departments': '🏢 Departamentos',
      '/bulk-messaging': '📢 Disparos em Massa',
      '/analytics': '📈 Analytics & Métricas',
      '/tenant-intelligence': '🧠 Tenant Intelligence',
      '/supervisor': '🧭 Painel Supervisor',
      '/rbac': '🔐 RBAC',
      '/mfa': '🔐 MFA',
      '/whatsapp-ivr': '💬 URA WhatsApp',
      '/whatsapp-connections': '📱 WhatsApp QR',
      '/developer-keys': '🔑 API Keys',
      '/automations': '🧩 Automações',
      '/tasks': '✅ Tarefas',
      '/agenda': '📅 Agenda',
      '/sla-policies': '⏱️ SLA',
      '/export': '📤 Exportação de Dados',
      '/ai-tools': '🤖 Ferramentas de IA',
      '/segmentation': '🎯 Segmentação',
      '/whatsapp-templates': '💬 Templates WhatsApp Business API',
      '/knowledge-base': '🧠 Base de Conhecimento',
      '/product-docs': '📖 Documentação de Produtos',
      '/rag-documents': '📚 Gerenciamento de Documentos RAG',
      '/web-scraping': '🕷️ Raspagem de Sites',
      '/rpa-test': '🚀 Execução de Testes RPA',
      '/rpa-replays': '📋 Replays RPA',
      '/rpa-seeds': '🌱 Seeds RPA',
      '/chat': '💬 Chat de Teste',
      '/qa': '✅ Painel de Qualidade (QA)',
      '/generate-system': '🎯 Gerar Sistema / Fluxo / RPA / Seed',
      '/system-status': '📊 Status dos Serviços',
      '/channel-health': '📡 Saúde de Canais',
      '/channel-accounts': '🔌 Canais',
      '/plan-usage': '📦 Plano e Uso',
      '/pbx': '📞 PBX',
      '/pbx/extensions': '📞 PBX • Ramais',
      '/pbx/trunks': '🌐 PBX • Troncos',
      '/pbx/routes': '🧭 PBX • Rotas',
      '/pbx/acls': '🛡️ PBX • ACLs',
      '/pbx/dids': '📥 PBX • DIDs',
      '/pbx/ivr': '🎛️ PBX • IVR',
      '/pbx/queues': '📞 PBX • Filas',
      '/pbx/queue-members': '👥 PBX • Membros de Filas',
      '/pbx/dialplan': '🔀 PBX • Dialplan',
      '/pbx/media': '🎵 PBX • Mídia',
      '/pbx/recordings': '🎙️ PBX • Gravações',
      '/pbx/cdr': '📄 PBX • CDR',
      '/pbx/governance': '🏢 PBX • Governança',
      '/pbx/cc/pause-reasons': '⏸️ PBX • Motivos de Pausa',
      '/pbx/cc/contact-reasons': '🏷️ PBX • Motivos de Contato',
      '/pbx/cc/campaigns': '📢 PBX • Campanhas',
      '/pbx/cc/campaign-list': '📋 PBX • Lista de Campanha',
      '/pbx/cc/callbacks': '📅 PBX • Callbacks',
      '/pbx/cc/click2call': '📱 PBX • Click2Call',
      '/pbx/referencia/xml': '🗄️ PBX • Referência XML',
      '/chat-humano': '💬 Dashboard Chat Humano',
      '/crm': '📊 CRM • Dashboard',
      '/crm/dashboard': '📊 CRM • Dashboard',
      '/crm/accounts': '🏢 CRM • Contas',
      '/crm/contacts': '👥 CRM • Contatos',
      '/crm/leads': '🎯 CRM • Leads',
      '/crm/pipelines': '🛣️ CRM • Pipelines',
      '/crm/opportunities': '💼 CRM • Oportunidades',
      '/crm/activities': '📝 CRM • Atividades',
      '/crm/analytics': '📈 CRM • Analytics',
      '/crm/reports': '📋 CRM • Relatórios',
      '/crm/campaigns': '📣 CRM • Campanhas',
      '/crm/webhooks': '🪝 CRM • Webhooks',
      '/crm/rbac': '🔐 CRM • RBAC',
      '/crm/audit': '🔍 CRM • Auditoria',
      '/failed-messages': '🚨 Mensagens Falhadas',
      '/fila-fisica': '🎫 Dashboard Fila Física',
      '/marketing': '🧲 Marketing',
      '/access-control': '🚪 Access Control',
      '/operations-dashboard': '🧭 Painel Operacional',
      '/fitness/students': '🏋️ Fitness • Students',
      '/fitness/memberships': '🏋️ Fitness • Memberships',
      '/fitness/attendance': '🏋️ Fitness • Attendance',
      '/beauty/schedule': '💄 Beauty • Schedule',
      '/beauty/customers': '💄 Beauty • Customers',
      '/beauty/bundles': '💄 Beauty • Bundles',
      '/vertical/dashboard': '📊 Vertical Dashboard',
      '/solutions': '📦 Solutions Packs',
      '/node-marketplace': '🧩 Node Marketplace',
      '/sso-scim': '🔐 SSO / SCIM',
      '/backup': '🗄️ Backup / DR',
      '/dev': '🛠️ Dashboard de Desenvolvimento',
      '/dev-dashboard': '🛠️ Dashboard de Desenvolvimento',
      '/login': '🔐 Login',
    };

    // Encontra o título mais específico correspondente à rota atual
    let pageTitle = 'Chatbot Flow Editor';
    let bestMatchLength = -1;

    const normalizedPath = currentPath.startsWith('/r-agent2')
      ? (currentPath.replace(/^\/r-agent2/, '') || '/')
      : currentPath;

    for (const [route, title] of Object.entries(pageTitles)) {
      const matches = normalizedPath === route || (route !== '/' && normalizedPath.startsWith(route));
      if (!matches) continue;
      if (route.length > bestMatchLength) {
        pageTitle = title;
        bestMatchLength = route.length;
      }
    }

    document.title = pageTitle;
  }, [currentPath]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const root = document.querySelector('.support-content-wrapper');
    if (!(root instanceof HTMLElement)) return;

    setupAutoCollapsibleFilters(root);
    const observer = new MutationObserver(() => {
      setupAutoCollapsibleFilters(root);
      enhanceSupportHeaders({ navigate, currentPath });
    });
    observer.observe(root, { childList: true, subtree: true });
    enhanceSupportHeaders({ navigate, currentPath });
    return () => observer.disconnect();
  }, [isAuthenticated, currentPath, navigate]);

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
  const protectedRoutes = ['/', '/editor', '/bpmn-editor', '/support', '/inbox', '/maintenance', '/config', '/agents', '/tenants', '/audit', '/system-status', '/channel-health', '/channel-accounts', '/plan-usage', '/pbx', '/chat-humano', '/fila-fisica', '/quick-replies', '/faq', '/marketing', '/access-control', '/operations-dashboard', '/fitness', '/beauty', '/vertical/dashboard', '/solutions', '/node-marketplace', '/sso-scim', '/backup', '/analytics', '/tenant-intelligence', '/supervisor', '/rbac', '/mfa', '/whatsapp-ivr', '/whatsapp-connections', '/developer-keys', '/automations', '/tasks', '/agenda', '/sla-policies'];
  const isProtectedRoute = protectedRoutes.some(route => currentPath === route || currentPath.startsWith(route));
  
  // Verifica se é rota pública (apenas /login)
  const isPublicRoute = publicRoutes.some(route => currentPath === route || currentPath.startsWith(route));

  // Se está na rota de login explicitamente, mostra login
  if (isLogin) {
    return <Login />;
  }

  // Rotas públicas (storefront) não exigem autenticação
  if (!isAuthenticated && !isPublicRoute) {
    return <Login />;
  }

  // Render público (sem menu/gate)
  if (isPublicRoute) {
    if (isStorefrontOrder) return <StorefrontOrderPage />;
    if (isStorefrontOrderStatus) return <StorefrontOrderStatusPage />;
    if (isKiosk) return <KioskPage />;
    if (isPanel) return <PanelPage />;
    if (isStation) return <StationPage />;
    // fallback
    return <StorefrontOrderPage />;
  }

  // Guardas de acesso por módulo/ação (RBAC) para evitar bypass por URL direta.
  const hasRouteAccess = canAccessPath(agent, currentPath);
  if (!hasRouteAccess) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2 style={{ color: '#ef4444', marginBottom: '1rem' }}>Acesso Negado</h2>
        <p style={{ color: '#6b7280', marginBottom: '1rem' }}>
          Seu perfil não possui permissão para acessar este módulo.
        </p>
        <button
          onClick={() => navigate('/support')}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#3b82f6',
            color: '#ffffff',
            border: 'none',
            borderRadius: '0.375rem',
            cursor: 'pointer',
          }}
        >
          Voltar para Atendimento
        </button>
      </div>
    );
  }

  // Se chegou aqui, está autenticado OU é rota pública
  return (
    <div className="support-content-wrapper">
      <UserMenu />
      <TenantGate />
      {isDashboard ? (
        <DashboardPage />
      ) : isEditor ? (
        <EditorProvider>
          <FlowEditorPage />
        </EditorProvider>
      ) : isBpmnEditor ? (
        <BpmnEditorPage />
      ) : isSupport ? (
        <SupportPage />
      ) : isInbox ? (
        <InboxPage />
      ) : isMaintenance ? (
        <TicketMaintenancePage />
      ) : isConfig ? (
        <ConfigPage />
      ) : isAgents ? (
        <AgentsPage />
      ) : isTenants ? (
        <TenantsPage />
      ) : isSuperAdminPage ? (
        <SuperAdminPage />
      ) : isOnboarding ? (
        <OnboardingPage />
      ) : isAudit ? (
        <AuditPage />
      ) : isQuickReplies ? (
        <QuickRepliesPage />
      ) : isFaq ? (
        <FaqManagementPage />
      ) : isDepartments ? (
        <DepartmentsPage />
      ) : isBulkMessaging ? (
        <BulkMessagingPage />
      ) : isAnalytics ? (
        <AnalyticsPage />
      ) : isTenantIntelligence ? (
        <TenantIntelligencePage />
      ) : isSupervisor ? (
        <SupervisorPage />
      ) : isRbac ? (
        <RbacPage />
      ) : isMfa ? (
        <MfaPage />
      ) : isWhatsAppIvr ? (
        <WhatsAppIvrPage />
      ) : isWhatsAppConnections ? (
        <WhatsAppConnectionsPage />
      ) : isDeveloperKeys ? (
        <DeveloperKeysPage />
      ) : isAutomations ? (
        <AutomationsPage />
      ) : isTasks ? (
        <TasksPage />
      ) : isAgenda ? (
        <CalendarPage />
      ) : isSlaPolicies ? (
        <SlaPoliciesPage />
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
      ) : isRpaReplays ? (
        <RpaReplaysPage />
      ) : isRpaSeeds ? (
        <RpaSeedsPage />
      ) : isChat ? (
        <ChatPage />
      ) : isQa ? (
        <QaPage />
      ) : isGenerateSystem ? (
        <GenerateSystemPage />
      ) : isSystemStatus ? (
        <SystemStatusPage />
      ) : isChannelHealth ? (
        <ChannelHealthPage />
      ) : isChannelAccounts ? (
        <ChannelAccountsPage />
      ) : isPlanUsage ? (
        <PlanUsagePage />
      ) : isPbxExtensions ? (
        <PbxExtensionsPage />
      ) : isPbxTrunks ? (
        <PbxTrunksPage />
      ) : isPbxRoutes ? (
        <PbxRoutesPage />
      ) : isPbxModule ? (
        <PbxModulePage />
      ) : isPbx ? (
        <PbxPage />
      ) : isChatHumanoDashboard ? (
        <ChatHumanoDashboardPage />
      ) : isCrmDashboard ? (
        <CrmDashboardPage />
      ) : isFailedMessages ? (
        <FailedMessagesPage />
      ) : isQueuePhysicalDashboard ? (
        <QueuePhysicalDashboardPage />
      ) : isOrders ? (
        <OrdersPage />
      ) : isKitchen ? (
        <KitchenPage />
      ) : isDispatch ? (
        <DispatchPage />
      ) : isMarketing ? (
        <MarketingPage />
      ) : isAccessControl ? (
        <AccessControlPage />
      ) : isOperationsDashboard ? (
        <OperationsDashboardPage />
      ) : isFitnessStudents ? (
        <FitnessStudentsPage />
      ) : isFitnessMemberships ? (
        <FitnessMembershipsPage />
      ) : isFitnessAttendance ? (
        <FitnessAttendancePage />
      ) : isBeautySchedule ? (
        <BeautySchedulePage />
      ) : isBeautyCustomers ? (
        <BeautyCustomersPage />
      ) : isBeautyBundles ? (
        <BeautyBundlesPage />
      ) : isVerticalDashboard ? (
        <VerticalOperationalDashboardPage />
      ) : isSolutions ? (
        <SolutionsPage />
      ) : isNodeMarketplace ? (
        <NodeMarketplacePage />
      ) : isSsoScim ? (
        <SsoScimPage />
      ) : isBackup ? (
        <BackupPage />
      ) : isDevDashboard ? (
        // Rota /dev só é acessível por super-admin
        isSuperAdmin ? (
          <DevDashboardPage />
        ) : (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <h2 style={{ color: '#ef4444', marginBottom: '1rem' }}>Acesso Negado</h2>
            <p style={{ color: '#6b7280', marginBottom: '1rem' }}>
              Apenas super-admins podem acessar o Dashboard de Desenvolvimento.
            </p>
            <button
              onClick={() => navigate('/support')}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#3b82f6',
                color: '#ffffff',
                border: 'none',
                borderRadius: '0.375rem',
                cursor: 'pointer',
              }}
            >
              Voltar para Atendimento
            </button>
          </div>
        )
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
