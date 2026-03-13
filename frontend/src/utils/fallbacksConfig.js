/**
 * Gerenciador de configuração de fallbacks (centralizado em /config).
 *
 * Objetivo:
 * - Permitir que o uso de fallbacks seja explícito e configurável.
 * - Todos os fallbacks devem ser false por padrão.
 */
import { fetchJson } from '../api/client';

const CONFIG_ENDPOINT = '/config';
let cachedFallbacks = null;
let lastFetchTime = 0;
const FETCH_COOLDOWN = 5000;

async function loadFallbacksConfig() {
  if (cachedFallbacks && Date.now() - lastFetchTime < FETCH_COOLDOWN) {
    return cachedFallbacks;
  }

  try {
    const apiConfig = await fetchJson(CONFIG_ENDPOINT);
    const fallbacks = apiConfig?.fallbacks && typeof apiConfig.fallbacks === 'object' ? apiConfig.fallbacks : {};
    cachedFallbacks = fallbacks;
    lastFetchTime = Date.now();
    return cachedFallbacks;
  } catch {
    // Se não conseguir carregar, mantém comportamento seguro: false por padrão (não usa fallback).
    cachedFallbacks = {};
    lastFetchTime = Date.now();
    return cachedFallbacks;
  }
}

function getByPath(obj, path) {
  if (!obj || typeof obj !== 'object') return undefined;
  const keys = String(path || '').split('.').filter(Boolean);
  let cur = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

/**
 * Lê flag booleana de fallback.
 *
 * @param {string} path - ex: "frontendNavigationHardRedirect"
 * @param {boolean} [defaultValue=false]
 */
export async function getFallbackFlag(path, defaultValue = false) {
  const fallbacks = await loadFallbacksConfig();
  const v = getByPath(fallbacks, path);
  return v === true ? true : (v === false ? false : defaultValue);
}

