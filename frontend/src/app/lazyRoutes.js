import { lazy } from 'react';
import { DashboardPage } from '../pages/DashboardPage';
import { StorefrontOrderPage } from '../pages/StorefrontOrderPage';
import { StorefrontOrderStatusPage } from '../pages/StorefrontOrderStatusPage';
import { KioskPage } from '../pages/KioskPage';
import { PanelPage } from '../pages/PanelPage';
import { StationPage } from '../pages/StationPage';

function lazyNamedPage(loader, exportName) {
  return lazy(() => loader().then((mod) => ({ default: mod[exportName] })));
}

export {
  DashboardPage,
  KioskPage,
  PanelPage,
  StationPage,
  StorefrontOrderPage,
  StorefrontOrderStatusPage,
};

export const FlowEditorPage = lazyNamedPage(() => import('../pages/FlowEditorPage'), 'FlowEditorPage');
export const SupportPage = lazyNamedPage(() => import('../pages/SupportPage'), 'SupportPage');
export const InboxPage = lazyNamedPage(() => import('../pages/InboxPage'), 'InboxPage');
export const TicketMaintenancePage = lazyNamedPage(() => import('../pages/TicketMaintenancePage'), 'TicketMaintenancePage');
export const ConfigPage = lazyNamedPage(() => import('../pages/ConfigPage'), 'ConfigPage');
export const AgentsPage = lazyNamedPage(() => import('../pages/AgentsPage'), 'AgentsPage');
export const TenantsPage = lazyNamedPage(() => import('../pages/TenantsPage'), 'TenantsPage');
export const SuperAdminPage = lazyNamedPage(() => import('../pages/SuperAdminPage'), 'SuperAdminPage');
export const OperationalControlCenter = lazyNamedPage(() => import('../pages/OperationalControlCenter'), 'OperationalControlCenter');
export const OnboardingPage = lazyNamedPage(() => import('../pages/OnboardingPage'), 'OnboardingPage');
export const AuditPage = lazyNamedPage(() => import('../pages/AuditPage'), 'AuditPage');
export const QuickRepliesPage = lazyNamedPage(() => import('../pages/QuickRepliesPage'), 'QuickRepliesPage');
export const FaqManagementPage = lazyNamedPage(() => import('../pages/FaqManagementPage'), 'FaqManagementPage');
export const DepartmentsPage = lazyNamedPage(() => import('../pages/DepartmentsPage'), 'DepartmentsPage');
export const BulkMessagingPage = lazyNamedPage(() => import('../pages/BulkMessagingPage'), 'BulkMessagingPage');
export const AnalyticsPage = lazyNamedPage(() => import('../pages/AnalyticsPage'), 'AnalyticsPage');
export const SupervisorPage = lazyNamedPage(() => import('../pages/SupervisorPage'), 'SupervisorPage');
export const RbacPage = lazyNamedPage(() => import('../pages/RbacPage'), 'RbacPage');
export const MfaPage = lazyNamedPage(() => import('../pages/MfaPage'), 'MfaPage');
export const WhatsAppIvrPage = lazyNamedPage(() => import('../pages/WhatsAppIvrPage'), 'WhatsAppIvrPage');
export const WhatsAppConnectionsPage = lazyNamedPage(() => import('../pages/WhatsAppConnectionsPage'), 'WhatsAppConnectionsPage');
export const DeveloperKeysPage = lazyNamedPage(() => import('../pages/DeveloperKeysPage'), 'DeveloperKeysPage');
export const AutomationsPage = lazyNamedPage(() => import('../pages/AutomationsPage'), 'AutomationsPage');
export const TasksPage = lazyNamedPage(() => import('../pages/TasksPage'), 'TasksPage');
export const CalendarPage = lazyNamedPage(() => import('../pages/CalendarPage'), 'CalendarPage');
export const AutonomousSchedulingPage = lazyNamedPage(() => import('../pages/AutonomousSchedulingPage'), 'AutonomousSchedulingPage');
export const SlaPoliciesPage = lazyNamedPage(() => import('../pages/SlaPoliciesPage'), 'SlaPoliciesPage');
export const ExportPage = lazyNamedPage(() => import('../pages/ExportPage'), 'ExportPage');
export const AIToolsPage = lazyNamedPage(() => import('../pages/AIToolsPage'), 'AIToolsPage');
export const SegmentationPage = lazyNamedPage(() => import('../pages/SegmentationPage'), 'SegmentationPage');
export const WhatsAppTemplatesPage = lazyNamedPage(() => import('../pages/WhatsAppTemplatesPage'), 'WhatsAppTemplatesPage');
export const KnowledgeBasePage = lazyNamedPage(() => import('../pages/KnowledgeBasePage'), 'KnowledgeBasePage');
export const ProductDocsPage = lazyNamedPage(() => import('../pages/ProductDocsPage'), 'ProductDocsPage');
export const RAGDocumentsPage = lazyNamedPage(() => import('../pages/RAGDocumentsPage'), 'RAGDocumentsPage');
export const WebScrapingPage = lazyNamedPage(() => import('../pages/WebScrapingPage'), 'WebScrapingPage');
export const RpaTestPage = lazyNamedPage(() => import('../pages/RpaTestPage'), 'RpaTestPage');
export const RpaReplaysPage = lazyNamedPage(() => import('../pages/RpaReplaysPage'), 'RpaReplaysPage');
export const RpaSeedsPage = lazyNamedPage(() => import('../pages/RpaSeedsPage'), 'RpaSeedsPage');
export const ChatPage = lazyNamedPage(() => import('../pages/ChatPage'), 'ChatPage');
export const QaPage = lazyNamedPage(() => import('../pages/QaPage'), 'QaPage');
export const GenerateSystemPage = lazyNamedPage(() => import('../pages/GenerateSystemPage'), 'GenerateSystemPage');
export const SystemStatusPage = lazyNamedPage(() => import('../pages/SystemStatusPage'), 'SystemStatusPage');
export const ChannelHealthPage = lazyNamedPage(() => import('../pages/ChannelHealthPage'), 'ChannelHealthPage');
export const ChannelAccountsPage = lazyNamedPage(() => import('../pages/ChannelAccountsPage'), 'ChannelAccountsPage');
export const PlanUsagePage = lazyNamedPage(() => import('../pages/PlanUsagePage'), 'PlanUsagePage');
export const DevDashboardPage = lazyNamedPage(() => import('../pages/DevDashboardPage'), 'DevDashboardPage');
export const PbxPage = lazyNamedPage(() => import('../pages/PbxPage'), 'PbxPage');
export const PbxRoutesPage = lazyNamedPage(() => import('../pages/PbxRoutesPage'), 'PbxRoutesPage');
export const PbxExtensionsPage = lazyNamedPage(() => import('../pages/PbxExtensionsPage'), 'PbxExtensionsPage');
export const PbxTrunksPage = lazyNamedPage(() => import('../pages/PbxTrunksPage'), 'PbxTrunksPage');
export const PbxModulePage = lazyNamedPage(() => import('../pages/PbxModulePage'), 'PbxModulePage');
export const ChatHumanoDashboardPage = lazyNamedPage(() => import('../pages/ChatHumanoDashboardPage'), 'ChatHumanoDashboardPage');
export const FailedMessagesPage = lazyNamedPage(() => import('../pages/FailedMessagesPage'), 'FailedMessagesPage');
export const QueuePhysicalDashboardPage = lazyNamedPage(() => import('../pages/QueuePhysicalDashboardPage'), 'QueuePhysicalDashboardPage');
export const MarketingPage = lazyNamedPage(() => import('../pages/MarketingPage'), 'MarketingPage');
export const SolutionsPage = lazyNamedPage(() => import('../pages/SolutionsPage'), 'SolutionsPage');
export const NodeMarketplacePage = lazyNamedPage(() => import('../pages/NodeMarketplacePage'), 'NodeMarketplacePage');
export const SsoScimPage = lazyNamedPage(() => import('../pages/SsoScimPage'), 'SsoScimPage');
export const BackupPage = lazyNamedPage(() => import('../pages/BackupPage'), 'BackupPage');
export const OrdersPage = lazyNamedPage(() => import('../pages/OrdersPage'), 'OrdersPage');
export const KitchenPage = lazyNamedPage(() => import('../pages/KitchenPage'), 'KitchenPage');
export const DispatchPage = lazyNamedPage(() => import('../pages/DispatchPage'), 'DispatchPage');
export const CrmDashboardPage = lazyNamedPage(() => import('../pages/crm/CrmDashboardPage'), 'CrmDashboardPage');
export const BeautyDashboard = lazyNamedPage(() => import('../pages/BeautyDashboard'), 'BeautyDashboard');
export const FitnessDashboard = lazyNamedPage(() => import('../pages/FitnessDashboard'), 'FitnessDashboard');
