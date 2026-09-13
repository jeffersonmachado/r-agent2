/**
 * Teste: POST /system/suggest-description
 * - mode=institutional (default) deve:
 *   - não conter palavras proibidas (RAG/OCR/fontes/scraping/“com base no conteúdo”/“aparente”)
 *   - ter exatamente 3 parágrafos
 *   - conter CTA no 3º parágrafo
 */

const http = require('http');

jest.setTimeout(30000);

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

function splitParagraphs(text) {
  return String(text || '')
    .split(/\n\s*\n/g)
    .map(p => p.trim())
    .filter(Boolean);
}

describe('POST /system/suggest-description - institutional mode', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('gera texto institucional sem metalinguagem e com 3 parágrafos + CTA', async () => {
    // DB boot mocks
    jest.doMock('../../api/db/sequelize', () => ({
      connect: jest.fn(async () => ({})),
      getSequelize: jest.fn(() => ({})),
      close: jest.fn(async () => {}),
      Sequelize: require('sequelize').Sequelize,
    }));
    jest.doMock('../../api/db/migrate', () => ({ runMigrations: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/seed', () => ({ runSeed: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/models', () => ({ defineRelationships: jest.fn() }));

    // Auth
    jest.doMock('../../api/services/authService', () => ({
      validateToken: jest.fn(() => ({
        valid: true,
        agent: { id: 'a1', username: 'u1', role: 'owner', tenantId: 't1', is_superadmin: false },
        session: { token: 't1' },
      })),
    }));
    jest.doMock('../../api/services/superAdminService', () => ({ isSuperAdmin: jest.fn(() => false) }));

    // Evita boot de workers/serviços não relevantes
    jest.doMock('../../api/services/outboundWorker', () => ({ start: jest.fn(), stop: jest.fn() }));
    jest.doMock('../../api/services/channelHealthService', () => ({ startChannelHealthMonitor: jest.fn() }));
    jest.doMock('../../api/services/handoverService', () => ({ startAutoReturnToBot: jest.fn(), takeOver: jest.fn(), returnToBot: jest.fn() }));
    jest.doMock('../../api/services/assignmentService', () => ({ startAssignmentWorker: jest.fn(), autoAssign: jest.fn() }));
    jest.doMock('../../api/services/queueDefinitionService', () => ({ initialize: jest.fn(async () => {}) }));
    jest.doMock('../../api/services/queueService', () => ({ startAutoCleanup: jest.fn() }));
    jest.doMock('../../api/services/auditService', () => ({
      logAction: jest.fn(),
      queryLogs: jest.fn(async () => ([])),
      getAuditStats: jest.fn(async () => ({})),
      registerGeneration: jest.fn(async () => ({})),
      generateAuditReport: jest.fn(async () => ({})),
    }));

    // Tenant
    jest.doMock('../../api/services/tenantService', () => ({
      getTenant: jest.fn(async () => ({ id: 't1', name: 'Empresa X', site: 'https://empresa-x.com' })),
    }));

    // RAG com chunks web + file
    jest.doMock('../../api/services/ragService', () => ({
      isRagAvailable: jest.fn(async () => true),
      queryRag: jest.fn(async () => ({
        success: true,
        sources: [
          {
            chunkId: 'w1',
            score: 0.92,
            excerpt: 'Empresa X oferece soluções de atendimento e suporte. WhatsApp (11) 99999-9999.',
            metadata: { source: 'web_scraping', url: 'https://empresa-x.com/contato', source_id: 'https://empresa-x.com/contato' },
          },
          {
            chunkId: 'u1',
            score: 0.81,
            excerpt: 'Formas de pagamento: PIX e cartão. Horário: seg a sex 08:00-18:00.',
            metadata: { source: 'chat_upload', fileName: 'catalogo.pdf', source_id: 'file:catalogo.pdf' },
          },
        ],
        response: '',
      })),
    }));

    // Evita depender de Redis/ephemeral context (mesmo com executionId obrigatório)
    jest.doMock('../../api/services/ephemeralRagContextService', () => ({
      getEphemeralContext: jest.fn(async () => ({ found: false, used: false, chunks: [] })),
    }));

    // IA: 1 chamada para profile + 2 para institucional (1ª “ruim”, 2ª corrigida)
    const generateAiResponse = jest.fn(async (prompt) => {
      const p = String(prompt || '');
      if (p.includes('SCHEMA (preencha exatamente estas chaves):')) {
        return {
          text: JSON.stringify({
            name: 'Empresa X',
            website: 'https://empresa-x.com',
            segment: null,
            whatItDoes: 'oferece soluções de atendimento e suporte para diferentes necessidades.',
            productsServices: ['atendimento', 'suporte'],
            audience: [],
            differentials: ['agilidade', 'clareza no atendimento'],
            proofPoints: [
              { label: 'Horários', value: 'seg a sex 08:00-18:00', source: 'catalogo.pdf' },
            ],
            contacts: { phone: '(11) 99999-9999', whatsapp: '(11) 99999-99999', email: null },
            channels: { instagram: null, facebook: null, maps: null },
            locations: [],
            paymentMethods: ['PIX', 'Cartão'],
            legal: { cnpj: null },
            operatingHours: ['seg a sex 08:00-18:00'],
            tone: 'neutro',
            confidence: 0.8,
          }),
        };
      }

      // 1ª tentativa: proibida (deve ser descartada/re-escrita)
      if (!p.includes('Reescreva o texto abaixo seguindo estritamente:')) {
        return {
          text: 'Com base no conteúdo disponível nas fontes e no RAG, a Empresa X aparente atuar em várias frentes. OCR e scraping indicam informações parciais.',
        };
      }

      // 2ª tentativa: válida
      return {
        text: [
          'A Empresa X oferece soluções de atendimento e suporte para diferentes necessidades, com foco em clareza e consistência na entrega.',
          'Com serviços como atendimento e suporte, busca atuar com agilidade e uma experiência bem conduzida ao longo do processo. Também constam horários como seg a sex 08:00-18:00.',
          'Para falar com a equipe, você pode usar o WhatsApp (11) 99999-9999 e conhecer as opções de pagamento como PIX e cartão. Entre em contato para saber mais e solicitar uma proposta.',
        ].join('\n\n'),
      };
  }, 30000);

    jest.doMock('../../api/services/aiProviderService', () => ({
      initializeAiProviders: jest.fn(async () => {}),
      ensureTenantAiConfigLoaded: jest.fn(async () => {}),
      generateAiResponse,
    }));

    // Provider ativo para o tenant (Gate 1 do endpoint)
    jest.doMock('../../api/services/aiProviderManager.js', () => ({
      getAiProviderForTenant: jest.fn(() => ({ id: 'mock-provider' })),
    }));

    // eslint-disable-next-line global-require
    const { createServer } = require('../../api/server');
    const server = createServer();
    const listenResult = await new Promise((resolve, reject) => {
      const onError = (error) => {
        if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
          resolve({ skip: true });
          return;
        }
        reject(error);
      };
      server.once('error', onError);
      try {
        server.listen(0, '127.0.0.1', () => {
          server.off('error', onError);
          const address = server.address();
          if (address && typeof address === 'object') {
            resolve({ skip: false, port: address.port });
          } else {
            resolve({ skip: true });
          }
        });
      } catch (error) {
        server.off('error', onError);
        if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
          resolve({ skip: true });
          return;
        }
        reject(error);
      }
    });

    if (listenResult.skip) {
      return;
    }

    const port = listenResult.port;

    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          method: 'POST',
          port,
          path: '/system/suggest-description',
          headers: {
            Authorization: 'Bearer t1',
            'Content-Type': 'application/json',
            'X-Request-Id': 'req-test-2',
          },
        },
        (r) => {
          let data = '';
          r.on('data', (c) => { data += c; });
          r.on('end', () => {
            let body = null;
            try { body = JSON.parse(data); } catch { body = data; }
            resolve({ status: r.statusCode, headers: r.headers, body });
          });
        }
      );
      req.on('error', reject);
      req.write(JSON.stringify({
        name: 'Empresa X',
        tenantId: 't1',
        executionId: 'exec-test-2',
        urls: ['https://empresa-x.com'],
        fileNames: ['catalogo.pdf'],
        mode: 'institutional',
      }));
      req.end();
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      ok: true,
      suggestion: expect.any(String),
      entityProfile: expect.any(Object),
    }));

    const text = res.body.suggestion;
    const lower = text.toLowerCase();
    expect(lower).not.toContain('com base no conteúdo');
    expect(lower).not.toContain('aparente');
    expect(lower).not.toContain('fontes');
    expect(lower).not.toContain('ocr');
    expect(lower).not.toContain('scraping');
    expect(lower).not.toContain('rag');

    const paragraphs = splitParagraphs(text);
    expect(paragraphs).toHaveLength(3);
    expect(/entre em contato|fale com|saiba mais|solicite/i.test(paragraphs[2])).toBe(true);

    expect(generateAiResponse).toHaveBeenCalled();
    expect(generateAiResponse.mock.calls.length).toBeGreaterThanOrEqual(3);

    await new Promise((resolve) => server.close(resolve));
  }, 45000);
});
