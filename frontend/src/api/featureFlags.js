import { fetchJson } from './client';

export function getTenantFeatureFlag(featureKey) {
  return fetchJson(`/api/tenant/feature-flags/${encodeURIComponent(String(featureKey || '').trim())}`, {
    method: 'GET',
  });
}

export async function isTenantFeatureEnabled(featureKey, fallback = false) {
  const key = String(featureKey || '').trim();
  if (!key) return fallback;
  try {
    const out = await getTenantFeatureFlag(key);
    return out?.item?.enabled === true;
  } catch (_err) {
    return fallback;
  }
}
