/**
 * Gerenciador de token RPA.
 * 
 * Responsabilidades:
 * - Carrega token RPA de arquivo de configuração
 * - Gera token RPA se não existir
 * - Valida token RPA
 * - Gerencia expiração de token
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const TOKEN_FILE = path.join(__dirname, '../config/rpa-token.json');
const TOKEN_ENV_VAR = 'RPA_TOKEN';

/**
 * Gera um token RPA único e seguro.
 * 
 * @returns {string} Token gerado
 */
function generateRpaToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Carrega token RPA do arquivo de configuração ou variável de ambiente.
 * 
 * @returns {string|null} Token RPA ou null se não encontrado
 */
function loadRpaToken() {
  // Prioridade 1: Variável de ambiente
  if (process.env[TOKEN_ENV_VAR]) {
    return process.env[TOKEN_ENV_VAR];
  }

  // Prioridade 2: Arquivo de configuração
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const content = fs.readFileSync(TOKEN_FILE, 'utf8');
      const config = JSON.parse(content);
      if (config.token && config.token.trim() !== '') {
        return config.token;
      }
    }
  } catch (error) {
    console.warn(`Aviso: Erro ao carregar token RPA do arquivo: ${error.message}`);
  }

  return null;
}

/**
 * Salva token RPA no arquivo de configuração.
 * 
 * @param {string} token - Token a ser salvo
 * @param {Object} options - Opções adicionais
 * @param {number} options.expiresInDays - Dias até expiração (padrão: não expira)
 * @returns {boolean} Se salvou com sucesso
 */
function saveRpaToken(token, options = {}) {
  try {
    const configDir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const config = {
      token,
      description: 'Token exclusivo para automação RPA. Gere um token único e seguro.',
      generatedAt: new Date().toISOString(),
      expiresAt: null,
      note: 'Este arquivo deve ser mantido seguro e não deve ser commitado no repositório.'
    };

    if (options.expiresInDays) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + options.expiresInDays);
      config.expiresAt = expiresAt.toISOString();
    }

    fs.writeFileSync(TOKEN_FILE, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(`Erro ao salvar token RPA: ${error.message}`);
    return false;
  }
}

/**
 * Gera e salva um novo token RPA.
 * 
 * @param {Object} options - Opções
 * @returns {string} Token gerado
 */
function generateAndSaveRpaToken(options = {}) {
  const token = generateRpaToken();
  saveRpaToken(token, options);
  return token;
}

/**
 * Verifica se o token RPA está válido (não expirado).
 * 
 * @param {string} token - Token a verificar
 * @returns {boolean} Se o token é válido
 */
function isTokenValid(token) {
  if (!token || token.trim() === '') {
    return false;
  }

  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const content = fs.readFileSync(TOKEN_FILE, 'utf8');
      const config = JSON.parse(content);
      
      // Verifica se o token corresponde
      if (config.token !== token) {
        return false;
      }

      // Verifica se expirou
      if (config.expiresAt) {
        const expiresAt = new Date(config.expiresAt);
        if (expiresAt < new Date()) {
          return false;
        }
      }

      return true;
    }
  } catch (error) {
    console.warn(`Aviso: Erro ao verificar token RPA: ${error.message}`);
  }

  return false;
}

/**
 * Obtém token RPA, gerando um novo se não existir.
 * 
 * @returns {string} Token RPA
 */
function getOrCreateRpaToken() {
  let token = loadRpaToken();
  
  if (!token) {
    console.log('🔑 Gerando novo token RPA...');
    token = generateAndSaveRpaToken();
    console.log(`✅ Token RPA gerado e salvo em: ${TOKEN_FILE}`);
    console.log('⚠️  IMPORTANTE: Mantenha este arquivo seguro e não o commite no repositório!');
  }

  return token;
}

module.exports = {
  generateRpaToken,
  loadRpaToken,
  saveRpaToken,
  generateAndSaveRpaToken,
  isTokenValid,
  getOrCreateRpaToken,
  TOKEN_FILE,
  TOKEN_ENV_VAR,
};

