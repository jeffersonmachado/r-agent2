'use strict';

/**
 * Consulta de saldo para TODOS os providers (api/services/aiCredentialValidation.js).
 *
 * Antes desta mudança só a DeepSeek era consultada e todo o resto retornava `null` sem sequer
 * tentar — a UI exibia isso como ausência de informação, indistinguível de "provider não expõe
 * saldo". O contrato agora é: para todo provider existe uma consulta e um resultado explícito
 * (`available` / `requires_admin_key` / `not_supported` / `error`), sempre com a razão real.
 *
 * As URLs e os formatos verificados aqui vieram de medição real contra as APIs (2026-09-29):
 * probe com chave inválida separa `404 rota inexistente` de `401 rota existe`, e as chaves do
 * tenant `system` confirmaram o payload de DeepSeek e Kimi.
 */

// O projeto roda com `resetMocks: true` (jest.config.cjs), o que APAGA a implementação de
// qualquer `jest.fn()` antes de cada teste — por isso o registry é mockado com funções comuns,
// que sobrevivem ao reset.
jest.mock('../../api/services/aiProviderRegistryService', () => {
  const defs = {
    openai: { id: 'openai', label: 'OpenAI', kind: 'openai-sdk', baseUrl: 'https://api.openai.com/v1' },
    anthropic: { id: 'anthropic', label: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
    deepseek: { id: 'deepseek', label: 'DeepSeek', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1' },
    kimi: { id: 'kimi', label: 'Kimi', kind: 'openai-compatible', baseUrl: 'https://api.moonshot.ai/v1' },
    mistral: { id: 'mistral', label: 'Mistral', kind: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1' },
    groq: { id: 'groq', label: 'Groq', kind: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1' },
    qwen: { id: 'qwen', label: 'Qwen', kind: 'openai-compatible', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
  };
  const getProviderDef = async (key) => defs[String(key || '').trim().toLowerCase()] || null;
  return {
    getProviderDef,
    isSupportedProvider: async (key) => Boolean(await getProviderDef(key)),
    getProviderIds: async () => Object.keys(defs),
    getRuntimeProviders: async () => defs,
  };
});

const {
  BALANCE_STATUS,
  fetchProviderBalanceInfo,
  fetchProviderBalance,
} = require('../../api/services/aiCredentialValidation');

function jsonResponse(status, payload, statusText = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: jest.fn(async () => payload),
    text: jest.fn(async () => JSON.stringify(payload ?? {})),
  };
}

describe('consulta de saldo por provider', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('providers com saldo consultável pela chave de uso', () => {
    it('DeepSeek: lê balance_infos na origem (sem /v1) e normaliza a moeda', async () => {
      global.fetch = jest.fn(async () => jsonResponse(200, {
        is_available: true,
        balance_infos: [{ currency: 'usd', total_balance: '2.71', topped_up_balance: '2.71' }],
      }));

      const info = await fetchProviderBalanceInfo('deepseek', 'sk-deepseek');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch.mock.calls[0][0]).toBe('https://api.deepseek.com/user/balance');
      expect(info).toMatchObject({
        provider: 'deepseek',
        status: BALANCE_STATUS.AVAILABLE,
        amount: 2.71,
        currency: 'USD',
        note: null,
      });
    });

    it('DeepSeek: entre várias moedas escolhe a entrada em USD', async () => {
      global.fetch = jest.fn(async () => jsonResponse(200, {
        balance_infos: [
          { currency: 'CNY', total_balance: '18.00' },
          { currency: 'USD', total_balance: '2.50' },
        ],
      }));

      const info = await fetchProviderBalanceInfo('deepseek', 'sk-deepseek');

      expect(info.amount).toBe(2.5);
      expect(info.currency).toBe('USD');
    });

    it('Kimi (Moonshot): lê data.available_balance em {baseUrl}/users/me/balance', async () => {
      global.fetch = jest.fn(async () => jsonResponse(200, {
        code: 0,
        status: true,
        data: { available_balance: 24.771458, voucher_balance: 4.88577, cash_balance: 19.885689 },
      }));

      const info = await fetchProviderBalanceInfo('kimi', 'sk-kimi');

      expect(global.fetch.mock.calls[0][0]).toBe('https://api.moonshot.ai/v1/users/me/balance');
      expect(info.status).toBe(BALANCE_STATUS.AVAILABLE);
      expect(info.amount).toBeCloseTo(24.771458, 6);
      expect(info.currency).toBe('USD');
    });

    it('Mistral: consulta a rota comprovada e aceita os nomes de campo plausíveis', async () => {
      global.fetch = jest.fn(async () => jsonResponse(200, {
        data: { available_balance: 12.5, currency: 'eur' },
      }));

      const info = await fetchProviderBalanceInfo('mistral', 'sk-mistral');

      expect(global.fetch.mock.calls[0][0]).toBe('https://api.mistral.ai/v1/users/me/balance');
      expect(info.status).toBe(BALANCE_STATUS.AVAILABLE);
      expect(info.amount).toBe(12.5);
      expect(info.currency).toBe('EUR');
    });

    it('compatibilidade: fetchProviderBalance devolve {amount, currency} quando há saldo', async () => {
      global.fetch = jest.fn(async () => jsonResponse(200, { data: { available_balance: 7.5 } }));

      await expect(fetchProviderBalance('kimi', 'sk-kimi')).resolves.toEqual({ amount: 7.5, currency: 'USD' });
    });
  });

  describe('providers sem saldo consultável — a consulta acontece e diz o motivo', () => {
    it('OpenAI: a recusa real do provider (chave de sessão) vira nota, não silêncio', async () => {
      global.fetch = jest.fn(async () => jsonResponse(403, {
        error: {
          message: 'Your request to GET /v1/dashboard/billing/credit_grants must be made with a session key (that is, it can only be made from the browser). You made it with the following key type: secret.',
        },
      }));

      const info = await fetchProviderBalanceInfo('openai', 'sk-openai');

      expect(global.fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/dashboard/billing/credit_grants');
      expect(info.status).toBe(BALANCE_STATUS.NOT_SUPPORTED);
      expect(info.amount).toBeNull();
      expect(info.note).toMatch(/session key/i);
    });

    it('OpenAI: escopo api.usage.read ausente mantém o resultado honesto (sem número)', async () => {
      global.fetch = jest.fn(async () => jsonResponse(403, {
        error: { message: 'You have insufficient permissions for this operation. Missing scopes: api.usage.read.' },
      }));

      const info = await fetchProviderBalanceInfo('openai', 'sk-openai-restricted');

      expect(info.status).toBe(BALANCE_STATUS.NOT_SUPPORTED);
      expect(info.note).toMatch(/api\.usage\.read/);
    });

    it('Anthropic: 401 na Admin API classifica como requires_admin_key e envia x-api-key', async () => {
      global.fetch = jest.fn(async () => jsonResponse(401, {
        type: 'error',
        error: { type: 'authentication_error', message: 'API key is invalid.' },
      }));

      const info = await fetchProviderBalanceInfo('anthropic', 'sk-ant-standard');

      expect(global.fetch.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/organizations/cost_report');
      expect(global.fetch.mock.calls[0][1].headers['x-api-key']).toBe('sk-ant-standard');
      expect(global.fetch.mock.calls[0][1].headers['anthropic-version']).toBe('2023-06-01');
      expect(info.status).toBe(BALANCE_STATUS.REQUIRES_ADMIN_KEY);
      expect(info.note).toMatch(/API key is invalid/i);
    });

    it('OpenAI/Anthropic/DeepSeek/Kimi/Mistral usam Bearer quando o provider não é Anthropic', async () => {
      global.fetch = jest.fn(async () => jsonResponse(200, { data: { available_balance: 1 } }));

      await fetchProviderBalanceInfo('kimi', 'sk-kimi');
      await fetchProviderBalanceInfo('deepseek', 'sk-deepseek');

      for (const call of global.fetch.mock.calls) {
        expect(call[1].headers.Authorization).toMatch(/^Bearer /);
      }
    });

    it('Groq: não existe endpoint — nenhuma chamada de rede é inventada', async () => {
      global.fetch = jest.fn();

      const info = await fetchProviderBalanceInfo('groq', 'gsk-groq');

      expect(global.fetch).not.toHaveBeenCalled();
      expect(info.status).toBe(BALANCE_STATUS.NOT_SUPPORTED);
      expect(info.note).toMatch(/404/);
    });

    it('Qwen: não existe endpoint de saldo — nenhuma chamada de rede é inventada', async () => {
      global.fetch = jest.fn();

      const info = await fetchProviderBalanceInfo('qwen', 'sk-qwen');

      expect(global.fetch).not.toHaveBeenCalled();
      expect(info.status).toBe(BALANCE_STATUS.NOT_SUPPORTED);
      expect(info.note).toMatch(/404/);
    });

    it('404 em rota declarada como nativa vira not_supported (provider mudou a API)', async () => {
      global.fetch = jest.fn(async () => jsonResponse(404, { message: 'not found' }));

      const info = await fetchProviderBalanceInfo('mistral', 'sk-mistral');

      expect(info.status).toBe(BALANCE_STATUS.NOT_SUPPORTED);
    });

    it('compatibilidade: fetchProviderBalance devolve null quando não há saldo consultável', async () => {
      global.fetch = jest.fn();

      await expect(fetchProviderBalance('groq', 'gsk-groq')).resolves.toBeNull();
    });
  });

  describe('casos de borda', () => {
    it('provider desconhecido (custom) não lança e explica que não há endpoint declarado', async () => {
      global.fetch = jest.fn();

      const info = await fetchProviderBalanceInfo('meu-provider-custom', 'chave');

      expect(global.fetch).not.toHaveBeenCalled();
      expect(info.status).toBe(BALANCE_STATUS.NOT_SUPPORTED);
      expect(info.note).toMatch(/meu-provider-custom/);
    });

    it('chave vazia devolve error sem chamar a rede', async () => {
      global.fetch = jest.fn();

      const info = await fetchProviderBalanceInfo('deepseek', '   ');

      expect(global.fetch).not.toHaveBeenCalled();
      expect(info.status).toBe(BALANCE_STATUS.ERROR);
    });

    it('falha de rede devolve error com a mensagem, nunca lança', async () => {
      global.fetch = jest.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND api.deepseek.com');
      });

      const info = await fetchProviderBalanceInfo('deepseek', 'sk-deepseek');

      expect(info.status).toBe(BALANCE_STATUS.ERROR);
      expect(info.note).toMatch(/ENOTFOUND/);
    });

    it('timeout (AbortError) devolve error sem propagar exceção', async () => {
      global.fetch = jest.fn(async () => {
        const error = new Error('The operation was aborted due to timeout');
        error.name = 'TimeoutError';
        throw error;
      });

      const info = await fetchProviderBalanceInfo('kimi', 'sk-kimi');

      expect(info.status).toBe(BALANCE_STATUS.ERROR);
      expect(info.note).toMatch(/Timeout/i);
    });

    it('200 sem valor numérico reconhecido não vira saldo inventado', async () => {
      global.fetch = jest.fn(async () => jsonResponse(200, { data: { foo: 'bar' } }));

      const info = await fetchProviderBalanceInfo('kimi', 'sk-kimi');

      expect(info.status).toBe(BALANCE_STATUS.NOT_SUPPORTED);
      expect(info.amount).toBeNull();
    });

    it('DeepSeek com total_balance não numérico não é reportado como saldo', async () => {
      global.fetch = jest.fn(async () => jsonResponse(200, {
        balance_infos: [{ currency: 'USD', total_balance: 'indisponível' }],
      }));

      const info = await fetchProviderBalanceInfo('deepseek', 'sk-deepseek');

      expect(info.status).toBe(BALANCE_STATUS.NOT_SUPPORTED);
      expect(info.amount).toBeNull();
    });

    it('todo provider do registry tem uma consulta declarada (nenhum fica sem resposta)', async () => {
      global.fetch = jest.fn(async () => jsonResponse(200, { data: { available_balance: 1 } }));

      const registry = require('../../api/services/aiProviderRegistryService');
      const ids = await registry.getProviderIds();

      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        const info = await fetchProviderBalanceInfo(id, 'chave-de-teste');
        expect(info.provider).toBe(id);
        expect(Object.values(BALANCE_STATUS)).toContain(info.status);
        if (info.status !== BALANCE_STATUS.AVAILABLE) {
          expect(typeof info.note).toBe('string');
          expect(info.note.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
