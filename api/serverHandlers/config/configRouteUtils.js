const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', '..', 'data');
const configFile = path.join(dataDir, 'config.json');

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

async function validateProviderCredentials(provider, apiKey) {
  const cleanApiKey = String(apiKey || '').trim();
  if (!cleanApiKey) {
    return { valid: false, error: 'Token não pode estar vazio' };
  }

  try {
    if (provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: { Authorization: `Bearer ${cleanApiKey}` },
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json().catch(() => null);
        return Array.isArray(data?.data)
          ? { valid: true, error: null }
          : { valid: false, error: 'Resposta inválida da API OpenAI' };
      }

      const errorData = await response.json().catch(() => ({}));
      if (response.status === 401) return { valid: false, error: 'Token inválido ou expirado' };
      if (response.status === 403) return { valid: false, error: 'Token não tem permissão para acessar a API' };
      return { valid: false, error: errorData.error?.message || `Erro ${response.status}: ${response.statusText}` };
    }

    if (provider === 'anthropic') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': cleanApiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'test' }],
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json().catch(() => null);
        return data?.content
          ? { valid: true, error: null }
          : { valid: false, error: 'Resposta inválida da API Anthropic' };
      }

      const errorData = await response.json().catch(() => ({}));
      if (response.status === 401) return { valid: false, error: 'Token inválido ou expirado' };
      if (response.status === 403) return { valid: false, error: 'Token não tem permissão para acessar a API' };
      return { valid: false, error: errorData.error?.message || `Erro ${response.status}: ${response.statusText}` };
    }

    return { valid: false, error: 'Provider não suportado' };
  } catch (validationError) {
    if (validationError.name === 'AbortError' || validationError.name === 'TimeoutError') {
      return { valid: false, error: 'Timeout ao validar token. Verifique sua conexão com a internet.' };
    }
    if (validationError.name === 'TypeError' && String(validationError.message || '').includes('fetch')) {
      return { valid: false, error: 'Erro de conexão. Verifique sua conexão com a internet.' };
    }
    return { valid: false, error: validationError.message || 'Erro ao validar token' };
  }
}

module.exports = {
  ensureDataDir,
  validateProviderCredentials,
  configFile,
};
