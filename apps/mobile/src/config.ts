export const DEFAULT_API_BASE_URL = 'http://10.0.2.2:3000';

export function getApiBaseUrl(): string {
  const envValue = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (typeof envValue === 'string' && envValue.trim().length > 0) {
    return envValue.trim().replace(/\/$/, '');
  }
  return DEFAULT_API_BASE_URL;
}
