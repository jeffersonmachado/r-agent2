import { postJson } from './api';

type LoginResponse = {
  token: string;
  agent?: {
    id?: string;
    username?: string;
    tenantId?: string | null;
    role?: string;
    is_superadmin?: boolean;
  };
};

export type LoginWithPasswordResult = {
  token: string;
  agent?: LoginResponse['agent'];
};

export async function loginWithPassword(args: {
  apiBaseUrl: string;
  username: string;
  password: string;
  tenantId?: string;
  requestId?: string;
}): Promise<LoginWithPasswordResult> {
  const resolvedTenantId = String(args.tenantId || '').trim() || 'system';
  const result = await postJson<LoginResponse>({
    baseUrl: args.apiBaseUrl,
    path: '/auth/login',
    tenantId: resolvedTenantId,
    requestId: args.requestId,
    body: {
      username: args.username,
      password: args.password,
    },
  });

  if (!result?.token || typeof result.token !== 'string') {
    throw new Error('Token JWT não retornado pelo login');
  }

  return {
    token: result.token,
    agent: result.agent,
  };
}
