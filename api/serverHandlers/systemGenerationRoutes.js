async function handleSystemGenerationRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    isSuperAdmin,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    generateAiResponse,
    getAIConfig,
    getDecryptedAPIKey,
    ragService,
    STRICT_TENANT_MODE,
    generateAndValidate,
  } = deps;

  if (!pathname.startsWith('/system/')) {
    return false;
  }

  // POST /system/pipeline/validate-prereqs - Valida pré-requisitos do pipeline tenant
  if (method === 'POST' && pathname === '/system/pipeline/validate-prereqs') {
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
      const { requireExecutionId } = require('../middleware/requireExecutionId');
      const executionId = requireExecutionId(body, res, badRequest);
      if (!executionId) {
        return true;
      }

      const tenantId = (authResult.agent?.tenantId && String(authResult.agent.tenantId).trim())
        ? String(authResult.agent.tenantId).trim()
        : null;
      if (!tenantId) {
        sendJson(res, 400, { error: 'bad_request', message: 'tenantId ausente para validar pré-requisitos do pipeline' });
        return true;
      }

      const { ensureExecutionContext, updateStage, updateStatus } = require('../services/pipelineExecutionContext');
      const { checkRagServiceStatus } = require('../services/systemStatusService');

      const pipelineExecution = ensureExecutionContext(
        { executionId, tenantId, useRag: body?.useRag === true },
        { tenantId }
      );
      updateStatus(pipelineExecution, 'running', {
        currentStage: 'providerValidated',
        message: 'Validando pré-requisitos do pipeline',
        source: '/system/pipeline/validate-prereqs',
      });

      const aiConfig = await getAIConfig(tenantId);
      const provider = aiConfig?.primary || aiConfig?.provider || null;
      const hasConfiguredProvider = !!(aiConfig?.configured && provider);
      const apiKey = hasConfiguredProvider ? await getDecryptedAPIKey(tenantId, provider) : null;
      const providerValidated = !!(hasConfiguredProvider && apiKey && String(apiKey).trim());

      if (!providerValidated) {
        sendJson(res, 422, {
          error: 'provider_not_configured',
          code: 'PROVIDER_NOT_CONFIGURED',
          message: 'Provider de IA não configurado para este tenant. Configure um provider e suas credenciais antes de continuar.',
          details: {
            tenantId,
            provider: provider || null,
            configured: !!aiConfig?.configured,
          },
        });
        return true;
      }

      updateStage(pipelineExecution, 'providerValidated', true);

      const shouldValidateRag = body?.useRag !== false;
      let ragValidated = true;
      let ragStatus = null;

      if (shouldValidateRag) {
        ragStatus = await checkRagServiceStatus();
        ragValidated = ragStatus?.status === 'healthy';
        if (!ragValidated) {
          sendJson(res, 422, {
            error: 'rag_unavailable',
            code: 'RAG_UNAVAILABLE',
            message: ragStatus?.error || 'Serviço RAG indisponível. Verifique a saúde do serviço antes de continuar.',
            details: {
              tenantId,
              ragStatus,
            },
          });
          return true;
        }
      }

      updateStage(pipelineExecution, 'ragValidated', true);
      updateStatus(pipelineExecution, 'running', {
        currentStage: shouldValidateRag ? 'ragValidated' : 'providerValidated',
        message: shouldValidateRag
          ? 'Pré-requisitos do pipeline validados'
          : 'Pré-requisitos do pipeline validados (RAG não solicitado)',
        source: '/system/pipeline/validate-prereqs',
      });

      sendJson(res, 200, {
        ok: true,
        executionId,
        tenantId,
        providerValidated: true,
        ragValidated,
        provider,
      });
    } catch (err) {
      logger.error('[System] Erro ao validar pré-requisitos do pipeline', err);
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        sendJson(res, 500, {
          error: 'internal_error',
          message: err.message || 'Erro ao validar pré-requisitos do pipeline',
        });
      }
    }
    return true;
  }

  // POST /system/suggest-description - Sugere descrição usando IA
  if (method === 'POST' && pathname === '/system/suggest-description') {
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
        hasUrls: Array.isArray(urls) && urls.length > 0
      });

      // Primeiro, consulta RAG para obter conteúdo indexado sobre o tenant/sistema
      let ragContext = '';
      try {
        // Constrói query mais específica baseada no nome e URLs
        let ragQuery = '';
        if (name && Array.isArray(urls) && urls.length > 0) {
          // Se tem nome e URLs, busca por conteúdo relacionado ao nome e às URLs
          const urlDomains = urls.map(url => {
            try {
              const urlObj = new URL(url);
              return urlObj.hostname.replace('www.', '');
            } catch {
              return url;
            }
          }).filter(Boolean);
          ragQuery = `${name} ${urlDomains.join(' ')} informações sobre serviços produtos`;
        } else if (name) {
          // Se tem apenas nome, busca por informações sobre o nome
          ragQuery = `Informações sobre ${name} serviços produtos empresa negócio`;
        } else if (Array.isArray(urls) && urls.length > 0) {
          // Se tem apenas URLs, busca por conteúdo das URLs
          const urlDomains = urls.map(url => {
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
          urlsCount: Array.isArray(urls) ? urls.length : 0
        });
        
        const ragResult = await ragService.queryRag(ragQuery, tenantIdForAI, {}, {
          topK: 10, // Aumenta para pegar mais contexto
          minScore: 0.25, // Score ainda mais baixo para pegar mais contexto
          maxTokens: 3000, // Mais tokens para ter mais informações
        });
        
        if (ragResult.success) {
          // Prioriza sources se disponíveis, senão usa response
          if (ragResult.sources && ragResult.sources.length > 0) {
            // Extrai conteúdo relevante dos chunks retornados
            // Sources podem ter: content, text, chunk, excerpt, ou similar
            const relevantChunks = ragResult.sources
              .filter(s => {
                const score = s.score || s.relevance_score || s.similarity || 0;
                return score >= 0.25; // Score mais baixo para pegar mais contexto
              })
              .slice(0, 8) // Aumenta para 8 chunks mais relevantes
              .map(s => {
                // O campo correto é 'excerpt' conforme o modelo Source do Python
                // Mas também tenta outros campos para compatibilidade
                const content = s.excerpt || s.content || s.text || s.chunk || s.snippet || '';
                return content;
              })
              .filter(c => c && c.trim() && c.length > 20); // Filtra conteúdos muito curtos
            
            if (relevantChunks.length > 0) {
              ragContext = `\n\nCONTEXTO EXTRAÍDO DOS ARQUIVOS INDEXADOS:\n${relevantChunks.join('\n\n---\n\n')}\n\n`;
              logger.info('[System] Contexto RAG obtido com sucesso', { 
                chunksCount: relevantChunks.length,
                totalLength: ragContext.length,
                sourcesCount: ragResult.sources.length,
                avgChunkLength: Math.round(relevantChunks.reduce((sum, c) => sum + c.length, 0) / relevantChunks.length)
              });
            } else {
              logger.debug('[System] RAG retornou sources mas sem conteúdo extraível suficiente', { 
                sourcesCount: ragResult.sources.length,
                sampleSource: ragResult.sources[0] ? Object.keys(ragResult.sources[0]) : [],
                sampleContent: ragResult.sources[0] ? (ragResult.sources[0].content || ragResult.sources[0].text || '').substring(0, 100) : ''
              });
            }
          }
          
          // Se não conseguiu extrair contexto dos sources mas há uma resposta gerada, usa ela
          if (!ragContext && ragResult.response && ragResult.response.trim()) {
            ragContext = `\n\nINFORMAÇÕES EXTRAÍDAS DOS ARQUIVOS INDEXADOS:\n${ragResult.response}\n\n`;
            logger.info('[System] Usando resposta RAG como contexto (sources não disponíveis)', { 
              responseLength: ragResult.response.length 
            });
          }
        } else {
          logger.debug('[System] RAG não retornou resultados ou está vazio', { 
            success: ragResult.success,
            sourcesCount: ragResult.sources?.length || 0,
            hasResponse: !!ragResult.response,
            error: ragResult.error
          });
        }
      } catch (ragError) {
        logger.warn('[System] Erro ao consultar RAG (continuando sem contexto)', { 
          error: ragError.message 
        });
        // Continua sem contexto RAG se houver erro
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

      // Monta prompt final com contexto RAG se disponível
      let finalPrompt = effectivePrompt;
      
      if (ragContext) {
        // Se há contexto RAG, usa ele como fonte principal
        finalPrompt = `${prompt}\n\n${ragContext}\n\nIMPORTANTE: Use APENAS as informações do contexto extraído dos arquivos indexados acima. Não invente informações que não estejam no contexto. Se o contexto não contiver informações suficientes, seja cauteloso e mencione apenas o que está disponível.`;
      } else if (Array.isArray(urls) && urls.length > 0) {
        // Se não há RAG mas há URLs, menciona as URLs (mas não acessa diretamente)
        finalPrompt = `${prompt}\n\nURLs do site para referência: ${urls.join(', ')}\n\nIMPORTANTE: Use apenas informações que foram indexadas dos arquivos enviados ou do web scraping desses sites. Não invente informações.`;
      } else {
        // Sem RAG nem URLs, instrui a ser muito cauteloso
        finalPrompt = `${prompt}\n\nIMPORTANTE: Não há conteúdo indexado disponível. Seja muito cauteloso e não invente informações específicas. Use apenas inferências genéricas baseadas no nome.`;
      }

      const aiResult = await generateAiResponse(finalPrompt, tenantIdForAI, {});
      const suggestedDescription = aiResult.text || '';

      if (!suggestedDescription.trim()) {
        sendJson(res, 500, { 
          error: 'Erro ao processar resposta da IA',
          details: 'A IA não retornou uma descrição sugerida.'
        });
        return true;
      }

      logger.info('[System] Descrição sugerida com sucesso', { 
        length: suggestedDescription.length 
      });

      sendJson(res, 200, { 
        suggestion: suggestedDescription.trim()
      });
    } catch (err) {
      logger.error('[System] Erro ao sugerir descrição:', err);
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        sendJson(res, 500, { 
          error: 'internal_error',
          message: err.message || 'Erro ao sugerir descrição por IA'
        });
      }
    }
    return true;
  }





  // POST /system/generate-faq - Gera perguntas/FAQ agrupadas a partir do contexto do tenant
  if (method === 'POST' && pathname === '/system/generate-faq') {
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
      const tenantId = (body?.tenantId && isSuperAdmin(req.agent))
        ? String(body.tenantId).trim()
        : String(authResult.agent?.tenantId || '').trim();

      if (!tenantId) {
        badRequest(res, 'tenantId é obrigatório');
        return true;
      }

      const { requireExecutionId } = require('../middleware/requireExecutionId');
      const rawExecutionId = body?.executionId ? String(body.executionId).trim() : '';
      const executionId = rawExecutionId ? requireExecutionId(body, res, badRequest) : null;
      if (rawExecutionId && !executionId) {
        return true;
      }

      const { generateFaq } = require('../services/faqGeneratorService');
      const { ensureExecutionContext, updateStage, updateStatus } = require('../services/pipelineExecutionContext');

      let execution = null;
      const pipelineStage = String(body?.pipelineStage || '').trim();
      if (executionId) {
        execution = ensureExecutionContext(
          { executionId, tenantId, pipelineStage },
          { tenantId }
        );
        updateStatus(execution, 'running', {
          currentStage: pipelineStage || 'faqGenerated',
          message: pipelineStage === 'questionsGenerated' ? 'Gerando perguntas automaticamente' : 'Gerando FAQ do tenant',
          source: '/system/generate-faq',
        });
      }

      const result = await generateFaq({
        tenantId,
        name: body?.name ?? null,
        description: body?.description ?? null,
        urls: Array.isArray(body?.urls) ? body.urls : [],
        fileNames: Array.isArray(body?.fileNames) ? body.fileNames : [],
        chunks: Array.isArray(body?.chunks) ? body.chunks : [],
        executionId: executionId || null,
        contextMode: body?.contextMode ?? 'auto',
        rules: body?.rules ?? null,
        dryRun: body?.dryRun === true,
      });

      if (execution && pipelineStage) {
        updateStage(execution, pipelineStage, true);
        updateStatus(execution, 'running', {
          currentStage: pipelineStage,
          message: pipelineStage === 'questionsGenerated' ? 'Perguntas geradas' : 'FAQ gerado',
          source: '/system/generate-faq',
        });
      } else if (execution) {
        updateStage(execution, 'faqGenerated', true);
      }

      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('[System] Erro ao gerar FAQ:', err);
        sendJson(res, 500, {
          error: 'internal_error',
          message: err.message || 'Erro ao gerar FAQ',
        });
      }
    }
    return true;
  }

  // POST /system/generate-faq-answers - Gera respostas para perguntas de FAQ
  if (method === 'POST' && pathname === '/system/generate-faq-answers') {
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
      const tenantId = (body?.tenantId && isSuperAdmin(req.agent))
        ? String(body.tenantId).trim()
        : String(authResult.agent?.tenantId || '').trim();

      if (!tenantId) {
        badRequest(res, 'tenantId é obrigatório');
        return true;
      }

      const { generateFaqAnswers } = require('../services/faqAnswersService');
      const result = await generateFaqAnswers({
        tenantId,
        questions: Array.isArray(body?.questions) ? body.questions : [],
        executionId: body?.executionId ?? null,
        name: body?.name ?? null,
        urls: Array.isArray(body?.urls) ? body.urls : [],
        fileNames: Array.isArray(body?.fileNames) ? body.fileNames : [],
        chunks: Array.isArray(body?.chunks) ? body.chunks : [],
        contextMode: body?.contextMode ?? 'auto',
        dryRun: body?.dryRun === true,
      });

      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('[System] Erro ao gerar respostas de FAQ:', err);
        sendJson(res, 500, {
          error: 'internal_error',
          message: err.message || 'Erro ao gerar respostas de FAQ',
        });
      }
    }
    return true;
  }

  // POST /system/generate-initial-flow - Gera um fluxo inicial visual para tenant
  if (method === 'POST' && pathname === '/system/generate-initial-flow') {
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
      const tenantIdForAI = (body?.tenantId && isSuperAdmin(req.agent))
        ? String(body.tenantId).trim()
        : String(authResult.agent?.tenantId || '').trim();
      const targetTenantId = body?.targetTenantId ? String(body.targetTenantId).trim() : tenantIdForAI;

      if (!tenantIdForAI) {
        badRequest(res, 'tenantId é obrigatório');
        return true;
      }
      if (!targetTenantId) {
        badRequest(res, 'targetTenantId é obrigatório');
        return true;
      }

      const { requireExecutionId } = require('../middleware/requireExecutionId');
      const rawExecutionId = body?.executionId ? String(body.executionId).trim() : '';
      const executionId = rawExecutionId ? requireExecutionId(body, res, badRequest) : null;
      if (rawExecutionId && !executionId) {
        return true;
      }

      const { generateInitialGraph } = require('../services/initialGraphService');
      const { ensureExecutionContext, updateStage, updateStatus } = require('../services/pipelineExecutionContext');

      let execution = null;
      if (executionId) {
        execution = ensureExecutionContext(
          { executionId, tenantId: tenantIdForAI, targetTenantId },
          { tenantId: tenantIdForAI }
        );
        updateStatus(execution, 'running', {
          currentStage: 'initialFlowGenerated',
          message: 'Gerando fluxo inicial do tenant',
          source: '/system/generate-initial-flow',
        });
      }

      const result = await generateInitialGraph({
        tenantIdForAI,
        tenantIdTarget: targetTenantId,
        name: body?.name ?? null,
        description: body?.description ?? null,
        urls: Array.isArray(body?.urls) ? body.urls : [],
        fileNames: Array.isArray(body?.fileNames) ? body.fileNames : [],
        executionId: executionId || null,
        contextMode: body?.contextMode ?? 'auto',
        chunks: Array.isArray(body?.chunks) ? body.chunks : [],
        rules: body?.rules ?? null,
        dryRun: body?.dryRun === true || body?.persistFlow === false,
      });

      if (execution) {
        updateStage(execution, 'initialFlowGenerated', true);
        updateStatus(execution, 'running', {
          currentStage: 'initialFlowGenerated',
          message: 'Fluxo inicial gerado',
          source: '/system/generate-initial-flow',
        });
      }

      sendJson(res, 200, {
        initialFlow: result?.reteJson || null,
        entities: {
          categories: Array.isArray(result?.categories) ? result.categories : [],
          coverage: typeof result?.coverage === 'number' ? result.coverage : 0,
          excludedItemsCount: Number(result?.excludedItemsCount || 0),
        },
        persisted: !!result?.persisted,
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('[System] Erro ao gerar fluxo inicial:', err);
        sendJson(res, 500, {
          error: 'internal_error',
          message: err.message || 'Erro ao gerar fluxo inicial',
        });
      }
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Sistema de Geração e Validação Único
  // -----------------------------------------------------------------------

  // POST /system/check-rate-limit - Verifica rate limit sem consumir pontos
  if (method === 'POST' && pathname === '/system/check-rate-limit') {
    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object') {
        badRequest(res, 'Body deve ser um objeto válido');
        return true;
      }

      const authResult = requireAuth(req);
      let finalTenantId = null;
      if (STRICT_TENANT_MODE) {
        if (!authResult.valid) {
          sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
          return true;
        }
        finalTenantId = requireTenant(req, res);
        if (!finalTenantId) return;
      } else {
        finalTenantId = (authResult.valid && req.tenantId) || body.tenantId || null;
        if (!finalTenantId || typeof finalTenantId !== 'string' || finalTenantId.trim() === '') {
          sendJson(res, 403, { error: 'tenant_required' });
          return true;
        }
        finalTenantId = finalTenantId.trim();
      }
      const userId = req.agent?.id || req.agent?.username || finalTenantId;

      // Determina tipo de operação baseado no payload
      const isBootstrap = body.bootstrap === true;
      const isDryRun = body.executionMode === 'dry-run';
      let operationType;
      if (isBootstrap) {
        operationType = 'BOOTSTRAP';
      } else if (isDryRun) {
        operationType = 'DRY_RUN';
      } else {
        operationType = 'GENERATION_REAL';
      }

      // Verifica rate limit sem consumir pontos
      const { checkRateLimitStatus } = require('../../infra/rate-limit');
      const status = await checkRateLimitStatus({
        userId,
        operationType,
      });

      // Para super-admins, adiciona flag indicando que rate limit é apenas informativo
      const isSuperAdminUser = req.agent ? isSuperAdmin(req.agent) : false;
      if (isSuperAdminUser) {
        status.isSuperAdmin = true;
        status.informativeOnly = true; // Rate limit é apenas informativo, não bloqueia
      }

      sendJson(res, 200, status);
    } catch (err) {
      logger.error('Erro ao verificar rate limit:', err);
      sendJson(res, 500, { 
        error: 'internal_error', 
        message: err.message || 'Erro ao verificar rate limit' 
      });
    }
    return true;
  }

  // POST /system/generate-and-validate
  if (method === 'POST' && pathname === '/system/generate-and-validate') {
    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object') {
        badRequest(res, 'Body deve ser um objeto válido');
        return true;
      }

      const authResult = requireAuth(req);
      let finalTenantId = null;
      if (STRICT_TENANT_MODE) {
        if (!authResult.valid) {
          sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
          return true;
        }
        finalTenantId = requireTenant(req, res);
        if (!finalTenantId) return;
      } else {
        finalTenantId = (authResult.valid && req.tenantId) || body.tenantId || null;
        if (!finalTenantId || typeof finalTenantId !== 'string' || finalTenantId.trim() === '') {
          sendJson(res, 403, { error: 'tenant_required' });
          return true;
        }
        finalTenantId = finalTenantId.trim();
      }
      const userId = req.agent?.id || req.agent?.username || finalTenantId;
      const agentId = req.agent?.id;

      // Callback para enviar atualizações de progresso via WebSocket
      const { emitEvent } = require('../services/websocketService');
      const onProgress = (progress) => {
        if (agentId) {
          emitEvent('generation.progress', progress, { agentId });
        } else if (finalTenantId) {
          emitEvent('generation.progress', progress, { tenantId: finalTenantId });
        }
      };

      // Usa orquestrador único generate-and-validate
      const result = await generateAndValidate(body, {
        tenantId: finalTenantId,
        userId,
        agent: req.agent, // Passa agente para verificação de super-admin
      }, onProgress);

      // Trata erro de rate limit no resultado
      if (result.rateLimitExceeded) {
        sendJson(res, 429, {
          error: 'rate_limit_exceeded',
          message: result.errors[0] || 'Rate limit excedido',
          retryAfter: result.retryAfter,
        });
        return true;
      }

      // Retorna resultado completo
      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else if (err.code === 'RATE_LIMIT_EXCEEDED') {
        // Garante que retryAfter é um número válido
        const retryAfter = (err.retryAfter && !isNaN(err.retryAfter) && err.retryAfter > 0)
          ? err.retryAfter
          : 60; // Fallback padrão de 60 segundos
        
        sendJson(res, 429, {
          error: 'rate_limit_exceeded',
          message: `Rate limit excedido. Tente novamente em ${retryAfter} segundos.`,
          retryAfter: retryAfter,
        });
      } else {
        logger.error('Erro em generate-and-validate:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message || 'Erro interno em generate-and-validate' });
      }
    }
    return true;
  }

  return false;
}

module.exports = { handleSystemGenerationRoutes };
