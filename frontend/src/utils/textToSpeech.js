/**
 * Utilitário de Text-to-Speech (TTS) com qualidade melhorada
 * 
 * Melhora a qualidade da voz reduzindo o som "metalizado"
 * usando configurações otimizadas da Web Speech API
 */

/**
 * Configurações de voz otimizadas para melhor qualidade
 */
const VOICE_CONFIG = {
  // Vozes preferidas (em ordem de preferência)
  preferredVoices: [
    'Microsoft Maria - Portuguese (Brazil)',
    'Microsoft Heloisa - Portuguese (Brazil)',
    'Google português do Brasil',
    'Microsoft Daniel - Portuguese (Brazil)',
    'Microsoft Heloisa',
    'Microsoft Maria',
  ],
  
  // Configurações padrão otimizadas
  defaultSettings: {
    rate: 1.0,        // Velocidade normal (reduzir pode melhorar qualidade)
    pitch: 1.0,       // Tom normal
    volume: 1.0,      // Volume máximo
    lang: 'pt-BR',    // Português do Brasil
  },
  
  // Configurações para melhor qualidade (mais natural)
  qualitySettings: {
    rate: 0.95,       // Ligeiramente mais lento para melhor clareza
    pitch: 0.98,      // Tom ligeiramente mais baixo (mais natural)
    volume: 0.9,      // Volume ligeiramente reduzido
  },
};

/**
 * Encontra a melhor voz disponível no sistema
 * @returns {SpeechSynthesisVoice|null}
 */
function findBestVoice() {
  if (!window.speechSynthesis) {
    return null;
  }

  const voices = window.speechSynthesis.getVoices();
  
  // Tenta encontrar uma voz preferida
  for (const preferredName of VOICE_CONFIG.preferredVoices) {
    const voice = voices.find(v => 
      v.name.includes(preferredName) || 
      v.name.toLowerCase().includes(preferredName.toLowerCase())
    );
    if (voice) {
      return voice;
    }
  }
  
  // Se não encontrar, procura por qualquer voz em português do Brasil
  const ptBrVoice = voices.find(v => 
    v.lang === 'pt-BR' || 
    v.lang.startsWith('pt-BR') ||
    v.name.toLowerCase().includes('português') ||
    v.name.toLowerCase().includes('brazil')
  );
  
  if (ptBrVoice) {
    return ptBrVoice;
  }
  
  // Fallback: primeira voz disponível
  return voices.length > 0 ? voices[0] : null;
}

/**
 * Aguarda as vozes serem carregadas
 * @returns {Promise<void>}
 */
function waitForVoices() {
  return new Promise((resolve) => {
    if (window.speechSynthesis.getVoices().length > 0) {
      resolve();
      return;
    }
    
    // Alguns navegadores carregam vozes de forma assíncrona
    window.speechSynthesis.onvoiceschanged = () => {
      resolve();
    };
    
    // Timeout de segurança
    setTimeout(resolve, 1000);
  });
}

/**
 * Para qualquer fala em andamento
 */
function stopSpeaking() {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Fala um texto com qualidade melhorada
 * @param {string} text - Texto para falar
 * @param {Object} options - Opções de configuração
 * @param {boolean} options.useQualitySettings - Usa configurações de qualidade melhorada
 * @param {number} options.rate - Velocidade (0.1 a 10)
 * @param {number} options.pitch - Tom (0 a 2)
 * @param {number} options.volume - Volume (0 a 1)
 * @param {string} options.lang - Idioma (padrão: pt-BR)
 * @param {Function} options.onStart - Callback quando começar
 * @param {Function} options.onEnd - Callback quando terminar
 * @param {Function} options.onError - Callback em caso de erro
 * @returns {Promise<void>}
 */
async function speak(text, options = {}) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return Promise.resolve();
  }

  if (!window.speechSynthesis) {
    console.warn('[TTS] Web Speech API não disponível');
    return Promise.reject(new Error('Web Speech API não disponível'));
  }

  // Para qualquer fala anterior
  stopSpeaking();

  // Aguarda vozes carregarem
  await waitForVoices();

  return new Promise((resolve, reject) => {
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      
      // Encontra melhor voz
      const bestVoice = findBestVoice();
      if (bestVoice) {
        utterance.voice = bestVoice;
        utterance.lang = bestVoice.lang || VOICE_CONFIG.defaultSettings.lang;
      } else {
        utterance.lang = options.lang || VOICE_CONFIG.defaultSettings.lang;
      }

      // Aplica configurações
      const useQuality = options.useQualitySettings !== false;
      const quality = useQuality ? VOICE_CONFIG.qualitySettings : {};
      
      utterance.rate = options.rate ?? quality.rate ?? VOICE_CONFIG.defaultSettings.rate;
      utterance.pitch = options.pitch ?? quality.pitch ?? VOICE_CONFIG.defaultSettings.pitch;
      utterance.volume = options.volume ?? quality.volume ?? VOICE_CONFIG.defaultSettings.volume;

      // Callbacks
      utterance.onstart = () => {
        if (options.onStart) {
          options.onStart();
        }
      };

      utterance.onend = () => {
        if (options.onEnd) {
          options.onEnd();
        }
        resolve();
      };

      utterance.onerror = (error) => {
        console.error('[TTS] Erro ao falar:', error);
        if (options.onError) {
          options.onError(error);
        }
        reject(error);
      };

      // Fala
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.error('[TTS] Erro ao criar utterance:', error);
      reject(error);
    }
  });
}

/**
 * Lista todas as vozes disponíveis (útil para debug)
 * @returns {Array<SpeechSynthesisVoice>}
 */
function getAvailableVoices() {
  if (!window.speechSynthesis) {
    return [];
  }
  return window.speechSynthesis.getVoices();
}

/**
 * Verifica se TTS está disponível
 * @returns {boolean}
 */
function isAvailable() {
  return !!(
    window.speechSynthesis &&
    window.SpeechSynthesisUtterance
  );
}

// Exporta para uso em módulos ES6
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    speak,
    stopSpeaking,
    findBestVoice,
    getAvailableVoices,
    isAvailable,
    VOICE_CONFIG,
  };
}

// Exporta para uso em ES6 modules
export {
  speak,
  stopSpeaking,
  findBestVoice,
  getAvailableVoices,
  isAvailable,
  VOICE_CONFIG,
};

