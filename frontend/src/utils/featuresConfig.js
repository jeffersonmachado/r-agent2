/**
 * Gerenciador de configuração de features.
 *
 * Responsabilidades:
 * - Carregar configuração de features da API centralizada
 * - Persistir mudanças em localStorage
 * - Fornecer interface para ler e atualizar features
 *
 * Estratégia:
 * - Carrega configuração inicial de /config (API centralizada)
 * - Sobrescreve com valores de localStorage se existirem
 * - Permite atualização via API que persiste em localStorage
 */

import { fetchJson } from '../api/client';

const CONFIG_ENDPOINT = '/config';
const STORAGE_KEY = 'app_features_config';

/**
 * Cache da configuração carregada
 */
let cachedConfig = null;
let loadPromise = null;
let isLoading = false;
let lastFetchTime = 0;
const FETCH_COOLDOWN = 5000; // 5 segundos entre fetches

/**
 * Carrega a configuração de features.
 * 
 * Ordem de precedência:
 * 1. localStorage (se existir) - permite override pelo usuário
 * 2. Endpoint /config da API (configuração centralizada)
 * 3. Valores padrão
 *
 * @returns {Promise<Object>} Configuração de features
 */
async function loadFeaturesConfig() {
  // Retorna cache se já foi carregado e ainda é recente
  if (cachedConfig && Date.now() - lastFetchTime < FETCH_COOLDOWN) {
    return cachedConfig;
  }

  // Se já há uma promise de carregamento em andamento, retorna ela
  if (loadPromise && isLoading) {
    return loadPromise;
  }

  // Previne múltiplas chamadas simultâneas
  if (isLoading) {
    // Aguarda a promise existente
    return loadPromise || Promise.resolve(cachedConfig || { aiTasksEnabled: true, version: '1.0.0' });
  }

  isLoading = true;
  loadPromise = (async () => {
    const defaultConfig = {
      aiTasksEnabled: true,
      useRealAiApi: false, // Por padrão usa implementação mock
      NEW_NAVIGATION: true,
      version: '1.0.0',
    };

    try {
      // Tenta carregar do localStorage primeiro (override do usuário)
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          cachedConfig = { ...defaultConfig, ...parsed };
          lastFetchTime = Date.now();
          isLoading = false;
          return cachedConfig;
        } catch (err) {
          console.warn('Erro ao parsear configuração do localStorage, usando padrão', err);
        }
      }

      // Tenta carregar do endpoint de configuração da API (com cooldown)
      const timeSinceLastFetch = Date.now() - lastFetchTime;
      if (timeSinceLastFetch >= FETCH_COOLDOWN) {
        try {
          // Usa fetchJson que já trata Content-Type e erros adequadamente
          const apiConfig = await fetchJson(CONFIG_ENDPOINT);
          const features = apiConfig.features || {};
          cachedConfig = { ...defaultConfig, ...features };
          lastFetchTime = Date.now();
          
          // Salva no localStorage para cache
          localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedConfig));
          
          isLoading = false;
          return cachedConfig;
        } catch (err) {
          // fetchJson já trata erros de rede e HTTP adequadamente
          // Em dev, loga o erro; em produção, silenciosamente usa padrão
          if (import.meta.env.DEV) {
            // Não loga 404 como erro, pois pode ser esperado se o endpoint não existir
            if (err.status !== 404) {
              console.warn('Erro ao carregar configuração de features da API, usando padrão', {
                status: err.status,
                message: err.message,
              });
            }
          }
        }
      } else {
        // Ainda está no cooldown, retorna cache existente ou padrão
        if (cachedConfig) {
          isLoading = false;
          return cachedConfig;
        }
      }
    } catch (err) {
      console.warn('Erro ao carregar configuração de features, usando padrão', err);
    }

    // Fallback: usa valores padrão
    cachedConfig = defaultConfig;
    lastFetchTime = Date.now();
    isLoading = false;
    return cachedConfig;
  })();

  return loadPromise;
}

/**
 * Obtém o valor de uma feature específica.
 *
 * @param {string} featureName - Nome da feature
 * @param {any} defaultValue - Valor padrão se não encontrado
 * @returns {Promise<any>} Valor da feature
 */
export async function getFeature(featureName, defaultValue = false) {
  const config = await loadFeaturesConfig();
  return config[featureName] !== undefined ? config[featureName] : defaultValue;
}

/**
 * Obtém toda a configuração de features.
 *
 * @returns {Promise<Object>} Configuração completa
 */
export async function getFeaturesConfig() {
  return loadFeaturesConfig();
}

/**
 * Atualiza o valor de uma feature e persiste em localStorage.
 *
 * @param {string} featureName - Nome da feature
 * @param {any} value - Novo valor
 * @returns {Promise<void>}
 */
export async function setFeature(featureName, value) {
  const config = await loadFeaturesConfig();
  config[featureName] = value;
  
  // Atualiza cache
  cachedConfig = config;
  
  // Persiste em localStorage
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

/**
 * Atualiza múltiplas features de uma vez.
 *
 * @param {Object} updates - Objeto com as features a atualizar
 * @returns {Promise<void>}
 */
export async function updateFeatures(updates) {
  const config = await loadFeaturesConfig();
  Object.assign(config, updates);
  
  // Atualiza cache
  cachedConfig = config;
  
  // Persiste em localStorage
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

/**
 * Reseta a configuração para os valores da API centralizada.
 * Remove override do localStorage.
 *
 * @returns {Promise<void>}
 */
export async function resetToFileConfig() {
  try {
    // Usa fetchJson que já trata Content-Type e erros adequadamente
    const apiConfig = await fetchJson(CONFIG_ENDPOINT);
    const features = apiConfig.features || {};
    cachedConfig = features;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(features));
  } catch (err) {
    // fetchJson já trata erros adequadamente
    // Em dev, loga o erro; em produção, silenciosamente remove localStorage
    if (import.meta.env.DEV && err.status !== 404) {
      console.warn('Erro ao resetar configuração', {
        status: err.status,
        message: err.message,
      });
    }
    localStorage.removeItem(STORAGE_KEY);
    cachedConfig = null;
    loadPromise = null;
  }
}

/**
 * Recarrega a configuração (útil após mudanças no arquivo JSON).
 *
 * @returns {Promise<Object>} Nova configuração
 */
export async function reloadConfig() {
  cachedConfig = null;
  loadPromise = null;
  isLoading = false;
  lastFetchTime = 0; // Reseta cooldown para forçar novo fetch
  return loadFeaturesConfig();
}
