/**
 * Utilitário de criptografia para segredos (API keys, etc.)
 * 
 * Usa AES-256-GCM para criptografia simétrica.
 * A chave de criptografia deve ser fornecida via ENCRYPTION_KEY (32 bytes base64).
 * 
 * IMPORTANTE: Nunca retornar dados descriptografados via API pública.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 16 bytes para AES
const SALT_LENGTH = 64; // 64 bytes para salt
const TAG_LENGTH = 16; // 16 bytes para GCM auth tag
const KEY_LENGTH = 32; // 32 bytes para AES-256

/**
 * Obtém a chave de criptografia do ambiente.
 * 
 * @returns {Buffer} Chave de criptografia (32 bytes)
 * @throws {Error} Se ENCRYPTION_KEY não estiver configurada ou for inválida
 */
function getEncryptionKey() {
  const envKey = process.env.ENCRYPTION_KEY;
  
  if (!envKey) {
    throw new Error('ENCRYPTION_KEY não configurada. Configure uma chave de 32 bytes em base64.');
  }
  
  // HEX **E** BASE64 — a mensagem de erro sempre prometeu as duas formas, mas o código só
  // decodificava base64.
  //
  // DEFEITO REAL MEDIDO (2026-10-21, run 39673283430, L0b do gate): `scripts/bootstrap/
  // ensure-local-secrets.js` considera válida (e GERA) uma chave de 64 caracteres hexadecimais —
  // `isValidEncryptionKey` aceita `/^[a-f0-9]{64}$/` e `crypto.randomBytes(32).toString('hex')`.
  // Aqui essa chave era decodificada como base64, produzindo 48 bytes, e toda cifragem de
  // credencial morria com "ENCRYPTION_KEY deve ter exatamente 32 bytes" — 33 testes de 11 suítes
  // de integração vermelhos num ambiente que o próprio bootstrap declarou pronto. Localmente o
  // `.env` do operador tem chave base64, então o defeito nunca aparecia: produtores e consumidor
  // discordavam sobre o formato.
  //
  // Ordem: base64 primeiro (formato histórico, nenhuma chave em uso é hex — uma string de 64 hex
  // decodificada como base64 dá 48 bytes e era REJEITADA), hex quando a forma é inequívoca.
  const rawKey = String(envKey).trim();
  const candidatos = [Buffer.from(rawKey, 'base64')];
  if (/^[a-f0-9]{64}$/i.test(rawKey)) {
    const hex = Buffer.from(rawKey, 'hex');
    if (hex.length === KEY_LENGTH) candidatos.push(hex);
  }
  const keyBuffer = candidatos.find((candidato) => candidato.length === KEY_LENGTH);

  if (!keyBuffer) {
    throw new Error(`ENCRYPTION_KEY deve ter exatamente ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} caracteres em hex ou ${Math.ceil(KEY_LENGTH * 4 / 3)} caracteres em base64)`);
  }

  return keyBuffer;
}

/**
 * Criptografa um texto usando AES-256-GCM.
 * 
 * @param {string} plaintext - Texto a ser criptografado
 * @returns {string} Texto criptografado em formato: salt:iv:tag:ciphertext (tudo em base64)
 */
function encrypt(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('Plaintext deve ser uma string não vazia');
  }
  
  const key = getEncryptionKey();
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  // Deriva uma chave usando PBKDF2 com o salt
  const derivedKey = crypto.pbkdf2Sync(key, salt, 100000, KEY_LENGTH, 'sha256');
  
  const cipher = crypto.createCipheriv(ALGORITHM, derivedKey, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  const tag = cipher.getAuthTag();
  
  // Formato: salt:iv:tag:ciphertext (tudo em base64)
  const result = [
    salt.toString('base64'),
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64')
  ].join(':');
  
  return result;
}

/**
 * Descriptografa um texto criptografado.
 * 
 * @param {string} encryptedData - Texto criptografado no formato: salt:iv:tag:ciphertext
 * @returns {string} Texto descriptografado
 * @throws {Error} Se a descriptografia falhar (dados corrompidos ou chave incorreta)
 */
function decrypt(encryptedData) {
  if (!encryptedData || typeof encryptedData !== 'string') {
    throw new Error('Encrypted data deve ser uma string não vazia');
  }
  
  const parts = encryptedData.split(':');
  if (parts.length !== 4) {
    throw new Error('Formato de dados criptografados inválido. Esperado: salt:iv:tag:ciphertext');
  }
  
  const [saltBase64, ivBase64, tagBase64, ciphertextBase64] = parts;
  
  try {
    const salt = Buffer.from(saltBase64, 'base64');
    const iv = Buffer.from(ivBase64, 'base64');
    const tag = Buffer.from(tagBase64, 'base64');
    const encrypted = Buffer.from(ciphertextBase64, 'base64');
    
    const key = getEncryptionKey();
    const derivedKey = crypto.pbkdf2Sync(key, salt, 100000, KEY_LENGTH, 'sha256');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  } catch (err) {
    throw new Error(`Erro ao descriptografar: ${err.message}`);
  }
}

/**
 * Gera uma chave de criptografia aleatória em base64.
 * Útil para gerar ENCRYPTION_KEY inicial.
 * 
 * @returns {string} Chave em base64 (32 bytes)
 */
function generateEncryptionKey() {
  const key = crypto.randomBytes(KEY_LENGTH);
  return key.toString('base64');
}

module.exports = {
  encrypt,
  decrypt,
  generateEncryptionKey,
  getEncryptionKey,
};
