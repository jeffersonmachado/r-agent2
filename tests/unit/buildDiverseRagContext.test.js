jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { buildDiverseRagContext } = require('../../api/services/ragContextBuilder');

function makeUploaded({ chunkId, score, fileName, text }) {
  return {
    chunkId,
    score,
    excerpt: text,
    metadata: {
      source: 'chat_upload',
      fileName,
      source_id: `file:${fileName}`,
    },
  };
}

function makeWeb({ chunkId, score, url, text }) {
  return {
    chunkId,
    score,
    excerpt: text,
    metadata: {
      source: 'web_scraping',
      url,
      source_id: url,
    },
  };
}

describe('buildDiverseRagContext', () => {
  test('inclui fontes de ambos tipos e respeita mínimos quando disponíveis', async () => {
    const ragQueryFn = jest.fn()
      .mockResolvedValueOnce({
        success: true,
        sources: [
          makeUploaded({ chunkId: 'u1', score: 0.91, fileName: 'apresentacao.pdf', text: 'Missão: atender com excelência. Público-alvo: pequenas empresas.' }),
          makeUploaded({ chunkId: 'u2', score: 0.84, fileName: 'missao.docx', text: 'Visão: ser referência. Diferenciais: equipe especializada e atendimento consultivo.' }),
          makeUploaded({ chunkId: 'u3', score: 0.80, fileName: 'produto.txt', text: 'Serviços: consultoria, implantação e suporte. Segmentos: saúde e varejo.' }),
          makeUploaded({ chunkId: 'u4', score: 0.65, fileName: 'extra.txt', text: 'Valores: transparência e agilidade.' }),
          makeWeb({ chunkId: 'w1', score: 0.95, url: 'https://exemplo.com/sobre', text: 'Sobre: empresa de tecnologia com soluções para atendimento.' }),
          makeWeb({ chunkId: 'w2', score: 0.88, url: 'https://exemplo.com/contato', text: 'Contato: WhatsApp (11) 99999-9999. E-mail contato@exemplo.com.' }),
          makeWeb({ chunkId: 'w3', score: 0.82, url: 'https://exemplo.com/servicos', text: 'Serviços: automação, chatbot e integração.' }),
          makeWeb({ chunkId: 'w4', score: 0.70, url: 'https://exemplo.com/planos', text: 'Planos: básico, pro e enterprise.' }),
          makeWeb({ chunkId: 'w5', score: 0.60, url: 'https://exemplo.com/home', text: 'Home: bem-vindo ao site.' }),
        ],
      });

    const result = await buildDiverseRagContext({
      query: 'Sugira descrição do tenant',
      tenantId: 't1',
      totalK: 10,
      minUploaded: 3,
      minWeb: 3,
      minScore: 0.25,
      ragQueryFn,
    });

    expect(ragQueryFn).toHaveBeenCalledTimes(1);
    expect(result.ragContext).toContain('[FONTES: ARQUIVOS ENVIADOS]');
    expect(result.ragContext).toContain('[FONTES: WEB SCRAPING]');

    const uploaded = result.contextSources.filter(s => s.sourceType === 'uploaded_file');
    const web = result.contextSources.filter(s => s.sourceType === 'web_scraping');

    expect(uploaded.length).toBeGreaterThanOrEqual(3);
    expect(web.length).toBeGreaterThanOrEqual(3);
    expect(result.contextSources.length).toBeLessThanOrEqual(10);
  });

  test('quando não há conteúdo relevante em arquivos enviados, mantém rastreabilidade e gera nota', async () => {
    const ragQueryFn = jest.fn()
      .mockResolvedValueOnce({
        success: true,
        sources: [
          makeWeb({ chunkId: 'w1', score: 0.95, url: 'https://exemplo.com/sobre', text: 'Sobre: empresa de tecnologia.' }),
          makeWeb({ chunkId: 'w2', score: 0.88, url: 'https://exemplo.com/contato', text: 'Contato: WhatsApp.' }),
          makeWeb({ chunkId: 'w3', score: 0.82, url: 'https://exemplo.com/servicos', text: 'Serviços: automação e chatbot.' }),
          makeWeb({ chunkId: 'w4', score: 0.70, url: 'https://exemplo.com/planos', text: 'Planos: básico e pro.' }),
        ],
      });

    const result = await buildDiverseRagContext({
      query: 'Sugira descrição do tenant',
      tenantId: 't1',
      totalK: 10,
      minUploaded: 3,
      minWeb: 3,
      minScore: 0.25,
      ragQueryFn,
    });

    const uploaded = result.contextSources.filter(s => s.sourceType === 'uploaded_file');
    const web = result.contextSources.filter(s => s.sourceType === 'web_scraping');

    expect(uploaded.length).toBe(0);
    expect(web.length).toBeGreaterThan(0);
    expect(Array.isArray(result.notes)).toBe(true);
    expect(result.notes.join(' ')).toMatch(/arquivos enviados/i);
  });

  test('propaga falha real do RAG (success=false + error) como exceção', async () => {
    const ragQueryFn = jest.fn().mockResolvedValueOnce({
      success: false,
      sources: [],
      response: '',
      error: "'NoneType' object has no attribute 'get'",
    });

    await expect(buildDiverseRagContext({
      query: 'Sugira descrição do tenant',
      tenantId: 't1',
      ragQueryFn,
    })).rejects.toThrow(/RAG_QUERY_FAILED/i);
  });

  test('quando RAG retorna erro de "nenhum chunk", trata como contexto vazio (sem exceção)', async () => {
    const ragQueryFn = jest.fn().mockResolvedValueOnce({
      success: false,
      sources: [],
      response: '',
      error: 'Nenhum chunk encontrado com score suficiente',
    });

    const result = await buildDiverseRagContext({
      query: 'Sugira descrição do tenant',
      tenantId: 't1',
      ragQueryFn,
    });

    expect(result).toEqual(expect.objectContaining({
      ragContext: '',
      contextSources: [],
    }));
  });
});

