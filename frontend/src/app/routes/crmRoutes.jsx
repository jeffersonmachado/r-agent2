import { CrmDashboardPage } from '../lazyRoutes';
import { isCrmPath } from './matchers';

export const crmRoutes = [
  {
    key: 'crm',
    matches: ({ currentPath }) => isCrmPath(currentPath),
    render: () => <CrmDashboardPage />,
  },
];
