jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('buildEntityProfile - não inventar dados', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('se IA inventar e-mail/contato sem evidência, deve virar null', async () => {
    jest.doMock('../../api/services/tenantService', () => ({
      getTenant: jest.fn(async () => ({ id: 't1', name: 'Empresa X', site: 'https://empresa-x.com' })),
    }));

    const generateAiResponse = jest.fn(async () => ({
      text: JSON.stringify({
        name: 'Empresa X',
        website: 'https://empresa-x.com',
        segment: null,
        whatItDoes: null,
        productsServices: [],
        audience: [],
        differentials: [],
        proofPoints: [],
        contacts: { phone: null, whatsapp: null, email: 'inventado@exemplo.com' },
        channels: { instagram: null, facebook: null, maps: null },
        locations: [],
        paymentMethods: [],
        legal: { cnpj: null },
        operatingHours: [],
        tone: 'neutro',
        confidence: 0.9,
      }),
    }));

    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse,
    }));

    // eslint-disable-next-line global-require
    const { buildEntityProfile } = require('../../api/services/entityProfileService');

    const { profile } = await buildEntityProfile('t1', {
      name: 'Empresa X',
      website: 'https://empresa-x.com',
      chunks: [
        { sourceType: 'web_scraping', sourceId: 'https://empresa-x.com/contato', score: 0.9, text: 'Telefone: (11) 99999-9999' },
      ],
    });

    expect(profile.contacts.email).toBe(null);
    expect(profile.contacts.phone).toMatch(/\(11\)/);
  });
});

