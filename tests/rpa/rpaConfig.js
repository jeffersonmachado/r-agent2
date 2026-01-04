/**
 * CONTRATO DE CONFIGURAÇÃO GLOBAL DO RPA
 * 
 * Este arquivo define o CONTRATO explícito de configuração do RPA.
 * 
 * REGRAS:
 * - Config controla velocidade e comportamento
 * - Config NUNCA é gravada no seed
 * - Config pode ser alterada sem regravar seeds
 * - Seed descreve O QUE foi feito
 * - Config decide COMO é executado
 */

const fs = require('fs');
const path = require('path');
const mainConfig = require('../../api/utils/config');

// Carrega configuração de rpa.config.json se existir
let configFromFile = {};
const configPath = path.join(__dirname, 'rpa.config.json');
if (fs.existsSync(configPath)) {
  try {
    configFromFile = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    console.warn('Erro ao carregar rpa.config.json, usando defaults:', error.message);
  }
}

/**
 * CONTRATO DE CONFIGURAÇÃO POR MODO
 * 
 * Cada modo define:
 * - mode: record | playback | ci
 * - typingSpeedMs: Delay entre caracteres durante digitação (0 = instantâneo)
 * - actionDelayMs: Delay entre ações (aplicado via speedMultiplier)
 * - screenStabilizeMs: Tempo para estabilizar tela após ação
 * - speedMultiplier: Multiplicador de velocidade (1.0 = normal, >1.0 = mais rápido)
 * - showCursor: Mostrar cursor durante execução (apenas visual)
 * - headless: Executar sem interface gráfica
 */
const defaultConfig = {
  modes: {
    record: {
      mode: 'record',
      headless: false,
      showCursor: true,
      typingSpeedMs: 50,        // Digitação visível caractere a caractere
      actionDelayMs: 300,       // Delay entre ações
      screenStabilizeMs: 500,    // Estabilização da tela
      speedMultiplier: 1.0,     // Sem aceleração na gravação
    },
    playback: {
      mode: 'playback',
      headless: false,
      showCursor: true,
      typingSpeedMs: 50,        // Digitação visível caractere a caractere
      actionDelayMs: 300,       // Delay entre ações
      screenStabilizeMs: 500,   // Estabilização da tela
      speedMultiplier: 1.0,     // Velocidade normal (1x)
    },
    ci: {
      mode: 'ci',
      headless: true,
      showCursor: false,
      typingSpeedMs: 0,         // Digitação instantânea
      actionDelayMs: 0,         // Sem delays
      screenStabilizeMs: 100,   // Estabilização mínima
      speedMultiplier: 10.0,    // Aceleração máxima
    },
  },
  playwright: {
    headless: true,
    slowMo: 100,
    timeout: 30000,
    screenshot: {
      enabled: true,
      path: './tests/rpa/screenshots',
      onFailure: true,
    },
  },
  retry: {
    maxAttempts: 3,
    delay: 1000,
  },
  errorDetection: {
    enabled: true,
    screenshotOnError: true,
    logErrors: true,
  },
  dataPopulation: {
    seedPath: './tests/seeds',
    validateBeforeUse: true,
  },
  urls: {
    base: process.env.TEST_BASE_URL || 
          mainConfig.get('tests.rpa.apiUrl') ||
          mainConfig.get('api.baseUrl') ||
          'http://localhost:3000',
    frontend: process.env.TEST_FRONTEND_URL || 
              mainConfig.get('tests.rpa.frontendUrl') ||
              mainConfig.get('frontend.url') ||
              'http://localhost:5173',
    api: process.env.TEST_API_URL || 
         mainConfig.get('tests.rpa.apiUrl') ||
         mainConfig.get('api.baseUrl') ||
         'http://localhost:3000',
  },
  credentials: {
    testUser: {
      email: process.env.TEST_USER_EMAIL || 'test@example.com',
      password: process.env.TEST_USER_PASSWORD || 'test123',
    },
    admin: {
      email: process.env.TEST_ADMIN_EMAIL || 'admin@example.com',
      password: process.env.TEST_ADMIN_PASSWORD || 'admin123',
    },
  },
};

// Merge: arquivo sobrescreve defaults
const config = {
  modes: { ...defaultConfig.modes, ...(configFromFile.modes || {}) },
  playwright: { ...defaultConfig.playwright, ...(configFromFile.playwright || {}) },
  retry: { ...defaultConfig.retry, ...(configFromFile.retry || {}) },
  errorDetection: { ...defaultConfig.errorDetection, ...(configFromFile.errorDetection || {}) },
  dataPopulation: { ...defaultConfig.dataPopulation, ...(configFromFile.dataPopulation || {}) },
  urls: { ...defaultConfig.urls, ...(configFromFile.urls || {}) },
  credentials: { ...defaultConfig.credentials, ...(configFromFile.credentials || {}) },
};

/**
 * Obtém configuração para um modo específico.
 * 
 * @param {string} mode - Modo: 'record', 'playback', 'ci'
 * @returns {Object} Configuração do modo com contrato explícito
 */
function getModeConfig(mode = 'playback') {
  const modeConfig = config.modes[mode] || config.modes.playback;
  
  // Garante que todas as propriedades do contrato estão presentes
  return {
    mode: modeConfig.mode || mode,
    headless: modeConfig.headless !== undefined ? modeConfig.headless : false,
    showCursor: modeConfig.showCursor !== undefined ? modeConfig.showCursor : true,
    typingSpeedMs: modeConfig.typingSpeedMs !== undefined ? modeConfig.typingSpeedMs : 50,
    actionDelayMs: modeConfig.actionDelayMs !== undefined ? modeConfig.actionDelayMs : 300,
    screenStabilizeMs: modeConfig.screenStabilizeMs !== undefined ? modeConfig.screenStabilizeMs : 500,
    speedMultiplier: modeConfig.speedMultiplier !== undefined ? modeConfig.speedMultiplier : 1.0,
  };
}

module.exports = {
  ...config,
  getModeConfig,
};

