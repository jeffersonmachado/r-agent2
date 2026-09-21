'use strict';

/**
 * api/services/aiCredentialValidation.js
 *
 * Validação real de credenciais de provider de IA — fonte única, reutilizada por
 * `api/modules/config/service.js` (testa uma chave ainda não salva, digitada no formulário) e
 * `api/modules/tenant/aiWorkflows.js` (testa a chave JÁ SALVA de um tenant). Antes desta
 * extração as duas rotas mantinham cópias idênticas desta função — consolidado aqui para não
 * duplicar a classificação de erro em dois lugares.
 *
 * Além de validar (chamada real ao provider, nunca só formato), classifica o resultado em um
 * `status` estável — usado pela UI para destacar quando uma credencial está sem saldo, em vez de
 * a única opção disponível até aqui ser apagar a credencial inteira ao descobrir o problema.
 */

const STATUS = {
  VALID: 'valid',
  INVALID_TOKEN: 'invalid_token',
  NO_CREDIT: 'no_credit',
  ERROR: 'error',
};

// Sinais textuais de "sem saldo/quota" que aparecem na mensagem de erro de diferentes
// providers, independente do HTTP status usado (cada um sinaliza de um jeito): OpenAI costuma
// devolver 429 com "insufficient_quota"/"exceeded your current quota"; Anthropic devolve mensagem
// contendo "credit balance is too low"; DeepSeek devolve "Insufficient Balance". Checar por texto
// é mais robusto entre providers do que confiar só no código HTTP.
const NO_CREDIT_PATTERNS = [
  /credit balance/i,
  /insufficient[_\s]?(quota|balance|funds?)/i,
  /balance is too low/i,
  /exceeded.*quota/i,
  /out of (credits?|balance)/i,
];

function classifyStatus({ httpStatus, message }) {
  const text = String(message || '');
  if (NO_CREDIT_PATTERNS.some((re) => re.test(text))) return STATUS.NO_CREDIT;
  if (httpStatus === 402) return STATUS.NO_CREDIT;
  if (httpStatus === 401) return STATUS.INVALID_TOKEN;
  if (httpStatus === 403) return STATUS.INVALID_TOKEN;
  return STATUS.ERROR;
}

/**
 * @param {string} provider
 * @param {string} apiKey
 * @returns {Promise<{valid:boolean, error:string|null, status:string}>}
 */
