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
          const response = await fetch(CONFIG_ENDPOINT);
          if (response.ok) {
            // Verifica se a resposta é JSON antes de fazer parse
            const contentType = response.headers.get('Content-Type') || '';
            const isJson = contentType.includes('application/json');
            
            if (!isJson) {
              // Se não for JSON, descarta a resposta silenciosamente
              // (não precisa ler o body, apenas ignora)
              if (import.meta.env.DEV) {
                // Em dev, podemos ler uma amostra para debug
                try {
                  const clonedResponse = response.clone();
                  const text = await clonedResponse.text();
                  console.warn('Resposta da API não é JSON, usando padrão', {
                    contentType,
                    preview: text.substring(0, 100),
                  });
                } catch {
                  // Ignora erro ao ler
                }
              }
            } else {
              // Content-Type indica JSON, tenta fazer parse
              try {
                const apiConfig = await response.json();
                const features = apiConfig.features || {};
                cachedConfig = { ...defaultConfig, ...features };
                lastFetchTime = Date.now();
                
                // Salva no localStorage para cache
                localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedConfig));
                
                isLoading = false;
                return cachedConfig;
              } catch (jsonErr) {
                // Se falhar ao fazer parse do JSON (mesmo com Content-Type correto)
                // Pode ser que o servidor esteja retornando HTML com Content-Type incorreto
                if (jsonErr instanceof SyntaxError) {
                  // Em dev, tenta ler como texto para debug
                  if (import.meta.env.DEV) {
                    try {
                      const clonedResponse = response.clone();
                      const text = await clonedResponse.text();
                      console.warn('Erro ao fazer parse do JSON da API (Content-Type pode estar incorreto), usando padrão', {
                        error: jsonErr.message,
                        contentType,
                        preview: text.substring(0, 100),
                      });
                    } catch {
                      // Ignora erro ao ler
                    }
                  }
                } else {
                  // Re-lança se não for erro de parse
                  throw jsonErr;
                }
              }
            }
          } else {
            // Resposta não é ok (status != 2xx)
            if (import.meta.env.DEV) {
              console.warn(`Resposta da API com status ${response.status}, usando padrão`);
            }
          }
        } catch (err) {
          // Erro de rede ou outro erro não relacionado a parse
          if (err instanceof SyntaxError && err.message.includes('JSON')) {
            // Este erro não deveria mais acontecer, mas mantemos o tratamento
            if (import.meta.env.DEV) {
              console.warn('Erro ao carregar configuração de features da API (resposta não é JSON válido), usando padrão', err);
            }
          } else if (import.meta.env.DEV) {
            console.warn('Erro ao carregar configuração de features da API, usando padrão', err);
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
    const response = await fetch(CONFIG_ENDPOINT);
    if (response.ok) {
      // Verifica se a resposta é JSON antes de fazer parse
      const contentType = response.headers.get('Content-Type') || '';
      const isJson = contentType.includes('application/json');
      
      if (!isJson) {
        // Se não for JSON, tenta ler como texto para debug
        const text = await response.text();
        console.warn('Resposta da API não é JSON ao resetar configuração', {
          contentType,
          preview: text.substring(0, 100),
        });
        localStorage.removeItem(STORAGE_KEY);
        cachedConfig = null;
        loadPromise = null;
      } else {
        const apiConfig = await response.json();
        const features = apiConfig.features || {};
        cachedConfig = features;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(features));
      }
    } else {
      // Se não conseguir carregar da API, remove localStorage
      localStorage.removeItem(STORAGE_KEY);
      cachedConfig = null;
      loadPromise = null;
    }
  } catch (err) {
    // Se o erro for de parse JSON, fornece informação mais útil
    if (err instanceof SyntaxError && err.message.includes('JSON')) {
      console.warn('Erro ao resetar configuração (resposta não é JSON válido)', err);
    } else {
      console.warn('Erro ao resetar configuração', err);
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

