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

// ── Saldo por provider ───────────────────────────────────────────────────────────────────────
//
// Consulta de saldo é feita para TODOS os providers, sem exceção: cada id tem uma entrada no
// probe abaixo (e provedores custom caem no fallback `NOT_SUPPORTED`), e o resultado é SEMPRE um
// dos status de `BALANCE_STATUS` — nunca silêncio. Antes desta mudança só a DeepSeek era
// consultada e os demais retornavam `null` sem sequer tentar, o que a UI exibia como ausência de
// informação indistinguível de "sem endpoint".
//
// Medições reais (2026-09-29, chaves do tenant `system` + probe com chave inválida para separar
// `404 rota inexistente` de `401 rota existe`):
//
//   deepseek   GET  https://api.deepseek.com/user/balance            → 200  saldo real
//   kimi       GET  https://api.moonshot.ai/v1/users/me/balance      → 200  saldo real
//   mistral    GET  https://api.mistral.ai/v1/users/me/balance       → rota EXISTE (401 na
//                                                                      chave inválida); shape
//                                                                      não verificável sem chave
//   openai     GET  /v1/dashboard/billing/credit_grants              → 403 "must be made with a
//                                                                      session key" (a chave de
//                                                                      uso não lê créditos)
//   openai     GET  /v1/organization/costs                           → 403 "Missing scopes:
//                                                                      api.usage.read" (e devolve
//                                                                      custo, não saldo)
//   anthropic  GET  /v1/organizations/cost_report                    → rota EXISTE, exige Admin
//                                                                      API key (sk-ant-admin...)
//   groq       /balance, /users/me/balance, /usage                   → 404  não existe
//   qwen       /api/v1/users/me/balance, /compatible-mode/v1/...     → 404  não existe
//
// O probe nunca lança e nunca inventa número: quando não há saldo consultável, o `note` carrega a
// razão exata (inclusive a mensagem do próprio provider quando ela existe).
const BALANCE_STATUS = {
  // Valor de saldo real obtido do provider.
  AVAILABLE: 'available',
  // O endpoint de billing existe, mas a chave de uso não tem permissão/escopo (ex.: Admin API key).
  REQUIRES_ADMIN_KEY: 'requires_admin_key',
  // O provider não expõe saldo por API (console-only ou rota inexistente).
  NOT_SUPPORTED: 'not_supported',
  // Falha de rede/timeout/resposta inesperada.
  ERROR: 'error',
};

const BALANCE_TIMEOUT_MS = 8000;

function toAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number.parseFloat(value.replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function pickAmount(candidates) {
  for (const candidate of candidates) {
    const amount = toAmount(candidate);
    if (amount !== null) return amount;
  }
  return null;
}

/**
 * Probe declarativo por provider (`kind`: native | console_only | admin_only | none).
 * `url(ctx)` recebe `{ baseUrl, origin }` do registry — nunca uma URL hardcoded fora daqui, para
 * que um provider custom com baseUrl própria continue funcionando.
 */
const BALANCE_PROBES = {
  deepseek: {
    kind: 'native',
    url: (ctx) => `${ctx.origin}/user/balance`,
    parse: (body) => {
      const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : [];
      if (!infos.length) return null;
      const info = infos.find((i) => String(i?.currency || '').toUpperCase() === 'USD') || infos[0];
      const amount = toAmount(info?.total_balance);
      if (amount === null) return null;
      return { amount, currency: String(info?.currency || 'USD').toUpperCase() };
    },
  },
  kimi: {
    kind: 'native',
    url: (ctx) => `${ctx.baseUrl}/users/me/balance`,
    parse: (body) => {
      const amount = toAmount(body?.data?.available_balance);
      if (amount === null) return null;
      return { amount, currency: 'USD' };
    },
  },
  mistral: {
    kind: 'native',
    // Rota confirmada por probe com chave inválida (401); o NOME DOS CAMPOS não pôde ser
    // confirmado porque não há credencial Mistral neste ambiente — por isso o parser aceita os
    // nomes plausíveis em vez de fixar um que talvez não exista.
    url: (ctx) => `${ctx.baseUrl}/users/me/balance`,
    parse: (body) => {
      const source = body?.data && typeof body.data === 'object' ? body.data : body;
      const amount = pickAmount([
        source?.available_balance,
        source?.total_balance,
        source?.remaining_balance,
        source?.balance,
        source?.credits,
        source?.amount,
      ]);
      if (amount === null) return null;
      const currency = source?.currency || source?.currency_code || source?.unit;
      return { amount, currency: currency ? String(currency).toUpperCase() : 'USD' };
    },
    note: 'A rota de saldo da Mistral respondeu, mas sem valor numérico reconhecido.',
  },
  openai: {
    kind: 'console_only',
    url: (ctx) => `${ctx.origin}/v1/dashboard/billing/credit_grants`,
    // Endpoint legado: se algum dia voltar a responder para chave de uso, o valor é aproveitado.
    parse: (body) => {
      const amount = pickAmount([body?.total_available, body?.total_available_beta, body?.total_granted]);
      if (amount === null) return null;
      return { amount, currency: 'USD' };
    },
    note:
      'A OpenAI não expõe créditos/saldo para chave de uso: /v1/dashboard/billing/* exige chave de sessão do console e /v1/organization/costs exige o escopo api.usage.read (e devolve custo, não saldo). Consulte o saldo no console da OpenAI.',
  },
  anthropic: {
    kind: 'admin_only',
    url: (ctx) => `${ctx.origin}/v1/organizations/cost_report`,
    note:
      'A Anthropic só expõe billing pela Admin API (chave sk-ant-admin...); a chave de uso não lê saldo/créditos.',
  },
  groq: {
    kind: 'none',
    note:
      'A Groq não possui endpoint de saldo/créditos na API pública — o probe em /balance, /users/me/balance e /usage respondeu 404. O consumo é visto no console da Groq.',
  },
  qwen: {
    kind: 'none',
    note:
      'O Model Studio (DashScope) não possui endpoint de saldo para a API key — o probe em /api/v1/users/me/balance e /compatible-mode/v1/users/me/balance respondeu 404. O consumo é visto no console da Alibaba Cloud.',
  },
};

/**
 * Consulta o saldo do provider e devolve o RESULTADO da consulta, não só um número: para todo
 * provider sempre existe um `status` (available/requires_admin_key/not_supported/error) e, quando
 * indisponível, um `note` explicando a razão real.
 *
 * Nunca lança: best-effort, chamado depois de uma validação já bem-sucedida, com timeout curto.
 *
 * @param {string} provider
 * @param {string} apiKey
 * @returns {Promise<{provider:string, status:string, amount:number|null, currency:string|null, note:string|null}>}
 */
async function fetchProviderBalanceInfo(provider, apiKey) {
  const normalized = String(provider || '').trim().toLowerCase();
  const cleanApiKey = String(apiKey || '').trim();

  const unavailable = (status, note) => ({
    provider: normalized,
    status,
    amount: null,
    currency: null,
    note: note || null,
  });

  if (!cleanApiKey) return unavailable(BALANCE_STATUS.ERROR, 'Credencial vazia: não há como consultar saldo.');

  const probe = BALANCE_PROBES[normalized];
  if (!probe) {
    return unavailable(
      BALANCE_STATUS.NOT_SUPPORTED,
      `${normalized || 'Provider desconhecido'} não declara endpoint de saldo consultável — confira o consumo no console do provedor.`,
    );
  }
  if (probe.kind === 'none') return unavailable(BALANCE_STATUS.NOT_SUPPORTED, probe.note);

  let ctx = null;
  try {
    // eslint-disable-next-line global-require
    const aiProviderRegistryService = require('./aiProviderRegistryService');
    const def = await aiProviderRegistryService.getProviderDef(normalized);
    const baseUrl = String(def?.baseUrl || '').replace(/\/$/, '');
    ctx = baseUrl ? { baseUrl, origin: new URL(baseUrl).origin } : null;
  } catch {
    ctx = null;
  }
  if (!ctx) return unavailable(BALANCE_STATUS.ERROR, 'Base URL do provider não resolvida — não foi possível montar a consulta de saldo.');

  try {
    const response = await fetch(probe.url(ctx), {
      method: 'GET',
      headers: probe.kind === 'admin_only'
        ? { 'x-api-key': cleanApiKey, 'anthropic-version': '2023-06-01' }
        : { Authorization: `Bearer ${cleanApiKey}` },
      signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS),
    });

    if (response.ok) {
      const body = await response.json().catch(() => null);
      const parsed = typeof probe.parse === 'function' ? probe.parse(body) : null;
      if (parsed && Number.isFinite(parsed.amount)) {
        return {
          provider: normalized,
          status: BALANCE_STATUS.AVAILABLE,
          amount: parsed.amount,
          currency: parsed.currency || 'USD',
          note: null,
        };
      }
      return unavailable(
        BALANCE_STATUS.NOT_SUPPORTED,
        probe.note || 'A resposta do provider não trouxe um valor de saldo reconhecido.',
      );
    }

    const errorBody = await response.json().catch(() => null);
    const providerMessage = errorBody?.error?.message
      || (typeof errorBody?.error === 'string' ? errorBody.error : null)
      || errorBody?.message
      || (typeof errorBody?.detail === 'string' ? errorBody.detail : null)
      || null;

    if (response.status === 404) {
      return unavailable(BALANCE_STATUS.NOT_SUPPORTED, probe.note || 'Provider não expõe endpoint de saldo.');
    }
    if (response.status === 403) {
      // Chave de sessão/console (OpenAI) não é "falta de permissão recuperável": é o provider
      // dizendo que aquele dado não sai por API key.
      return unavailable(
        probe.kind === 'console_only' ? BALANCE_STATUS.NOT_SUPPORTED : BALANCE_STATUS.REQUIRES_ADMIN_KEY,
        providerMessage || probe.note || 'A chave configurada não tem permissão para consultar saldo.',
      );
    }
    if (response.status === 401) {
      return unavailable(
        probe.kind === 'native' ? BALANCE_STATUS.ERROR : BALANCE_STATUS.REQUIRES_ADMIN_KEY,
        providerMessage || probe.note || 'Credencial não autorizada a consultar saldo.',
      );
    }
    return unavailable(
      BALANCE_STATUS.ERROR,
      providerMessage || `Erro ${response.status}: ${response.statusText}`,
    );
  } catch (balanceError) {
    const timedOut = balanceError?.name === 'TimeoutError' || balanceError?.name === 'AbortError';
    return unavailable(
      BALANCE_STATUS.ERROR,
      timedOut
        ? 'Timeout ao consultar saldo do provider.'
        : (balanceError?.message || 'Falha ao consultar saldo do provider.'),
    );
  }
}

/**
 * Compatibilidade: devolve só `{ amount, currency }` — e `null` quando não há saldo consultável.
 * Prefira `fetchProviderBalanceInfo` quando o chamador precisar distinguir "provider não expõe
 * saldo" de "falha ao consultar".
 *
 * @returns {Promise<{amount:number, currency:string}|null>}
 */
async function fetchProviderBalance(provider, apiKey) {
  const info = await fetchProviderBalanceInfo(provider, apiKey);
  return info.status === BALANCE_STATUS.AVAILABLE
    ? { amount: info.amount, currency: info.currency }
    : null;
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
  BALANCE_STATUS,
  classifyStatus,
  validateProviderCredentials,
  fetchProviderBalanceInfo,
  fetchProviderBalance,
  listAvailableModelIds,
};
