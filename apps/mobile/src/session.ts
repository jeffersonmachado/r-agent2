export type StoredSession = {
  token: string;
  tenantId: string;
  agentId?: string;
  username?: string;
};

const SESSION_KEY = 'ragent2_mobile_session_v1';

type SecureStoreModule = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

function getSecureStore(): SecureStoreModule | null {
  try {
    return require('expo-secure-store') as SecureStoreModule;
  } catch {
    return null;
  }
}

export async function loadStoredSession(): Promise<StoredSession | null> {
  const SecureStore = getSecureStore();
  if (!SecureStore) return null;
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    const token = String(parsed.token || '').trim();
    const tenantId = String(parsed.tenantId || '').trim();
    if (!token || !tenantId) return null;
    return {
      token,
      tenantId,
      agentId: String(parsed.agentId || '').trim() || undefined,
      username: String(parsed.username || '').trim() || undefined,
    };
  } catch {
    return null;
  }
}

export async function saveStoredSession(session: StoredSession): Promise<void> {
  const SecureStore = getSecureStore();
  if (!SecureStore) return;
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function clearStoredSession(): Promise<void> {
  const SecureStore = getSecureStore();
  if (!SecureStore) return;
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