async function validateProviderCredentials(provider, apiKey) {
  const cleanApiKey = String(apiKey || '').trim();
  if (!cleanApiKey) {
    return { valid: false, error: 'Token não pode estar vazio', status: STATUS.ERROR };
  }

  // eslint-disable-next-line global-require
  const aiProviderRegistryService = require('./aiProviderRegistryService');
  const def = await aiProviderRegistryService.getProviderDef(String(provider || '').trim().toLowerCase());
  if (!def) {
    return { valid: false, error: 'Provider não suportado', status: STATUS.ERROR };
  }

  const baseUrl = def.baseUrl.replace(/\/$/, '');

  try {
    if (def.kind === 'anthropic') {
      const response = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': cleanApiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: def.validationModel || 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'test' }],
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json().catch(() => null);
        return data?.content
          ? { valid: true, error: null, status: STATUS.VALID }
          : { valid: false, error: `Resposta inválida da API ${def.label}`, status: STATUS.ERROR };
      }

      const errorData = await response.json().catch(() => ({}));
      const message = errorData.error?.message || `Erro ${response.status}: ${response.statusText}`;
      const status = classifyStatus({ httpStatus: response.status, message });
      if (response.status === 401) return { valid: false, error: 'Token inválido ou expirado', status };
      if (response.status === 403 && status === STATUS.INVALID_TOKEN) {
        return { valid: false, error: 'Token não tem permissão para acessar a API', status };
      }
      return { valid: false, error: message, status };
    }

    // openai-sdk e openai-compatible: valida via GET /models com Bearer
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cleanApiKey}` },
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json().catch(() => null);
      return Array.isArray(data?.data)
        ? { valid: true, error: null, status: STATUS.VALID }
        : { valid: false, error: `Resposta inválida da API ${def.label}`, status: STATUS.ERROR };
    }

    const errorData = await response.json().catch(() => ({}));
    const message = errorData.error?.message || `Erro ${response.status}: ${response.statusText}`;
    const status = classifyStatus({ httpStatus: response.status, message });
    if (response.status === 401) return { valid: false, error: 'Token inválido ou expirado', status };
    if (response.status === 403 && status === STATUS.INVALID_TOKEN) {
      return { valid: false, error: 'Token não tem permissão para acessar a API', status };
    }
    return { valid: false, error: message, status };
  } catch (validationError) {
    if (validationError.name === 'AbortError' || validationError.name === 'TimeoutError') {
      return { valid: false, error: 'Timeout ao validar token. Verifique sua conexão com a internet.', status: STATUS.ERROR };
    }
    if (validationError.name === 'TypeError' && String(validationError.message || '').includes('fetch')) {
      return { valid: false, error: 'Erro de conexão. Verifique sua conexão com a internet.', status: STATUS.ERROR };
    }
    return { valid: false, error: validationError.message || 'Erro ao validar token', status: STATUS.ERROR };
  }
}

/**
 * Busca o saldo real do provider, quando ele expõe uma API de billing consultável com a mesma
 * API key de uso. Hoje só a DeepSeek documenta publicamente esse endpoint
 * (`GET /user/balance`); para os demais providers (OpenAI, Anthropic, Kimi/Moonshot) não existe
 * endpoint de saldo utilizável com a chave padrão — retorna `null` sem tentar nada.
 *
 * Nunca lança: best-effort, chamado depois de uma validação já bem-sucedida, timeout curto.
 *
 * @returns {Promise<{amount:number, currency:string}|null>}
 */
async function fetchProviderBalance(provider, apiKey) {
  const normalized = String(provider || '').trim().toLowerCase();
  const cleanApiKey = String(apiKey || '').trim();
  if (!cleanApiKey) return null;

  if (normalized === 'deepseek') {
    try {
      const response = await fetch('https://api.deepseek.com/user/balance', {
        method: 'GET',
        headers: { Authorization: `Bearer ${cleanApiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return null;
      const data = await response.json().catch(() => null);
      const info = Array.isArray(data?.balance_infos) ? data.balance_infos[0] : null;
      if (!info) return null;
      const amount = Number.parseFloat(info.total_balance);
      if (!Number.isFinite(amount)) return null;
      return { amount, currency: info.currency || 'USD' };
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Lista os modelIds REALMENTE disponíveis para esta API key, consultando `GET {baseUrl}/models`
 * (mesmo endpoint já usado por `validateProviderCredentials` para openai-sdk/openai-compatible —
 * reaproveitado aqui, nunca uma segunda chamada de rede paralela). Achado real: o Engineering
 * Model Router mapeia modelos estaticamente em `modelCapabilities.js` (allowlist de segurança —
 * intencional, nunca removida), mas nada verificava se um modelo mapeado ainda está de fato
 * habilitado para a chave configurada — um pilot real revelou `kimi:moonshot-v1-128k` retornando
 * "Not found the model ... or Permission denied" só na primeira tentativa de uso real (reativo,
 * depois de gastar uma chamada). Esta função permite checar isso ANTES de rotear.
 *
 * Nunca lança: retorna `null` quando o provider não expõe um endpoint de listagem consultável
 * (Anthropic também usa o shape `{data:[{id,...}]}` desde 2024, então está incluído) ou quando a
 * chamada falha por qualquer motivo — chamador trata `null` como "sem informação, não filtra".
 *
 * @returns {Promise<string[]|null>}
 */
async function listAvailableModelIds(provider, apiKey) {
  const cleanApiKey = String(apiKey || '').trim();
  if (!cleanApiKey) return null;

  // eslint-disable-next-line global-require
  const aiProviderRegistryService = require('./aiProviderRegistryService');
  const def = await aiProviderRegistryService.getProviderDef(String(provider || '').trim().toLowerCase());
  if (!def) return null;

  const baseUrl = def.baseUrl.replace(/\/$/, '');
  const headers = def.kind === 'anthropic'
    ? { 'x-api-key': cleanApiKey, 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${cleanApiKey}` };

  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    if (!Array.isArray(data?.data)) return null;
    return data.data.map((m) => m?.id).filter((id) => typeof id === 'string' && id.length > 0);
  } catch {
    return null;
  }
}

module.exports = {
  STATUS,
  classifyStatus,
  validateProviderCredentials,
  fetchProviderBalance,
  listAvailableModelIds,
};
