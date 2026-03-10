import { EditorProvider } from '../../state/editorStore';
import {
  AutonomousSchedulingPage,
  BeautyDashboard,
  CalendarPage,
  ChatHumanoDashboardPage,
  DashboardPage,
  FailedMessagesPage,
  FitnessDashboard,
  FlowEditorPage,
  InboxPage,
  OrdersPage,
  KitchenPage,
  DispatchPage,
  QueuePhysicalDashboardPage,
  SupportPage,
  TasksPage,
  TicketMaintenancePage,
} from '../lazyRoutes';
import { isRoutePath } from './matchers';

export const workspaceRoutes = [
  {
    key: 'dashboard',
    matches: ({ currentPath }) => currentPath === '/' || currentPath === '/dashboard',
    render: () => <DashboardPage />,
  },
  {
    key: 'editor',
    matches: ({ currentPath }) => isRoutePath(currentPath, '/editor'),
    render: () => (
      <EditorProvider>
        <FlowEditorPage />
      </EditorProvider>
    ),
  },
  {
    key: 'support',
    matches: ({ currentPath }) => isRoutePath(currentPath, '/support'),
    render: () => <SupportPage />,
  },
  {
    key: 'inbox',
    matches: ({ currentPath }) => isRoutePath(currentPath, '/inbox'),
    render: () => <InboxPage />,
  },
  {
    key: 'maintenance',
    matches: ({ currentPath }) => isRoutePath(currentPath, '/maintenance'),
    render: () => <TicketMaintenancePage />,
  },
  {
    key: 'tasks',
    matches: ({ currentPath }) => isRoutePath(currentPath, '/tasks'),
    render: () => <TasksPage />,
  },
  {
    key: 'agenda',
    matches: ({ currentPath }) => isRoutePath(currentPath, '/agenda'),
    render: () => <CalendarPage />,
  },
  {
    key: 'autonomous-scheduling',
    matches: ({ currentPath }) => isRoutePath(currentPath, '/autonomous-scheduling'),
    render: () => <AutonomousSchedulingPage />,
  },
  {
    key: 'beauty-dashboard',
    matches: ({ currentPath }) => isRoutePath(currentPath, '/beauty-dashboard'),
    render: () => <BeautyDashboard />,
  },
  {
    key: 'fitness-dashboard',
    matches: ({ currentPath }) => isRoutePath(currentPath, '/fitness-dashboard'),
    render: () => <FitnessDashboard />,
  },
  {
    key: 'chat-humano',
    matches: ({ currentPath }) => isRoutePath(currentPath, '/chat-humano'),
    render: () => <ChatHumanoDashboardPage />,
  },
  {
    key: 'failed-messages',
    matches: ({ currentPath }) => isRoutePath(currentPath, '/failed-messages'),
    render: () => <FailedMessagesPage />,
  },
  {
    key: 'fila-fisica',
    matches: ({ currentPath }) => isRoutePath(currentPath, '/fila-fisica'),
    render: () => <QueuePhysicalDashboardPage />,
  },
  {
    key: 'orders',
    matches: ({ currentPath }) => isRoutePath(currentPath, '/orders'),
    render: () => <OrdersPage />,
  },
  {
    key: 'kitchen',
    matches: ({ currentPath }) => isRoutePath(currentPath, '/kitchen'),
    render: () => <KitchenPage />,
  },
  {
    key: 'dispatch',
    matches: ({ currentPath }) => isRoutePath(currentPath, '/dispatch'),
    render: () => <DispatchPage />,
  },
];
