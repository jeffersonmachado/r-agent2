async function handleSystemSuggestDescriptionRoute(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    isSuperAdmin,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    generateAiResponse,
    ragService,
  } = deps;

  if (!(method === 'POST' && pathname === '/system/suggest-description')) {
    return false;
  }

  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return true;
  }

  if (!hasJsonContentType(req)) {
    badRequest(res, 'Content-Type deve ser application/json');
    return true;
  }

  try {
    const body = await parseJsonBody(req);
    const { prompt, name, tenantId, urls, fileNames, mode } = body;
    const normalizedMode = String(mode || 'default').trim().toLowerCase();
    const institutionalMode = normalizedMode === 'institutional';

    if (!institutionalMode && (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0)) {
      badRequest(res, 'Prompt é obrigatório');
      return true;
    }

    const effectivePrompt = (prompt && typeof prompt === 'string' && prompt.trim().length > 0)
      ? prompt.trim()
      : `Gere uma descrição institucional em português para ${name || 'a empresa'}, com foco em clareza, objetividade e chamada para ação.`;

    const isSuperAdminUser = isSuperAdmin(req.agent);
    const tenantIdForAI = (req.agent?.tenantId && String(req.agent.tenantId).trim())
      ? String(req.agent.tenantId).trim()
      : (isSuperAdminUser && tenantId ? String(tenantId).trim() : null);
    if (!tenantIdForAI) {
      sendJson(res, 403, { error: 'forbidden', message: 'tenantId é obrigatório' });
      return true;
    }

    logger.info('[System] Sugerindo descrição por IA', {
      name: name || 'N/A',
      tenantId: tenantIdForAI,
      hasUrls: Array.isArray(urls) && urls.length > 0,
    });

    // Primeiro, consulta RAG para obter conteúdo indexado sobre o tenant/sistema.
    let ragContext = '';
    try {
      // Constrói query mais específica baseada no nome e URLs.
      let ragQuery = '';
      if (name && Array.isArray(urls) && urls.length > 0) {
        // Se tem nome e URLs, busca por conteúdo relacionado ao nome e às URLs.
        const urlDomains = urls.map((url) => {
          try {
            const urlObj = new URL(url);
            return urlObj.hostname.replace('www.', '');
          } catch {
            return url;
          }
        }).filter(Boolean);
        ragQuery = `${name} ${urlDomains.join(' ')} informações sobre serviços produtos`;
      } else if (name) {
        // Se tem apenas nome, busca por informações sobre o nome.
        ragQuery = `Informações sobre ${name} serviços produtos empresa negócio`;
      } else if (Array.isArray(urls) && urls.length > 0) {
        // Se tem apenas URLs, busca por conteúdo das URLs.
        const urlDomains = urls.map((url) => {
          try {
            const urlObj = new URL(url);
            return urlObj.hostname.replace('www.', '');
          } catch {
            return url;
          }
        }).filter(Boolean);
        ragQuery = `${urlDomains.join(' ')} informações conteúdo site`;
      } else {
        ragQuery = 'Informações sobre o sistema ou tenant';
      }

      logger.debug('[System] Consultando RAG para obter contexto', {
        query: ragQuery,
        tenantId: tenantIdForAI,
        name,
        urlsCount: Array.isArray(urls) ? urls.length : 0,
      });

      const ragResult = await ragService.queryRag(ragQuery, tenantIdForAI, {}, {
        topK: 10, // Aumenta para pegar mais contexto
        minScore: 0.25, // Score ainda mais baixo para pegar mais contexto
        maxTokens: 3000, // Mais tokens para ter mais informações
      });

      if (ragResult.success) {
        // Prioriza sources se disponíveis, senão usa response.
        if (ragResult.sources && ragResult.sources.length > 0) {
          // Extrai conteúdo relevante dos chunks retornados.
          // Sources podem ter: content, text, chunk, excerpt, ou similar.
          const relevantChunks = ragResult.sources
            .filter((s) => {
              const score = s.score || s.relevance_score || s.similarity || 0;
              return score >= 0.25; // Score mais baixo para pegar mais contexto
            })
            .slice(0, 8) // Aumenta para 8 chunks mais relevantes
            .map((s) => {
              // O campo correto é 'excerpt' conforme o modelo Source do Python.
              // Mas também tenta outros campos para compatibilidade.
              const content = s.excerpt || s.content || s.text || s.chunk || s.snippet || '';
              return content;
            })
            .filter((c) => c && c.trim() && c.length > 20); // Filtra conteúdos muito curtos

          if (relevantChunks.length > 0) {
            ragContext = `\n\nCONTEXTO EXTRAÍDO DOS ARQUIVOS INDEXADOS:\n${relevantChunks.join('\n\n---\n\n')}\n\n`;
            logger.info('[System] Contexto RAG obtido com sucesso', {
              chunksCount: relevantChunks.length,
              totalLength: ragContext.length,
              sourcesCount: ragResult.sources.length,
              avgChunkLength: Math.round(relevantChunks.reduce((sum, c) => sum + c.length, 0) / relevantChunks.length),
            });
          } else {
            logger.debug('[System] RAG retornou sources mas sem conteúdo extraível suficiente', {
              sourcesCount: ragResult.sources.length,
              sampleSource: ragResult.sources[0] ? Object.keys(ragResult.sources[0]) : [],
              sampleContent: ragResult.sources[0] ? (ragResult.sources[0].content || ragResult.sources[0].text || '').substring(0, 100) : '',
            });
          }
        }

        // Se não conseguiu extrair contexto dos sources mas há uma resposta gerada, usa ela.
        if (!ragContext && ragResult.response && ragResult.response.trim()) {
          ragContext = `\n\nINFORMAÇÕES EXTRAÍDAS DOS ARQUIVOS INDEXADOS:\n${ragResult.response}\n\n`;
          logger.info('[System] Usando resposta RAG como contexto (sources não disponíveis)', {
            responseLength: ragResult.response.length,
          });
        }
      } else {
        logger.debug('[System] RAG não retornou resultados ou está vazio', {
          success: ragResult.success,
          sourcesCount: ragResult.sources?.length || 0,
          hasResponse: !!ragResult.response,
          error: ragResult.error,
        });
      }
    } catch (ragError) {
      logger.warn('[System] Erro ao consultar RAG (continuando sem contexto)', {
        error: ragError.message,
      });
      // Continua sem contexto RAG se houver erro.
    }

    // Fallback determinístico: sem contexto indexado, mas com fontes informadas.
    // Evita chamar IA e retorna orientação segura para o usuário.
    if (!ragContext && Array.isArray(urls) && urls.length > 0) {
      const fallbackSuggestion = (
        name && String(name).trim()
          ? `Descrição preliminar de ${String(name).trim()}: empresa com presença digital ativa e fontes informadas para indexação. Recomendamos complementar com conteúdos institucionais e diferenciais de serviço para melhorar a precisão.`
          : 'Descrição preliminar: presença digital ativa com fontes informadas para indexação. Recomendamos complementar com conteúdos institucionais e diferenciais de serviço para melhorar a precisão.'
      );

      sendJson(res, 200, {
        ok: true,
        suggestion: fallbackSuggestion,
        warnings: [{
          code: 'NO_INDEXED_CONTEXT_FALLBACK',
          message: 'Sem contexto indexado no RAG. Retornando sugestão preliminar baseada nas fontes informadas.',
          details: {
            tenantId: tenantIdForAI,
            sourcesCount: urls.length,
          },
        }],
      });
      return true;
    }

    if (institutionalMode) {
      const parseJsonText = (text) => {
        const raw = String(text || '').trim();
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch (_) {
          const match = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
          if (match && match[1]) {
            try {
              return JSON.parse(match[1]);
            } catch (__){
              return null;
            }
          }
          return null;
        }
      };

      const splitParagraphs = (text) => String(text || '')
        .split(/\n\s*\n/g)
        .map((p) => p.trim())
        .filter(Boolean);

      const hasForbiddenTerms = (text) => {
        const lower = String(text || '').toLowerCase();
        return lower.includes('com base no conteúdo')
          || lower.includes('aparente')
          || lower.includes('fontes')
          || lower.includes('ocr')
          || lower.includes('scraping')
          || lower.includes('rag');
      };

      const hasCta = (paragraph) => /entre em contato|fale com|saiba mais|solicite/i.test(String(paragraph || ''));

      const profilePrompt = [
        'Extraia um perfil institucional estruturado a partir do contexto abaixo.',
        'Retorne apenas JSON válido.',
        'SCHEMA (preencha exatamente estas chaves):',
        '{',
        '  "name": string|null,',
        '  "website": string|null,',
        '  "segment": string|null,',
        '  "whatItDoes": string|null,',
        '  "productsServices": string[],',
        '  "audience": string[],',
        '  "differentials": string[],',
        '  "proofPoints": object[],',
        '  "contacts": object,',
        '  "channels": object,',
        '  "locations": string[],',
        '  "paymentMethods": string[],',
        '  "legal": object,',
        '  "operatingHours": string[],',
        '  "tone": string|null,',
        '  "confidence": number|null',
        '}',
        '',
        `Nome informado: ${name || 'N/A'}`,
        `URLs informadas: ${Array.isArray(urls) ? urls.join(', ') : 'nenhuma'}`,
        `Arquivos informados: ${Array.isArray(fileNames) ? fileNames.join(', ') : 'nenhum'}`,
        ragContext ? `Contexto indexado:${ragContext}` : 'Sem contexto indexado.',
      ].join('\n');

      const profileAiResult = await generateAiResponse(profilePrompt, tenantIdForAI, {});
      const entityProfile = parseJsonText(profileAiResult?.text) || {
        name: name || null,
        website: Array.isArray(urls) && urls[0] ? String(urls[0]) : null,
        productsServices: [],
        differentials: [],
        paymentMethods: [],
      };

      const institutionalPrompt = [
        'Escreva um texto institucional em português com EXATAMENTE 3 parágrafos.',
        'Regras obrigatórias:',
        '- Sem metalinguagem e sem mencionar RAG, OCR, scraping, fontes, ou "com base no conteúdo".',
        '- Não usar a palavra "aparente".',
        '- O 3º parágrafo deve ter CTA (ex.: entre em contato, saiba mais, solicite).',
        '- Linguagem clara, profissional e natural.',
        '',
        `Pedido do usuário: ${effectivePrompt}`,
        `Perfil estruturado: ${JSON.stringify(entityProfile)}`,
        ragContext ? `Contexto indexado:${ragContext}` : 'Sem contexto indexado.',
      ].join('\n');

      let institutionalText = String((await generateAiResponse(institutionalPrompt, tenantIdForAI, {}))?.text || '').trim();
      let paragraphs = splitParagraphs(institutionalText);
      if (hasForbiddenTerms(institutionalText) || paragraphs.length !== 3 || !hasCta(paragraphs[2])) {
        const rewritePrompt = [
          'Reescreva o texto abaixo seguindo estritamente:',
          '- Exatamente 3 parágrafos;',
          '- Não usar: "com base no conteúdo", "aparente", "fontes", "OCR", "scraping", "RAG";',
          '- O 3º parágrafo deve conter CTA;',
          '',
          'Texto a reescrever:',
          institutionalText,
        ].join('\n');
        institutionalText = String((await generateAiResponse(rewritePrompt, tenantIdForAI, {}))?.text || institutionalText).trim();
        paragraphs = splitParagraphs(institutionalText);
      }

      sendJson(res, 200, {
        ok: true,
        suggestion: institutionalText,
        entityProfile,
        warnings: [],
      });
      return true;
    }

    // Monta prompt final com contexto RAG se disponível.
    let finalPrompt = effectivePrompt;

    if (ragContext) {
      // Se há contexto RAG, usa ele como fonte principal.
      finalPrompt = `${prompt}\n\n${ragContext}\n\nIMPORTANTE: Use APENAS as informações do contexto extraído dos arquivos indexados acima. Não invente informações que não estejam no contexto. Se o contexto não contiver informações suficientes, seja cauteloso e mencione apenas o que está disponível.`;
    } else if (Array.isArray(urls) && urls.length > 0) {
      // Se não há RAG mas há URLs, menciona as URLs (mas não acessa diretamente).
      finalPrompt = `${prompt}\n\nURLs do site para referência: ${urls.join(', ')}\n\nIMPORTANTE: Use apenas informações que foram indexadas dos arquivos enviados ou do web scraping desses sites. Não invente informações.`;
    } else {
      // Sem RAG nem URLs, instrui a ser muito cauteloso.
      finalPrompt = `${prompt}\n\nIMPORTANTE: Não há conteúdo indexado disponível. Seja muito cauteloso e não invente informações específicas. Use apenas inferências genéricas baseadas no nome.`;
    }

    const aiResult = await generateAiResponse(finalPrompt, tenantIdForAI, {});
    const suggestedDescription = aiResult.text || '';

    if (!suggestedDescription.trim()) {
      sendJson(res, 500, {
        error: 'Erro ao processar resposta da IA',
        details: 'A IA não retornou uma descrição sugerida.',
      });
      return true;
    }

    logger.info('[System] Descrição sugerida com sucesso', {
      length: suggestedDescription.length,
    });

    sendJson(res, 200, {
      suggestion: suggestedDescription.trim(),
    });
  } catch (err) {
    logger.error('[System] Erro ao sugerir descrição:', err);
    if (err instanceof SyntaxError) {
      badRequest(res, 'JSON inválido no corpo da requisição');
    } else {
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao sugerir descrição por IA',
      });
    }
  }

  return true;
}

module.exports = { handleSystemSuggestDescriptionRoute };
