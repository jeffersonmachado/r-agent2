import { adminRoutes } from './adminRoutes';
import { crmRoutes } from './crmRoutes';
import { knowledgeRoutes } from './knowledgeRoutes';
import { pbxRoutes } from './pbxRoutes';
import { publicRoutes, isPublicPath } from './publicRoutes';
import { technicalRoutes } from './technicalRoutes';
import { workspaceRoutes } from './workspaceRoutes';

export { isPublicPath, publicRoutes };

export const protectedRoutes = [
  ...workspaceRoutes,
  ...adminRoutes,
  ...knowledgeRoutes,
  ...technicalRoutes,
  ...pbxRoutes,
  ...crmRoutes,
];

export function findMatchingRoute(routes, context) {
  return routes.find((route) => route.matches(context)) || null;
}
