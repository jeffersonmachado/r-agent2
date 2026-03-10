import React, { Suspense, useEffect } from 'react';
import { useAuth } from '../context/authContext';
import { Login } from '../components/Login';
import { UserMenu } from '../components/UserMenu';
import { TenantGate } from '../components/TenantGate';
import { useRouter } from '../hooks/useRouter';
import { useWebSocketAuthGuard } from '../hooks/useWebSocketAuthGuard';
import { canAccessPath, isSuperAdmin as checkIsSuperAdmin } from '../utils/menuPermissions';
import { AccessDenied } from './components/AccessDenied';
import { protectedRoutes, publicRoutes, isPublicPath, findMatchingRoute } from './routes';
import { useAppRuntime } from './runtime/appRuntime';

function RouteLoading() {
  return <div className="p-6 text-sm text-text-secondary">Carregando modulo...</div>;
}

export function AppRouter() {
  const { currentPath, navigate } = useRouter();
  const { isAuthenticated, loading, agent } = useAuth();

  useWebSocketAuthGuard();
  const isSuperAdmin = checkIsSuperAdmin(agent);
  const routeContext = { currentPath, navigate, isSuperAdmin, agent };
  const activePublicRoute = findMatchingRoute(publicRoutes, routeContext);
  const activeProtectedRoute = findMatchingRoute(protectedRoutes, routeContext);
  const isLogin = currentPath === '/login' || currentPath.startsWith('/login/') || currentPath.startsWith('/login?');

  useAppRuntime({ currentPath, isAuthenticated });

  useEffect(() => {
    if (loading) return;
    if (!activePublicRoute && !activeProtectedRoute && !isLogin) {
      if (isAuthenticated) {
        navigate('/support');
      } else {
        navigate('/login');
      }
    }
  }, [activeProtectedRoute, activePublicRoute, isAuthenticated, isLogin, loading, navigate]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <p>Carregando...</p>
      </div>
    );
  }

  if (isLogin) {
    return <Login />;
  }

  const publicRoute = activePublicRoute;
  const protectedRoute = activeProtectedRoute;
  const isPublicRoute = isPublicPath(currentPath);

  if (!isAuthenticated && !isPublicRoute) {
    return <Login />;
  }

  if (isPublicRoute) {
    return publicRoute ? publicRoute.render(routeContext) : null;
  }

  const hasRouteAccess = canAccessPath(agent, currentPath);
  if (!hasRouteAccess) {
    return (
      <AccessDenied
        description="Seu perfil não possui permissão para acessar este módulo."
        onBack={() => navigate('/support')}
      />
    );
  }

  return (
    <div className="support-content-wrapper">
      <UserMenu />
      <TenantGate />
      <Suspense fallback={<RouteLoading />}>
        {protectedRoute ? protectedRoute.render(routeContext) : null}
      </Suspense>
    </div>
  );
}
