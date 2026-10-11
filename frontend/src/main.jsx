import React, { Suspense, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { EditorProvider } from './state/editorStore';
import { ThemeProvider } from './styles/themeContext';
import { AuthProvider, useAuth } from './context/authContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { FileUploadProvider } from './context/FileUploadContext';
// Páginas públicas do primeiro paint ficam estáticas (login + landing SaaS);
// todas as demais são carregadas sob demanda via React.lazy (code splitting por rota).
import { SaasPublicPage } from './pages/SaasPublicPage';
import { PageLoadingFallback } from './shared/PageLoadingFallback';
import { Login } from './components/Login';

/**
 * Helper para React.lazy com named export (padrão das páginas do projeto).
 */
const lazyPage = (loader, exportName) =>
  React.lazy(() => loader().then((module) => ({ default: module[exportName] })));

const FlowEditorPage = lazyPage(() => import('./pages/FlowEditorPage'), 'FlowEditorPage');
const BpmnEditorPage = lazyPage(() => import('./pages/BpmnEditorPage'), 'BpmnEditorPage');
const SupportPage = lazyPage(() => import('./pages/SupportPage'), 'SupportPage');
const InboxPage = lazyPage(() => import('./pages/InboxPage'), 'InboxPage');
const CasesPage = lazyPage(() => import('./pages/CasesPage'), 'CasesPage');
const PlatformSupportPage = lazyPage(() => import('./pages/PlatformSupportPage'), 'PlatformSupportPage');
const TicketMaintenancePage = lazyPage(() => import('./pages/TicketMaintenancePage'), 'TicketMaintenancePage');
const ConfigPage = lazyPage(() => import('./pages/ConfigPage'), 'ConfigPage');
const AgentsPage = lazyPage(() => import('./pages/AgentsPage'), 'AgentsPage');
const TenantsPage = lazyPage(() => import('./pages/TenantsPage'), 'TenantsPage');
const SuperAdminPage = lazyPage(() => import('./pages/SuperAdminPage'), 'SuperAdminPage');
const OnboardingPage = lazyPage(() => import('./pages/OnboardingPage'), 'OnboardingPage');
const AuditPage = lazyPage(() => import('./pages/AuditPage'), 'AuditPage');
const DashboardPage = lazyPage(() => import('./pages/DashboardPage'), 'DashboardPage');
const QuickRepliesPage = lazyPage(() => import('./pages/QuickRepliesPage'), 'QuickRepliesPage');
const FaqManagementPage = lazyPage(() => import('./pages/FaqManagementPage'), 'FaqManagementPage');
const DepartmentsPage = lazyPage(() => import('./pages/DepartmentsPage'), 'DepartmentsPage');
const BulkMessagingPage = lazyPage(() => import('./pages/BulkMessagingPage'), 'BulkMessagingPage');
const AnalyticsPage = lazyPage(() => import('./pages/AnalyticsPage'), 'AnalyticsPage');
const AcademyPage = lazyPage(() => import('./pages/AcademyPage'), 'AcademyPage');
const TenantIntelligencePage = lazyPage(() => import('./pages/TenantIntelligencePage'), 'TenantIntelligencePage');
const SupervisorPage = lazyPage(() => import('./pages/SupervisorPage'), 'SupervisorPage');
const RbacPage = lazyPage(() => import('./pages/RbacPage'), 'RbacPage');
const MfaPage = lazyPage(() => import('./pages/MfaPage'), 'MfaPage');
const WhatsAppIvrPage = lazyPage(() => import('./pages/WhatsAppIvrPage'), 'WhatsAppIvrPage');
const WhatsAppConnectionsPage = lazyPage(() => import('./pages/WhatsAppConnectionsPage'), 'WhatsAppConnectionsPage');
const DeveloperKeysPage = lazyPage(() => import('./pages/DeveloperKeysPage'), 'DeveloperKeysPage');
const AutomationsPage = lazyPage(() => import('./pages/AutomationsPage'), 'AutomationsPage');
const TasksPage = lazyPage(() => import('./pages/TasksPage'), 'TasksPage');
const CalendarPage = lazyPage(() => import('./pages/CalendarPage'), 'CalendarPage');
const ProjectsPage = lazyPage(() => import('./pages/projects/ProjectsPage'), 'ProjectsPage');
const ProjectBoardPage = lazyPage(() => import('./pages/projects/ProjectBoardPage'), 'ProjectBoardPage');
const ProjectListPage = lazyPage(() => import('./pages/projects/ProjectListPage'), 'ProjectListPage');
const ProjectDashboardPage = lazyPage(() => import('./pages/projects/ProjectDashboardPage'), 'ProjectDashboardPage');
const ProjectTimelinePage = lazyPage(() => import('./pages/projects/ProjectTimelinePage'), 'ProjectTimelinePage');
const ProjectActivitiesPage = lazyPage(() => import('./pages/projects/ProjectActivitiesPage'), 'ProjectActivitiesPage');
const ProjectSettingsPage = lazyPage(() => import('./pages/projects/ProjectSettingsPage'), 'ProjectSettingsPage');
const ProjectGanttPage = lazyPage(() => import('./pages/projects/ProjectGanttPage'), 'ProjectGanttPage');
const ProjectCalendarViewPage = lazyPage(() => import('./pages/projects/ProjectCalendarViewPage'), 'ProjectCalendarViewPage');
const SlaPoliciesPage = lazyPage(() => import('./pages/SlaPoliciesPage'), 'SlaPoliciesPage');
const ExportPage = lazyPage(() => import('./pages/ExportPage'), 'ExportPage');
const AIToolsPage = lazyPage(() => import('./pages/AIToolsPage'), 'AIToolsPage');
const SegmentationPage = lazyPage(() => import('./pages/SegmentationPage'), 'SegmentationPage');
const WhatsAppTemplatesPage = lazyPage(() => import('./pages/WhatsAppTemplatesPage'), 'WhatsAppTemplatesPage');
const KnowledgeBasePage = lazyPage(() => import('./pages/KnowledgeBasePage'), 'KnowledgeBasePage');
const ProductDocsPage = lazyPage(() => import('./pages/ProductDocsPage'), 'ProductDocsPage');
const RAGDocumentsPage = lazyPage(() => import('./pages/RAGDocumentsPage'), 'RAGDocumentsPage');
const WebScrapingPage = lazyPage(() => import('./pages/WebScrapingPage'), 'WebScrapingPage');
const RpaTestPage = lazyPage(() => import('./pages/RpaTestPage'), 'RpaTestPage');
const RpaReplaysPage = lazyPage(() => import('./pages/RpaReplaysPage'), 'RpaReplaysPage');
const RpaSeedsPage = lazyPage(() => import('./pages/RpaSeedsPage'), 'RpaSeedsPage');
const ChatPage = lazyPage(() => import('./pages/ChatPage'), 'ChatPage');
const QaPage = lazyPage(() => import('./pages/QaPage'), 'QaPage');
const QaMeshPage = lazyPage(() => import('./pages/QaMeshPage'), 'QaMeshPage');
const StabilityPage = lazyPage(() => import('./pages/qa/StabilityPage'), 'StabilityPage');
const GenerateSystemPage = lazyPage(() => import('./pages/GenerateSystemPage'), 'GenerateSystemPage');
const SystemStatusPage = lazyPage(() => import('./pages/SystemStatusPage'), 'SystemStatusPage');
const StackVersionsPage = lazyPage(() => import('./pages/StackVersionsPage'), 'StackVersionsPage');
const ChannelHealthPage = lazyPage(() => import('./pages/ChannelHealthPage'), 'ChannelHealthPage');
const ChannelAccountsPage = lazyPage(() => import('./pages/ChannelAccountsPage'), 'ChannelAccountsPage');
const PlanUsagePage = lazyPage(() => import('./pages/PlanUsagePage'), 'PlanUsagePage');
const DevDashboardPage = lazyPage(() => import('./pages/DevDashboardPage'), 'DevDashboardPage');
const QaWavesPage = lazyPage(() => import('./pages/QaWavesPage'), 'QaWavesPage');
const EngineeringOverviewPage = lazyPage(() => import('./pages/EngineeringOverviewPage'), 'EngineeringOverviewPage');
const EngineeringTasksPage = lazyPage(() => import('./pages/EngineeringTasksPage'), 'EngineeringTasksPage');
const EngineeringTaskDetailPage = lazyPage(() => import('./pages/EngineeringTaskDetailPage'), 'EngineeringTaskDetailPage');
const EngineeringModelsPage = lazyPage(() => import('./pages/EngineeringModelsPage'), 'EngineeringModelsPage');
const EngineeringReleaseClosurePage = lazyPage(() => import('./pages/EngineeringReleaseClosurePage'), 'EngineeringReleaseClosurePage');
const EngineeringMissionsPage = lazyPage(() => import('./pages/engineering-missions/EngineeringMissionsPage'), 'EngineeringMissionsPage');
const EngineeringFindingsPage = lazyPage(() => import('./pages/engineering-findings/EngineeringFindingsPage'), 'EngineeringFindingsPage');
const EngineeringMissionDetailPage = lazyPage(() => import('./pages/engineering-missions/EngineeringMissionDetailPage'), 'EngineeringMissionDetailPage');
const QaGapsPage = lazyPage(() => import('./pages/QaGapsPage'), 'QaGapsPage');
const BenchmarkResearchGovernancePage = lazyPage(() => import('./pages/BenchmarkResearchGovernancePage'), 'BenchmarkResearchGovernancePage');
const SecurityIntelligencePage = lazyPage(() => import('./pages/SecurityIntelligencePage'), 'SecurityIntelligencePage');
// Governança de engenharia (DEVELOPMENT): pendências de missão e release.
const DevPendenciesPage = lazyPage(() => import('./pages/DevPendenciesPage'), 'DevPendenciesPage');
const DevReleasePage = lazyPage(() => import('./pages/DevReleasePage'), 'DevReleasePage');
const QaWavesOperationalHealthPage = lazyPage(() => import('./pages/QaWavesOperationalHealthPage'), 'QaWavesOperationalHealthPage');
const QaWavesEnterpriseGovernancePage = lazyPage(() => import('./pages/QaWavesEnterpriseGovernancePage'), 'QaWavesEnterpriseGovernancePage');
const WorkspacePage = lazyPage(() => import('./pages/WorkspacePage'), 'WorkspacePage');
const PbxPage = lazyPage(() => import('./pages/PbxPage'), 'PbxPage');
const PbxRoutesPage = lazyPage(() => import('./pages/PbxRoutesPage'), 'PbxRoutesPage');
const PbxExtensionsPage = lazyPage(() => import('./pages/PbxExtensionsPage'), 'PbxExtensionsPage');
const PbxTrunksPage = lazyPage(() => import('./pages/PbxTrunksPage'), 'PbxTrunksPage');
const PbxModulePage = lazyPage(() => import('./pages/PbxModulePage'), 'PbxModulePage');
const PbxOperatorPanelPage = lazyPage(() => import('./pages/PbxOperatorPanelPage'), 'PbxOperatorPanelPage');
const ChatHumanoDashboardPage = lazyPage(() => import('./pages/ChatHumanoDashboardPage'), 'ChatHumanoDashboardPage');
const FailedMessagesPage = lazyPage(() => import('./pages/FailedMessagesPage'), 'FailedMessagesPage');
const QueuePhysicalDashboardPage = lazyPage(() => import('./pages/QueuePhysicalDashboardPage'), 'QueuePhysicalDashboardPage');
const MarketingPage = lazyPage(() => import('./pages/MarketingPage'), 'MarketingPage');
const AccessControlPage = lazyPage(() => import('./pages/AccessControlPage'), 'AccessControlPage');
const OperationsDashboardPage = lazyPage(() => import('./pages/OperationsDashboardPage'), 'OperationsDashboardPage');
const FitnessStudentsPage = lazyPage(() => import('./pages/FitnessStudentsPage'), 'FitnessStudentsPage');
const FitnessMembershipsPage = lazyPage(() => import('./pages/FitnessMembershipsPage'), 'FitnessMembershipsPage');
const FitnessAttendancePage = lazyPage(() => import('./pages/FitnessAttendancePage'), 'FitnessAttendancePage');
const BeautySchedulePage = lazyPage(() => import('./pages/BeautySchedulePage'), 'BeautySchedulePage');
const BeautyCampaignsPage = lazyPage(() => import('./pages/BeautyCampaignsPage'), 'BeautyCampaignsPage');
const BeautyLeadsPage = lazyPage(() => import('./pages/BeautyLeadsPage'), 'BeautyLeadsPage');
const BeautyCustomersPage = lazyPage(() => import('./pages/BeautyCustomersPage'), 'BeautyCustomersPage');
const BeautyBundlesPage = lazyPage(() => import('./pages/BeautyBundlesPage'), 'BeautyBundlesPage');
const BeautyServicesPage = lazyPage(() => import('./pages/BeautyServicesPage'), 'BeautyServicesPage');
const BeautyPaymentsPage = lazyPage(() => import('./pages/BeautyPaymentsPage'), 'BeautyPaymentsPage');
const VerticalOperationalDashboardPage = lazyPage(() => import('./pages/VerticalOperationalDashboardPage'), 'VerticalOperationalDashboardPage');
const SolutionsPage = lazyPage(() => import('./pages/SolutionsPage'), 'SolutionsPage');
const NodeMarketplacePage = lazyPage(() => import('./pages/NodeMarketplacePage'), 'NodeMarketplacePage');
const SsoScimPage = lazyPage(() => import('./pages/SsoScimPage'), 'SsoScimPage');
const BackupPage = lazyPage(() => import('./pages/BackupPage'), 'BackupPage');
const AgentOsHubPage = lazyPage(() => import('./pages/AgentOsHubPage'), 'AgentOsHubPage');
const QaAuditPage = lazyPage(() => import('./pages/QaAuditPage'), 'QaAuditPage');
const StorefrontOrderPage = lazyPage(() => import('./pages/StorefrontOrderPage'), 'StorefrontOrderPage');
const StorefrontOrderStatusPage = lazyPage(() => import('./pages/StorefrontOrderStatusPage'), 'StorefrontOrderStatusPage');
const OrdersPage = lazyPage(() => import('./pages/OrdersPage'), 'OrdersPage');
const KitchenPage = lazyPage(() => import('./pages/KitchenPage'), 'KitchenPage');
const DispatchPage = lazyPage(() => import('./pages/DispatchPage'), 'DispatchPage');
const KioskPage = lazyPage(() => import('./pages/KioskPage'), 'KioskPage');
const PanelPage = lazyPage(() => import('./pages/PanelPage'), 'PanelPage');
const StationPage = lazyPage(() => import('./pages/StationPage'), 'StationPage');
const CrmDashboardPage = lazyPage(() => import('./pages/crm/CrmDashboardPage'), 'CrmDashboardPage');
const DemoPage = React.lazy(() => import('./pages/DemoPage'));
const DashboardV2 = lazyPage(() => import('./pages/DashboardV2'), 'DashboardV2');
import { UserMenu } from './components/UserMenu';
import { TenantGate, shouldBlockPageForTenant } from './components/TenantGate';
import { PwaUpdateManager } from './components/PwaUpdateManager';
import { BundleVersionGuard } from './components/BundleVersionGuard';
import { PrimaryRail } from './components/PrimaryRail';
import { SecondaryNav } from './components/SecondaryNav';
import { AreaHeader } from './components/AreaHeader';
import { ContextPanel } from './components/ContextPanel';
import { CommandPalette } from './components/CommandPalette';
import { TutorDock } from './components/TutorDock';
import { AskAiWidget } from './components/AskAiWidget';
import { VerticalLayout } from './components/VerticalLayout';
import { useRouter } from './hooks/useRouter';
import { useWebSocketAuthGuard } from './hooks/useWebSocketAuthGuard';
import { initInteractionTracker, stopInteractionTracker } from './core/interactionTracker';
import { canAccessPath, isSuperAdmin as checkIsSuperAdmin } from './utils/menuPermissions';
import { getFeature } from './utils/featuresConfig';
import { getTenant, getTenantContext } from './api/tenants';
import { getWorkspaceKeysForPath, inferWorkspaceKeyFromTenantProfile, verticalWorkspaces } from './navigation/menu';

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
      navigate(currentPath === '/dashboard' ? '/workspace' : '/dashboard');
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
            <BundleVersionGuard />
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
  const { isAuthenticated, loading, agent, capabilities } = useAuth();
  const [newNavigationEnabled, setNewNavigationEnabled] = React.useState(true);
  const [tenantProfile, setTenantProfile] = React.useState(null);
  const [isContextPanelOpen, setIsContextPanelOpen] = React.useState(false);
  const [isSecondaryNavCollapsed, setIsSecondaryNavCollapsed] = React.useState(false);
  
  // Monitora falhas de autenticação do WebSocket e redireciona para login
  useWebSocketAuthGuard();

  // Learning Core: telemetria de interação (feature flag learningCoreEnabled)
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let active = false;
    initInteractionTracker().then((started) => {
      active = started;
    }).catch(() => {});
    return () => {
      if (active) stopInteractionTracker();
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (typeof window === 'undefined' || !document?.documentElement) {
      return undefined;
    }

    const root = document.documentElement;
    const updateViewportHeight = () => {
      root.style.setProperty('--rap-viewport-height', `${window.innerHeight}px`);
    };

    updateViewportHeight();
    window.addEventListener('resize', updateViewportHeight, { passive: true });
    window.addEventListener('orientationchange', updateViewportHeight);

    return () => {
      window.removeEventListener('resize', updateViewportHeight);
      window.removeEventListener('orientationchange', updateViewportHeight);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    getFeature('NEW_NAVIGATION', true)
      .then((value) => {
        if (mounted) {
          setNewNavigationEnabled(Boolean(value));
        }
      })
      .catch(() => {
        if (mounted) {
          setNewNavigationEnabled(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);
  
  const isRoute = (basePath) =>
    currentPath === basePath ||
    currentPath.startsWith(`${basePath}/`) ||
    currentPath.startsWith(`${basePath}?`);

  // Determina qual página renderizar baseado na URL
  const isStorefront = currentPath === '/storefront' || currentPath.startsWith('/storefront?');
  const isStorefrontOrder = currentPath === '/storefront/order' || currentPath.startsWith('/storefront/order?');
  const isStorefrontOrderStatus = currentPath.startsWith('/storefront/order/');
  const isKiosk = isRoute('/kiosk');
  const isPanel = isRoute('/panel');
  const isStation = isRoute('/station');
  const isDashboard = currentPath === '/' || currentPath === '/dashboard';
  const isDashboardLegacy = isRoute('/dashboard-legacy');
  const isEditor = isRoute('/editor');
  const isBpmnEditor = isRoute('/bpmn-editor');
  const isSupport = isRoute('/support');
  const isWorkspace = isRoute('/workspace');
  const isInbox = isRoute('/inbox');
  const isCases = isRoute('/cases');
  const isPlatformSupport = isRoute('/platform-support');
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
  const isAcademy = isRoute('/academy');
  const isTenantIntelligence = isRoute('/tenant-intelligence');
  const isSupervisor = isRoute('/supervisor');
  const isRbac = isRoute('/rbac');
  const isMfa = isRoute('/mfa');
  const isWhatsAppIvr = isRoute('/whatsapp-ivr');
  const isWhatsAppConnections = isRoute('/whatsapp-connections');
  const isDeveloperKeys = isRoute('/developer-keys');
  const isAutomations = isRoute('/automations');
  const isProjects = isRoute('/projects');
  const isProjectList = isProjects && currentPath.endsWith('/list');
  const isProjectDashboard = isProjects && currentPath.endsWith('/dashboard');
  const isProjectTimeline = isProjects && currentPath.endsWith('/timeline');
  const isProjectActivities = isProjects && currentPath.endsWith('/activities');
  const isProjectSettings = isProjects && currentPath.endsWith('/settings');
  const isProjectGantt = isProjects && currentPath.endsWith('/gantt');
  const isProjectCalendar = isProjects && currentPath.endsWith('/calendar');
  const isProjectBoard = isProjects && !isProjectList && !isProjectDashboard && !isProjectTimeline && !isProjectActivities && !isProjectSettings && !isProjectGantt && !isProjectCalendar && currentPath !== '/projects';
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
  const isRpaTest = isRoute('/dev/rpa-test');
  const isRpaReplays = isRoute('/dev/rpa-replays');
  const isRpaReplaysAlias = isRoute('/rpa-replays');
  const isRpaSeeds = isRoute('/dev/rpa-seeds') || isRoute('/rpa-seeds'); // /rpa-seeds = alias legado
  const isChat = isRoute('/chat');
  const isQaStability = isRoute('/qa/stability');
  const isQa = isRoute('/qa');
  const isQaMesh = isRoute('/qa-mesh');
  const isGenerateSystem = isRoute('/generate-system');
  const isSystemStatus = isRoute('/dev/system-status');
  const isSystemStatusAlias = isRoute('/system-status');
  const isStackVersions = isRoute('/dev/stack-versions');
  const isChannelHealth = isRoute('/channel-health');
  const isChannelAccounts = isRoute('/channel-accounts');
  const isPlanUsage = isRoute('/plan-usage');
  const isPbxExtensions = isRoute('/pbx/extensions');
  const isPbxTrunks = isRoute('/pbx/trunks');
  const isPbxRoutes = isRoute('/pbx/routes');
  const isPbxOperatorPanel = isRoute('/pbx/operator-panel');
  const isPbxModule = currentPath.startsWith('/pbx/') && !isPbxExtensions && !isPbxTrunks && !isPbxRoutes && !isPbxOperatorPanel;
  const isPbx = isRoute('/pbx');
  const isChatHumanoDashboard = isRoute('/chat-humano');
  // Suporta CRM com ou sem prefixo /r-agent2 em produção
  const isCrmDashboard = currentPath.startsWith('/crm') || currentPath.startsWith('/r-agent2/crm');
  const isDemo = isRoute('/demo');
  const isFailedMessages = isRoute('/failed-messages');
  const isQueuePhysicalDashboard = isRoute('/fila-fisica');
  const isDevDashboard = isRoute('/dev') || isRoute('/dev-dashboard');
  const isQaWaves = isRoute('/dev/qa-waves');
  const isQaGaps = isRoute('/dev/qa-gaps');
  const isEngineeringTaskDetail = /^\/dev\/engineering\/tasks\/[^/]+\/?$/.test(currentPath);
  const isEngineeringTasks = isRoute('/dev/engineering/tasks') && !isEngineeringTaskDetail;
  const isEngineeringModels = isRoute('/dev/engineering/models');
  const isEngineeringMissionDetail = /^\/dev\/engineering\/missions\/[^/]+\/?$/.test(currentPath);
  const isEngineeringMissions = isRoute('/dev/engineering/missions') && !isEngineeringMissionDetail;
  const isEngineeringFindings = isRoute('/dev/engineering/findings');
  const isEngineeringReleaseClosure = isRoute('/dev/engineering/release-closure');
  const isEngineeringOverview = isRoute('/dev/engineering')
    && !isEngineeringTasks && !isEngineeringTaskDetail && !isEngineeringModels && !isEngineeringReleaseClosure
    && !isEngineeringMissions && !isEngineeringMissionDetail && !isEngineeringFindings;
  const isBenchmarkResearch = isRoute('/dev/benchmark-research');
  const isSecurityIntel = isRoute('/dev/security-intel');
  const isDevPendencies = isRoute('/dev/pendencies');
  const isDevRelease = isRoute('/dev/release');
  const isQaWavesOperationalHealth = isRoute('/dev/qa-waves/operational-health');
  const isQaWavesEnterpriseGovernance = isRoute('/dev/qa-waves/enterprise-governance');
  const isAgentOsHub = isRoute('/admin/agents');
  const isQaAudit = isRoute('/dev/qa-audit');
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
  const isBeautyCampaigns = isRoute('/beauty/campaigns');
  const isBeautyLeads = isRoute('/beauty/leads');
  const isBeautyCustomers = isRoute('/beauty/customers');
  const isBeautyBundles = isRoute('/beauty/bundles');
  const isBeautyServices = isRoute('/beauty/services');
  const isBeautyPayments = isRoute('/beauty/payments');
  const isVerticalDashboard = isRoute('/vertical/dashboard');
  const isSolutions = isRoute('/solutions');
  const isNodeMarketplace = isRoute('/node-marketplace');
  const isSsoScim = isRoute('/sso-scim');
  const isBackup = isRoute('/backup');
  const isLogin = isRoute('/login');
  const isSaasLanding = currentPath === '/' || currentPath === '/saas' || currentPath.startsWith('/saas?');
  const isSaasProducts = isRoute('/saas/products');
  const isSaasSolutions = isRoute('/saas/solutions');
  const isSaasPricing = isRoute('/saas/pricing');
  const isSaasSignup = isRoute('/saas/signup');

  // Verifica se é Super Admin usando a função completa que considera originalTenantId
  const isSuperAdmin = checkIsSuperAdmin(agent);

  useEffect(() => {
    if (!newNavigationEnabled || !isAuthenticated || !agent?.tenantId) {
      setTenantProfile(null);
      return undefined;
    }

    let active = true;

    Promise.allSettled([
      getTenant(agent.tenantId),
      getTenantContext(agent.tenantId),
    ])
      .then(([tenantResult, contextResult]) => {
        if (!active) return;

        setTenantProfile({
          tenant: tenantResult.status === 'fulfilled' ? tenantResult.value?.tenant || null : null,
          context: contextResult.status === 'fulfilled' ? contextResult.value?.context || null : null,
        });
      })
      .catch(() => {
        if (active) {
          setTenantProfile(null);
        }
      });

    return () => {
      active = false;
    };
  }, [agent?.tenantId, isAuthenticated, newNavigationEnabled]);

  // Rotas públicas (sem login): Storefront v1 + site SaaS
  const publicRoutes = ['/', '/saas', '/storefront', '/kiosk', '/panel', '/station']; // além de /login

  // Se a rota não for reconhecida, redireciona para login se não autenticado, ou /workspace se autenticado
  useEffect(() => {
    // Aguarda o loading terminar antes de verificar rotas
    if (loading) return;
    
    const allRoutes = [
      isStorefront, isStorefrontOrder, isStorefrontOrderStatus,
      isKiosk, isPanel, isStation,
      isDashboard, isDashboardLegacy, isEditor, isBpmnEditor, isSupport, isWorkspace, isInbox, isCases, isPlatformSupport, isMaintenance, isConfig, isAgents, isTenants, isSuperAdminPage, isOnboarding, isAudit,
      isQuickReplies, isFaq, isDepartments, isBulkMessaging, isAnalytics, isAcademy, isTenantIntelligence, isSupervisor, isRbac, isMfa, isWhatsAppIvr, isWhatsAppConnections, isDeveloperKeys, isAutomations, isProjects, isProjectBoard, isProjectList, isProjectDashboard, isProjectTimeline, isProjectActivities, isProjectSettings, isProjectGantt, isProjectCalendar, isTasks, isAgenda, isSlaPolicies, isExport,
      isAITools, isSegmentation, isWhatsAppTemplates, isKnowledgeBase, isProductDocs, isRAGDocuments, isWebScraping, isRpaTest, isRpaReplays, isRpaReplaysAlias, isRpaSeeds, isChat, isQaStability, isQa, isQaMesh, isGenerateSystem, isSystemStatus, isSystemStatusAlias, isStackVersions, isChannelHealth, isChannelAccounts, isPlanUsage, isPbxExtensions, isPbxTrunks, isPbxRoutes, isPbxOperatorPanel, isPbxModule, isPbx, isChatHumanoDashboard, isCrmDashboard, isDemo, isFailedMessages, isQueuePhysicalDashboard, isDevDashboard,
      isMarketing, isAccessControl, isSolutions, isNodeMarketplace, isSsoScim, isBackup,
      isOperationsDashboard, isFitnessStudents, isFitnessMemberships, isFitnessAttendance, isBeautySchedule, isBeautyCampaigns, isBeautyLeads, isBeautyCustomers, isBeautyBundles, isBeautyServices, isBeautyPayments, isVerticalDashboard,
      isOrders, isKitchen, isDispatch,
      isQaWaves, isQaGaps, isQaWavesOperationalHealth, isQaWavesEnterpriseGovernance, isBenchmarkResearch,
      isSecurityIntel,
      isEngineeringOverview, isEngineeringTasks, isEngineeringTaskDetail, isEngineeringModels, isEngineeringReleaseClosure,
      isEngineeringMissions, isEngineeringMissionDetail, isEngineeringFindings,
      isAgentOsHub,
      isQaAudit,
      isSaasLanding, isSaasProducts, isSaasSolutions, isSaasPricing, isSaasSignup,
      isLogin
    ];
    
    if (!allRoutes.some(route => route)) {
      if (isAuthenticated) {
        navigate('/workspace');
      } else {
        navigate('/login');
      }
    }
  }, [
    isStorefront, isStorefrontOrder, isStorefrontOrderStatus,
    isDashboard, isDashboardLegacy, isEditor, isBpmnEditor, isSupport, isWorkspace, isInbox, isCases, isPlatformSupport, isMaintenance, isConfig, isAgents, isTenants, isSuperAdminPage, isOnboarding, isAudit,
    isQuickReplies, isFaq, isDepartments, isBulkMessaging, isAnalytics, isAcademy, isTenantIntelligence, isSupervisor, isRbac, isMfa, isWhatsAppIvr, isWhatsAppConnections, isDeveloperKeys, isAutomations, isProjects, isProjectBoard, isProjectList, isProjectDashboard, isProjectTimeline, isProjectActivities, isProjectSettings, isProjectGantt, isProjectCalendar, isTasks, isAgenda, isSlaPolicies, isExport,
    isAITools, isSegmentation, isWhatsAppTemplates, isKnowledgeBase, isProductDocs, isRAGDocuments, isWebScraping, isRpaTest, isRpaReplays, isRpaSeeds, isChat, isQaStability, isQa, isQaMesh, isGenerateSystem, isSystemStatus, isStackVersions, isChannelHealth, isChannelAccounts, isPlanUsage, isPbxExtensions, isPbxTrunks, isPbxRoutes, isPbxOperatorPanel, isPbxModule, isPbx, isChatHumanoDashboard, isCrmDashboard, isDemo, isFailedMessages, isQueuePhysicalDashboard, isDevDashboard,
            isOrders, isKitchen, isDispatch, isMarketing, isAccessControl, isOperationsDashboard, isFitnessStudents, isFitnessMemberships, isFitnessAttendance, isBeautySchedule, isBeautyCampaigns, isBeautyLeads, isBeautyCustomers, isBeautyBundles, isBeautyServices, isBeautyPayments, isVerticalDashboard, isSolutions, isNodeMarketplace, isSsoScim, isBackup, isQaWaves, isQaGaps, isQaWavesOperationalHealth, isQaWavesEnterpriseGovernance, isBenchmarkResearch, isSecurityIntel, isEngineeringOverview, isEngineeringTasks, isEngineeringTaskDetail, isEngineeringModels, isEngineeringReleaseClosure, isEngineeringMissions, isEngineeringMissionDetail, isSaasLanding, isSaasProducts, isSaasSolutions, isSaasPricing, isSaasSignup, isLogin, isAuthenticated, navigate, loading, currentPath
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
      '/dashboard-legacy': '📊 Dashboard Legado',
      '/editor': '📝 Editor de Fluxos',
      '/bpmn-editor': '📐 Editor BPMN',
      '/support': '💬 Atendimento',
      '/workspace': 'RAP Workspace',
      '/inbox': '📥 Caixa de Entrada',
      '/maintenance': '🔧 Manutenção de Tickets',
      '/config': '⚙️ Configuração do Sistema',
      '/agents': '👥 Gerenciamento de Agentes',
      '/tenants': '🏢 Gerenciamento de Tenants',
      '/onboarding': '🧭 Onboarding',
      '/super-admin': '🛡️ Super Admin',
      '/audit': '🔍 Auditoria',
      '/quick-replies': '⚡ Respostas Rápidas',
      '/faq': '❓ Perguntas Frequentes',
      '/departments': '🏢 Departamentos',
      '/bulk-messaging': '📢 Disparos em Massa',
      '/analytics': '📈 Análises e Métricas',
      '/academy': '🎓 Minha Evolução',
      '/tenant-intelligence': '🧠 Inteligência do Tenant',
      '/supervisor': '🧭 Painel Supervisor',
      '/rbac': '🔐 RBAC',
      '/mfa': '🔐 MFA',
      '/whatsapp-ivr': '💬 URA WhatsApp',
      '/whatsapp-connections': '📱 WhatsApp QR',
      '/developer-keys': '🔑 Chaves de API',
      '/automations': '🧩 Automações',
      '/projects': '📁 Projetos',
      '/tasks': '✅ Tarefas',
      '/agenda': '📅 Agenda',
      '/sla-policies': '⏱️ SLA',
      '/export': '📤 Exportação de Dados',
      '/ai-tools': '🤖 Ferramentas de IA',
      '/segmentation': '🎯 Segmentação',
      '/whatsapp-templates': '💬 Templates WhatsApp Business API',
      '/knowledge-base': '🧠 Base de Conhecimento',
      '/product-docs': '📖 Documentação de Produto',
      '/rag-documents': '📚 Gerenciamento de Documentos RAG',
      '/web-scraping': '🕷️ Raspagem de Sites',
      '/dev/rpa-test': '🚀 Execução de Testes RPA',
      '/dev/rpa-replays': '📋 Replays RPA',
      '/dev/rpa-seeds': '🌱 Seeds RPA',
      '/rpa-seeds': '🌱 Seeds RPA',
      '/chat': '💬 Chat de Teste',
      '/qa/stability': '📈 Estabilidade QA',
      '/qa': '✅ Painel de Qualidade (QA)',
      '/qa-mesh': '🕸️ Malha Unificada de Execução',
      '/generate-system': '🎯 Gerar Sistema / Fluxo / RPA / Seed',
      '/dev/system-status': '📊 Status dos Serviços',
      '/dev/stack-versions': '🧩 Versões da Stack',
      '/channel-health': '📡 Saúde de Canais',
      '/channel-accounts': '🔌 Canais',
      '/plan-usage': '📦 Plano e Uso',
      '/pbx': '📞 PBX',
      '/pbx/extensions': '📞 PBX • Ramais',
      '/pbx/trunks': '🌐 PBX • Troncos',
      '/pbx/routes': '🧭 PBX • Rotas',
      '/pbx/operator-panel': '🧭 PBX • Painel Operador',
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
      '/crm': '📊 CRM • Painel',
      '/crm/dashboard': '📊 CRM • Painel',
      '/crm/accounts': '🏢 CRM • Contas',
      '/crm/contacts': '👥 CRM • Contatos',
      '/crm/leads': '🎯 CRM • Leads',
      '/crm/pipelines': '🛣️ CRM • Pipelines',
      '/crm/opportunities': '💼 CRM • Oportunidades',
      '/crm/activities': '📝 CRM • Atividades',
      '/crm/analytics': '📈 CRM • Análises',
      '/crm/reports': '📋 CRM • Relatórios',
      '/crm/campaigns': '📣 CRM • Campanhas',
      '/crm/webhooks': '🪝 CRM • Webhooks',
      '/crm/rbac': '🔐 CRM • RBAC',
      '/crm/audit': '🔍 CRM • Auditoria',
      '/demo': '🎬 Demo Comercial RAP',
      '/failed-messages': '🚨 Mensagens Falhadas',
      '/fila-fisica': '🎫 Dashboard Fila Física',
      '/marketing': '🧲 Marketing',
      '/access-control': '🚪 Controle de Acesso',
      '/operations-dashboard': '🧭 Painel Operacional',
      '/orders': '🧾 Pedidos',
      '/kitchen': '🍳 Cozinha',
      '/dispatch': '🚚 Despacho',
      '/fitness/students': '🏋️ Fitness • Alunos',
      '/fitness/memberships': '🏋️ Fitness • Memberships',
      '/fitness/attendance': '🏋️ Fitness • Presença',
      '/beauty/schedule': '💄 Beleza • Agenda',
      '/beauty/campaigns': '💄 Beleza • Campanhas',
      '/beauty/leads': '💄 Beleza • Leads',
      '/beauty/customers': '💄 Beleza • Clientes',
      '/beauty/bundles': '💄 Beleza • Bundles',
      '/beauty/services': '💄 Beleza • Serviços',
      '/beauty/payments': '💄 Beleza • Pagamentos',
      '/vertical/dashboard': '📊 Painel Vertical',
      '/dev/engineering/tasks': '⚙️ Engineering • Tasks',
      '/dev/engineering/missions': '⚙️ Engineering • Missions',
      '/dev/engineering/findings': '⚙️ Engineering • Findings',
      '/dev/engineering/models': '⚙️ Engineering • Models',
      '/dev/engineering/release-closure': '⚙️ Engineering • Release Closure',
      '/dev/engineering': '⚙️ Engineering Model Router',
      '/solutions': '📦 Pacotes de Solução',
      '/node-marketplace': '🧩 Mercado de Nodes',
      '/sso-scim': '🔐 SSO / SCIM',
      '/backup': '🗄️ Backup / DR',
      '/dev': '🛠️ Dashboard de Desenvolvimento',
      '/dev/qa-waves': '🌊 QA Waves Integrado',
      '/dev/qa-gaps': '🧭 QA Gaps Operacionais',
      '/dev/benchmark-research': '🔬 Pesquisa de Benchmark',
      '/dev/security-intel': '🛡️ Versões e Segurança',
      // Governança de engenharia: sem entrada aqui, a resolução cai no prefixo
      // mais curto (`/dev`) e a aba passa a mentir o nome da tela.
      '/dev/pendencies': '📋 Pendências',
      '/dev/release': '🚀 Release',
      '/dev/qa-waves/operational-health': 'QA Waves Operational Health',
      '/dev/qa-waves/enterprise-governance': 'QA Waves Enterprise Governance',
      '/dev-dashboard': '🛠️ Dashboard de Desenvolvimento',
      '/saas': '🌐 Results SaaS',
      '/saas/products': '🧩 Produtos SaaS',
      '/saas/solutions': '📦 Soluções SaaS',
      '/saas/pricing': '💳 Preços SaaS',
      '/saas/signup': '📝 Criar Conta SaaS',
      '/login': '🔐 Login',
    };

    // Encontra o título mais específico correspondente à rota atual
    let pageTitle = 'Editor de Fluxos do Chatbot';
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
        minHeight: 'var(--rap-viewport-height, 100vh)',
      }}>
        <p>Carregando...</p>
      </div>
    );
  }

  // Todas as rotas requerem autenticação, exceto /login e rotas públicas de marketing/storefront
  const protectedRoutes = ['/', '/dashboard-legacy', '/editor', '/bpmn-editor', '/support', '/workspace', '/inbox', '/maintenance', '/config', '/agents', '/tenants', '/audit', '/dev/system-status', '/channel-health', '/channel-accounts', '/plan-usage', '/pbx', '/chat-humano', '/fila-fisica', '/quick-replies', '/faq', '/marketing', '/access-control', '/operations-dashboard', '/fitness', '/beauty', '/vertical/dashboard', '/solutions', '/node-marketplace', '/sso-scim', '/backup', '/analytics', '/academy', '/tenant-intelligence', '/supervisor', '/rbac', '/mfa', '/whatsapp-ivr', '/whatsapp-connections', '/developer-keys', '/automations', '/projects', '/tasks', '/agenda', '/sla-policies', '/demo'];
  const isProtectedRoute = protectedRoutes.some(route => currentPath === route || currentPath.startsWith(route));
  
  // Verifica se é rota pública (apenas /login)
  const isPublicRoute = publicRoutes.some((route) => {
    if (route === '/') return currentPath === '/';
    return currentPath === route || currentPath.startsWith(`${route}/`) || currentPath.startsWith(`${route}?`);
  });

  // Se está na rota de login explicitamente, mostra login
  if (isLogin) {
    return <Login />;
  }

  // Rotas públicas (storefront + SaaS) não exigem autenticação
  if (!isAuthenticated && !isPublicRoute) {
    return <Login />;
  }

  // Render público (sem menu/gate)
  if (isPublicRoute) {
    let publicContent = null;
    if (isSaasLanding) publicContent = <SaasPublicPage mode="landing" />;
    else if (isSaasProducts) publicContent = <SaasPublicPage mode="products" />;
    else if (isSaasSolutions) publicContent = <SaasPublicPage mode="solutions" />;
    else if (isSaasPricing) publicContent = <SaasPublicPage mode="pricing" />;
    else if (isSaasSignup) publicContent = <SaasPublicPage mode="signup" />;
    else if (isStorefrontOrder) publicContent = <StorefrontOrderPage />;
    else if (isStorefrontOrderStatus) publicContent = <StorefrontOrderStatusPage />;
    else if (isKiosk) publicContent = <KioskPage />;
    else if (isPanel) publicContent = <PanelPage />;
    else if (isStation) publicContent = <StationPage />;
    // fallback
    else publicContent = <StorefrontOrderPage />;
    return (
      <Suspense fallback={<PageLoadingFallback />}>
        {publicContent}
      </Suspense>
    );
  }

  // Guardas de acesso por módulo/ação (RBAC) para evitar bypass por URL direta.
  // Super Admin sempre pode acessar rotas existentes no frontend.
  // Rotas gated por capability do tenant (ex.: /cases) exigem a capacidade ligada.
  const hasRouteAccess = isSuperAdmin || canAccessPath(agent, currentPath, { capabilities });
  if (!hasRouteAccess) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2 style={{ color: '#ef4444', marginBottom: '1rem' }}>Acesso Negado</h2>
        <p style={{ color: '#6b7280', marginBottom: '1rem' }}>
          Seu perfil não possui permissão para acessar este módulo.
        </p>
        <button
          onClick={() => navigate('/workspace')}
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

  const workspaceKeys = getWorkspaceKeysForPath(currentPath, {
    tenantContext: tenantProfile?.context || null,
    tenantProfile,
    includeAllVerticals: isSuperAdmin,
  });
  const inferredTenantWorkspaceKey = inferWorkspaceKeyFromTenantProfile(tenantProfile);
  const sidebarVerticalKeys = isSuperAdmin
    ? Object.keys(verticalWorkspaces)
    : (inferredTenantWorkspaceKey ? [inferredTenantWorkspaceKey] : []);
  const subNavVerticalLabels = sidebarVerticalKeys
    .map((key) => verticalWorkspaces[key]?.label)
    .filter(Boolean);
  const subNavTenantLabel = tenantProfile?.tenant?.name || agent?.tenantId || '';

  let pageContent = null;
  if (isDashboard) {
    pageContent = <DashboardV2 />;
  } else if (isDashboardLegacy) {
    pageContent = <DashboardPage />;
  } else if (isEditor) {
    pageContent = (
      <EditorProvider>
        <FlowEditorPage />
      </EditorProvider>
    );
  } else if (isBpmnEditor) {
    pageContent = <BpmnEditorPage />;
  } else if (isSupport) {
    pageContent = <SupportPage />;
  } else if (isWorkspace) {
    pageContent = <WorkspacePage />;
  } else if (isInbox) {
    pageContent = <InboxPage />;
  } else if (isCases) {
    pageContent = <CasesPage />;
  } else if (isPlatformSupport) {
    pageContent = <PlatformSupportPage />;
  } else if (isMaintenance) {
    pageContent = <TicketMaintenancePage />;
  } else if (isConfig) {
    pageContent = <ConfigPage />;
  } else if (isAgents) {
    pageContent = <AgentsPage />;
  } else if (isTenants) {
    pageContent = <TenantsPage />;
  } else if (isSuperAdminPage) {
    pageContent = <SuperAdminPage />;
  } else if (isOnboarding) {
    pageContent = <OnboardingPage />;
  } else if (isAudit) {
    pageContent = <AuditPage />;
  } else if (isQuickReplies) {
    pageContent = <QuickRepliesPage />;
  } else if (isFaq) {
    pageContent = <FaqManagementPage />;
  } else if (isDepartments) {
    pageContent = <DepartmentsPage />;
  } else if (isBulkMessaging) {
    pageContent = <BulkMessagingPage />;
  } else if (isAcademy) {
    pageContent = <AcademyPage />;
  } else if (isAnalytics) {
    pageContent = <AnalyticsPage />;
  } else if (isTenantIntelligence) {
    pageContent = <TenantIntelligencePage />;
  } else if (isSupervisor) {
    pageContent = <SupervisorPage />;
  } else if (isRbac) {
    pageContent = <RbacPage />;
  } else if (isMfa) {
    pageContent = <MfaPage />;
  } else if (isWhatsAppIvr) {
    pageContent = <WhatsAppIvrPage />;
  } else if (isWhatsAppConnections) {
    pageContent = <WhatsAppConnectionsPage />;
  } else if (isDeveloperKeys) {
    pageContent = <DeveloperKeysPage />;
  } else if (isAutomations) {
    pageContent = <AutomationsPage />;
  } else if (isProjectList) {
    pageContent = <ProjectListPage />;
  } else if (isProjectDashboard) {
    pageContent = <ProjectDashboardPage />;
  } else if (isProjectTimeline) {
    pageContent = <ProjectTimelinePage />;
  } else if (isProjectActivities) {
    pageContent = <ProjectActivitiesPage />;
  } else if (isProjectSettings) {
    pageContent = <ProjectSettingsPage />;
  } else if (isProjectGantt) {
    pageContent = <ProjectGanttPage />;
  } else if (isProjectCalendar) {
    pageContent = <ProjectCalendarViewPage />;
  } else if (isProjectBoard) {
    pageContent = <ProjectBoardPage />;
  } else if (isProjects) {
    pageContent = <ProjectsPage />;
  } else if (isTasks) {
    pageContent = <TasksPage />;
  } else if (isAgenda) {
    pageContent = <CalendarPage />;
  } else if (isSlaPolicies) {
    pageContent = <SlaPoliciesPage />;
  } else if (isExport) {
    pageContent = <ExportPage />;
  } else if (isAITools) {
    pageContent = <AIToolsPage />;
  } else if (isSegmentation) {
    pageContent = <SegmentationPage />;
  } else if (isWhatsAppTemplates) {
    pageContent = <WhatsAppTemplatesPage />;
  } else if (isKnowledgeBase) {
    pageContent = <KnowledgeBasePage />;
  } else if (isProductDocs) {
    pageContent = <ProductDocsPage />;
  } else if (isRAGDocuments) {
    pageContent = <RAGDocumentsPage />;
  } else if (isWebScraping) {
    pageContent = <WebScrapingPage />;
  } else if (isRpaTest) {
    pageContent = <RpaTestPage />;
  } else if (isRpaReplays || isRpaReplaysAlias) {
    pageContent = <RpaReplaysPage />;
  } else if (isRpaSeeds) {
    pageContent = <RpaSeedsPage />;
  } else if (isChat) {
    pageContent = <ChatPage />;
  } else if (isQaStability) {
    pageContent = <StabilityPage />;
  } else if (isQa) {
    pageContent = <QaPage />;
  } else if (isQaMesh) {
    pageContent = <QaMeshPage />;
  } else if (isGenerateSystem) {
    pageContent = <GenerateSystemPage />;
  } else if (isSystemStatus || isSystemStatusAlias) {
    pageContent = <SystemStatusPage />;
  } else if (isStackVersions) {
    pageContent = <StackVersionsPage />;
  } else if (isChannelHealth) {
    pageContent = <ChannelHealthPage />;
  } else if (isChannelAccounts) {
    pageContent = <ChannelAccountsPage />;
  } else if (isPlanUsage) {
    pageContent = <PlanUsagePage />;
  } else if (isPbxExtensions) {
    pageContent = <PbxExtensionsPage />;
  } else if (isPbxTrunks) {
    pageContent = <PbxTrunksPage />;
  } else if (isPbxRoutes) {
    pageContent = <PbxRoutesPage />;
  } else if (isPbxOperatorPanel) {
    pageContent = <PbxOperatorPanelPage />;
  } else if (isPbxModule) {
    pageContent = <PbxModulePage />;
  } else if (isPbx) {
    pageContent = <PbxPage />;
  } else if (isChatHumanoDashboard) {
    pageContent = <ChatHumanoDashboardPage />;
  } else if (isCrmDashboard) {
    pageContent = <CrmDashboardPage />;
  } else if (isDemo) {
    pageContent = <DemoPage />;
  } else if (isFailedMessages) {
    pageContent = <FailedMessagesPage />;
  } else if (isQueuePhysicalDashboard) {
    pageContent = <QueuePhysicalDashboardPage />;
  } else if (isQaWavesEnterpriseGovernance) {
    pageContent = <QaWavesEnterpriseGovernancePage />;
  } else if (isQaWavesOperationalHealth) {
    pageContent = <QaWavesOperationalHealthPage />;
  } else if (isQaWaves) {
    pageContent = <QaWavesPage />;
  } else if (isQaGaps) {
    pageContent = <QaGapsPage />;
  } else if (isEngineeringMissionDetail) {
    pageContent = <EngineeringMissionDetailPage missionId={currentPath.replace(/^\/dev\/engineering\/missions\//, '').replace(/\/$/, '')} />;
  } else if (isEngineeringMissions) {
    pageContent = <EngineeringMissionsPage />;
  } else if (isEngineeringFindings) {
    pageContent = <EngineeringFindingsPage />;
  } else if (isEngineeringTaskDetail) {
    pageContent = <EngineeringTaskDetailPage />;
  } else if (isEngineeringTasks) {
    pageContent = <EngineeringTasksPage />;
  } else if (isEngineeringModels) {
    pageContent = <EngineeringModelsPage />;
  } else if (isEngineeringReleaseClosure) {
    pageContent = <EngineeringReleaseClosurePage />;
  } else if (isEngineeringOverview) {
    pageContent = <EngineeringOverviewPage />;
  } else if (isBenchmarkResearch) {
    pageContent = <BenchmarkResearchGovernancePage />;
  } else if (isSecurityIntel) {
    pageContent = <SecurityIntelligencePage />;
  } else if (isDevPendencies) {
    pageContent = <DevPendenciesPage />;
  } else if (isDevRelease) {
    pageContent = <DevReleasePage />;
  } else if (isOrders) {
    pageContent = <OrdersPage />;
  } else if (isKitchen) {
    pageContent = <KitchenPage />;
  } else if (isDispatch) {
    pageContent = <DispatchPage />;
  } else if (isMarketing) {
    pageContent = <MarketingPage />;
  } else if (isAccessControl) {
    pageContent = <AccessControlPage />;
  } else if (isOperationsDashboard) {
    pageContent = <OperationsDashboardPage />;
  } else if (isFitnessStudents) {
    pageContent = <FitnessStudentsPage />;
  } else if (isFitnessMemberships) {
    pageContent = <FitnessMembershipsPage />;
  } else if (isFitnessAttendance) {
    pageContent = <FitnessAttendancePage />;
  } else if (isBeautySchedule) {
    pageContent = <BeautySchedulePage />;
  } else if (isBeautyCampaigns) {
    pageContent = <BeautyCampaignsPage />;
  } else if (isBeautyLeads) {
    pageContent = <BeautyLeadsPage />;
  } else if (isBeautyCustomers) {
    pageContent = <BeautyCustomersPage />;
  } else if (isBeautyBundles) {
    pageContent = <BeautyBundlesPage />;
  } else if (isBeautyServices) {
    pageContent = <BeautyServicesPage />;
  } else if (isBeautyPayments) {
    pageContent = <BeautyPaymentsPage />;
  } else if (isVerticalDashboard) {
    pageContent = <VerticalOperationalDashboardPage workspaceKeys={workspaceKeys} isSuperAdmin={isSuperAdmin} />;
  } else if (isSolutions) {
    pageContent = <SolutionsPage />;
  } else if (isNodeMarketplace) {
    pageContent = <NodeMarketplacePage />;
  } else if (isSsoScim) {
    pageContent = <SsoScimPage />;
  } else if (isBackup) {
    pageContent = <BackupPage />;
  } else if (isAgentOsHub) {
    pageContent = <AgentOsHubPage />;
  } else if (isQaAudit) {
    pageContent = <QaAuditPage />;
  } else if (isDevDashboard) {
    pageContent = isSuperAdmin ? (
      <DevDashboardPage />
    ) : (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2 style={{ color: '#ef4444', marginBottom: '1rem' }}>Acesso Negado</h2>
        <p style={{ color: '#6b7280', marginBottom: '1rem' }}>
          Apenas super-admins podem acessar o Dashboard de Desenvolvimento.
        </p>
        <button
          onClick={() => navigate('/workspace')}
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

  if (newNavigationEnabled && workspaceKeys.length > 0) {
    pageContent = (
      <VerticalLayout agent={agent} verticalKeys={workspaceKeys} currentPath={currentPath}>
        {pageContent}
      </VerticalLayout>
    );
  }

  // Code splitting por rota: páginas lazy resolvem dentro deste boundary
  pageContent = (
    <Suspense fallback={<PageLoadingFallback />}>
      {pageContent}
    </Suspense>
  );

  // Requisito: página só abre com agente + tenant. Quando o perfil permite
  // escolher o tenant (super-admin sem tenant efetivo), o shell pode existir,
  // mas o CONTEÚDO da página fica bloqueado até o TenantGate fechar.
  const tenantGateActive = shouldBlockPageForTenant({ isAuthenticated, agent });

  // Se chegou aqui, está autenticado OU é rota pública
  if (!newNavigationEnabled) {
    return (
      <div className="support-content-wrapper rap-legacy-shell">
        <UserMenu tenantLabel={subNavTenantLabel} verticalLabels={subNavVerticalLabels} />
        <TenantGate />
        {tenantGateActive ? null : pageContent}
        <AskAiWidget />
      </div>
    );
  }

  return (
    <div className={`rap-enterprise-shell ${isContextPanelOpen ? 'is-context-panel-open' : ''} ${isSecondaryNavCollapsed ? 'is-secondary-nav-collapsed' : ''}`}>
      <PrimaryRail agent={agent} currentPath={currentPath} capabilities={capabilities} />
      <SecondaryNav
        agent={agent}
        currentPath={currentPath}
        onCollapsedChange={setIsSecondaryNavCollapsed}
        capabilities={capabilities}
      />

      <div className="rap-enterprise-main">
        <AreaHeader
          agent={agent}
          currentPath={currentPath}
          capabilities={capabilities}
          actionsSlot={<UserMenu showNavigation={false} tenantLabel={subNavTenantLabel} verticalLabels={subNavVerticalLabels} />}
        />
        <div className="rap-page">
          <CommandPalette agent={agent} capabilities={capabilities} />
          <TutorDock />
          <TenantGate />
          {tenantGateActive ? null : pageContent}
        </div>
      </div>

      <button
        type="button"
        className="rap-context-panel-toggle"
        onClick={() => setIsContextPanelOpen((previous) => !previous)}
        aria-expanded={isContextPanelOpen}
        aria-controls="rap-context-panel"
        aria-label={isContextPanelOpen ? 'Recolher painel de atalhos e informações' : 'Abrir painel de atalhos e informações'}
        title={isContextPanelOpen ? 'Recolher painel' : 'Abrir atalhos e informações'}
      >
        <span aria-hidden="true">{isContextPanelOpen ? '>' : '<'}</span>
      </button>
      {isContextPanelOpen ? (
        <ContextPanel
          agent={agent}
          currentPath={currentPath}
          tenantLabel={subNavTenantLabel}
          onClose={() => setIsContextPanelOpen(false)}
          capabilities={capabilities}
        />
      ) : null}
      <AskAiWidget />
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
