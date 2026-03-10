import {
  KioskPage,
  PanelPage,
  StationPage,
  StorefrontOrderPage,
  StorefrontOrderStatusPage,
} from '../lazyRoutes';
import { isRoutePath, isStorefrontOrderPath, isStorefrontOrderStatusPath } from './matchers';

export const publicRoutes = [
  {
    key: 'storefront-order',
    matches: ({ currentPath }) => isStorefrontOrderPath(currentPath),
    render: () => <StorefrontOrderPage />,
  },
  {
    key: 'storefront-order-status',
    matches: ({ currentPath }) => isStorefrontOrderStatusPath(currentPath),
    render: () => <StorefrontOrderStatusPage />,
  },
  {
    key: 'storefront-root',
    matches: ({ currentPath }) => currentPath.startsWith('/storefront'),
    render: () => <StorefrontOrderPage />,
  },
  {
    key: 'kiosk',
    matches: ({ currentPath }) => isRoutePath(currentPath, '/kiosk'),
    render: () => <KioskPage />,
  },
  {
    key: 'panel',
    matches: ({ currentPath }) => isRoutePath(currentPath, '/panel'),
    render: () => <PanelPage />,
  },
  {
    key: 'station',
    matches: ({ currentPath }) => isRoutePath(currentPath, '/station'),
    render: () => <StationPage />,
  },
];

export function isPublicPath(currentPath) {
  return (
    currentPath.startsWith('/storefront') ||
    isRoutePath(currentPath, '/kiosk') ||
    isRoutePath(currentPath, '/panel') ||
    isRoutePath(currentPath, '/station')
  );
}
