export async function postJson<T = unknown>(args: {
  baseUrl: string;
  path: string;
  token?: string;
  body: Record<string, unknown>;
}): Promise<T> {
  const url = `${args.baseUrl}${args.path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (args.token) {
    headers.Authorization = `Bearer ${args.token}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(args.body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data && (data.message || data.error)) || `HTTP ${response.status}`;
    throw new Error(String(message));
  }

  return data as T;
}
