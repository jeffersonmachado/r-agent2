import {
  ChannelAccountsPage,
  ChannelHealthPage,
  DevDashboardPage,
  MarketingPage,
  SystemStatusPage,
} from '../lazyRoutes';
import { AccessDenied } from '../components/AccessDenied';
import { isRoutePath } from './matchers';

export const technicalRoutes = [
  { key: 'system-status', matches: ({ currentPath }) => isRoutePath(currentPath, '/system-status'), render: () => <SystemStatusPage /> },
  { key: 'channel-health', matches: ({ currentPath }) => isRoutePath(currentPath, '/channel-health'), render: () => <ChannelHealthPage /> },
  { key: 'channel-accounts', matches: ({ currentPath }) => isRoutePath(currentPath, '/channel-accounts'), render: () => <ChannelAccountsPage /> },
  { key: 'marketing', matches: ({ currentPath }) => isRoutePath(currentPath, '/marketing'), render: () => <MarketingPage /> },
  {
    key: 'dev-dashboard',
    matches: ({ currentPath }) => isRoutePath(currentPath, '/dev') || isRoutePath(currentPath, '/dev-dashboard'),
    render: ({ isSuperAdmin, navigate }) =>
      isSuperAdmin ? (
        <DevDashboardPage />
      ) : (
        <AccessDenied
          description="Apenas super-admins podem acessar o Dashboard de Desenvolvimento."
          onBack={() => navigate('/support')}
        />
      ),
  },
];
