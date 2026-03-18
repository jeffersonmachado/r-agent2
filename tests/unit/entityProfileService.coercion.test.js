'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('entityProfileService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('buildEntityProfile rejects hostile tenantId coercion with required error', async () => {
    jest.doMock('../../api/services/tenantService', () => ({
      getTenant: jest.fn(async () => null),
    }));
    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(async () => ({ text: '{}' })),
    }));

    const { buildEntityProfile } = require('../../api/services/entityProfileService');

    await expect(buildEntityProfile({
      toString: () => { throw new Error('boom-tenant'); },
    }, {})).rejects.toThrow('tenantId é obrigatório');
  });

  test('buildEntityProfile tolerates hostile chunk text coercion and keeps deterministic signals', async () => {
    jest.doMock('../../api/services/tenantService', () => ({
      getTenant: jest.fn(async () => ({ id: 't1', name: 'Empresa X', site: 'https://empresa-x.com' })),
    }));
    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(async () => ({ text: '{}' })),
    }));

    const { buildEntityProfile } = require('../../api/services/entityProfileService');

    const out = await buildEntityProfile('t1', {
      chunks: [
        { text: { toString: () => { throw new Error('boom-chunk'); } } },
        { text: 'Contato: (11) 99999-9999 e email contato@empresa-x.com' },
      ],
    });

    expect(out.usedAi).toBe(true);
    expect(out.profile.contacts.phone).toContain('99999-9999');
    expect(out.profile.contacts.email).toBe('contato@empresa-x.com');
  });

  test('buildEntityProfile returns controlled error when AI text coercion is hostile', async () => {
    jest.doMock('../../api/services/tenantService', () => ({
      getTenant: jest.fn(async () => ({ id: 't1', name: 'Empresa X', site: 'https://empresa-x.com' })),
    }));
    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(async () => ({
        text: { toString: () => { throw new Error('boom-ai'); } },
      })),
    }));

    const { buildEntityProfile } = require('../../api/services/entityProfileService');

    await expect(buildEntityProfile('t1', {
      chunks: [
        { text: 'Texto suficientemente longo para forcar caminho de IA com evidencias reais e sem fallback prematuro. ' +
            'Inclui telefone (11) 98888-7777 e detalhes operacionais do negocio para superar o limiar minimo.' },
      ],
    })).rejects.toThrow('Resposta da IA não contém JSON válido');
  });

  test('extractJsonFromAiText não crash com getter hostil em JSON.parse err.message', async () => {
    const logger = require('../../api/utils/logger');
    jest.doMock('../../api/services/tenantService', () => ({
      getTenant: jest.fn(async () => ({ id: 't1', name: 'Empresa X', site: 'https://empresa-x.com' })),
    }));
    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(async () => ({ text: 'TEXTO_INVALIDO_SEM_JSON' })),
    }));

    const { buildEntityProfile } = require('../../api/services/entityProfileService');

    await expect(buildEntityProfile('t1', {
      chunks: [
        { text: 'Texto suficientemente longo para forcar caminho de IA com evidencias reais e sem fallback prematuro. ' +
            'Inclui telefone (11) 91111-2222 e detalhes operacionais do negocio para superar o limiar minimo.' },
      ],
    })).rejects.toThrow('Resposta da IA não contém JSON válido');

    // O logger.warn deve ter sido chamado com a chave error sem lançar
    expect(logger.warn).toHaveBeenCalledWith(
      '[EntityProfile] JSON inválido na resposta da IA',
      expect.objectContaining({ error: expect.any(String) })
    );
  });
});
