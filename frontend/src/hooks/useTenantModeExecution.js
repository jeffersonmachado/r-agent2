import { useCallback } from 'react';
import logger from '../utils/logger';
import { uploadDocument } from '../api/ragDocuments';

export function useTenantModeExecution({
  FileStatus,
  descriptionMode,
  executionMode,
  fetchJson,
  fileCategoryInferenceIssuesRef,
  ephemeralChunksRef,
  generateAndValidate,
  handleFileUpload,
  inferFileCategoryWithAI,
  isTenantMode,
  name,
  navigate,
  pipelineExecutionIdRef,
  pipelineAbortRef,
  scrapingTargets,
  setDescription,
  setError,
  setExecuting,
  setInitialFlow,
  setPipelineDetails,
  setPipelineStatus,
  setQuestionsList,
  setResult,
  showToast,
  suggestQuestionsAutoList,
  targetTenantIdRef,
  updatePipelineWithDetails,
  updateUploadedFile,
  uploadedFiles,
  uploadedFilesRef,
  useInlineChunksForSuggestRef,
  useWebScraping,
  agentTenantId,
  generatePayload,
}) {
  const processPendingTenantFiles = useCallback(async ({ shouldCollectEvidence, ephemeralChunks }) => {
    const pendingFiles = uploadedFiles.filter((file) => file.status === 'pending');

    if (pendingFiles.length === 0) {
      updatePipelineWithDetails({
        filesInferred: {
          status: 'completed',
          progress: 100,
          message: 'Nenhum arquivo pendente para inferir/indexar',
          timestamp: new Date().toISOString(),
        },
      }, 'file-processing');
      return;
    }

    logger.info('[TenantMode] Processando arquivos pendentes antes de continuar pipeline', {
      pendingFilesCount: pendingFiles.length,
      files: pendingFiles.map((file) => ({ id: file.id, name: file.name })),
    });

    updatePipelineWithDetails({
      filesInferred: {
        status: 'in_progress',
        progress: 0,
        message: `Processando ${pendingFiles.length} arquivo(s) antes de continuar...`,
      },
    }, 'file-processing');

    let processedCount = 0;
    for (const fileObj of pendingFiles) {
      try {
        setPipelineDetails((prev) => ({
          ...prev,
          filesInferred: {
            status: 'in_progress',
            timestamp: prev.filesInferred.timestamp || new Date().toISOString(),
            message: `Processando: ${fileObj.name}`,
            progress: prev.filesInferred.progress || 0,
          },
        }));

        const inferredCategory = await inferFileCategoryWithAI(fileObj.file);
        updateUploadedFile(fileObj.id, { category: inferredCategory });

        const uploadRes = await handleFileUpload({ ...fileObj, category: inferredCategory });
        if (shouldCollectEvidence && uploadRes && uploadRes.ok && uploadRes.text) {
          ephemeralChunks.push({
            sourceType: uploadRes.sourceType || 'uploaded_file',
            sourceId: uploadRes.sourceId || fileObj.name,
            text: uploadRes.text,
          });
        }
      } catch (error) {
        logger.error(`[TenantMode] Erro ao processar arquivo ${fileObj.name}`, {
          error: error.message,
          stack: error.stack,
          fileId: fileObj.id,
        });
        updateUploadedFile(fileObj.id, {
          status: FileStatus.error,
          error: error.message || 'Erro ao processar arquivo',
          progress: 0,
        });
      } finally {
        processedCount += 1;
        const progress = Math.round((processedCount / pendingFiles.length) * 100);
        setPipelineDetails((prev) => ({
          ...prev,
          filesInferred: {
            status: 'in_progress',
            timestamp: prev.filesInferred.timestamp || new Date().toISOString(),
            message: `Processados ${processedCount}/${pendingFiles.length} arquivo(s) (último: ${fileObj.name})`,
            progress,
          },
        }));
      }
    }

    const issuesCount = Number(fileCategoryInferenceIssuesRef.current?.count) || 0;
    const lastIssue = fileCategoryInferenceIssuesRef.current?.last || null;
    const baseMessage = executionMode === 'dry-run'
      ? `${pendingFiles.length} arquivo(s) processado(s) (dry-run: não indexado(s) no RAG)`
      : `${pendingFiles.length} arquivo(s) processado(s) (pré-criação: persistência/indexação no tenant alvo ocorre após criar o tenant)`;
    const warningMessage = issuesCount > 0
      ? `${baseMessage}. Categoria de ${issuesCount} arquivo(s) inferida via fallback (IA indisponível: ${lastIssue?.code || lastIssue?.httpStatus || 'erro'}).`
      : baseMessage;

    updatePipelineWithDetails({
      filesInferred: {
        status: issuesCount > 0 ? 'warning' : 'completed',
        progress: 100,
        message: warningMessage,
        timestamp: new Date().toISOString(),
        ...(issuesCount > 0 ? { warning: { issuesCount, lastIssue } } : {}),
      },
    }, 'file-processing');

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }, [FileStatus.error, executionMode, handleFileUpload, inferFileCategoryWithAI, setPipelineDetails, updatePipelineWithDetails, updateUploadedFile, uploadedFiles]);

  const runDryRunTenantWebScraping = useCallback(async ({
    validUrls,
    validatedTenantId,
    pipelineExecutionId,
    ephemeralChunks,
  }) => {
    updatePipelineWithDetails({
      webScraping: {
        status: 'in_progress',
        progress: 0,
        message: `Processando web scraping (dry-run) de ${validUrls.length} URL(s)...`,
        urlsTotal: validUrls.length,
      },
    }, 'webScrapingStarted');
    try {
      const scrapingStartedAt = Date.now();
      const scrapingResponse = await fetchJson('/web-scraping/scrape-batch', {
        method: 'POST',
        headers: validatedTenantId ? { 'X-Tenant-Id': validatedTenantId } : undefined,
        body: JSON.stringify({
          urls: validUrls,
          executionId: pipelineExecutionId,
          dryRun: true,
          autoIndex: false,
          source: 'web_scraping',
          category: 'general',
        }),
        timeoutMs: 60000,
      });
      const durationMs = Date.now() - scrapingStartedAt;
      const results = Array.isArray(scrapingResponse?.results) ? scrapingResponse.results : [];
      const successCount = Number.isFinite(scrapingResponse?.success)
        ? Number(scrapingResponse.success)
        : results.filter((result) => result && result.success).length;
      const failedCount = Number.isFinite(scrapingResponse?.failed)
        ? Number(scrapingResponse.failed)
        : (validUrls.length - successCount);

      for (const result of results) {
        const url = result?.url;
        const text = (result?.extractedText || '').trim();
        if (url && text && text.length >= 20) {
          ephemeralChunks.push({ sourceType: 'web_scraping', sourceId: url, text });
        }
      }

      if (successCount === 0) {
        const hasOtherEvidence = Array.isArray(ephemeralChunks)
          && ephemeralChunks.some((chunk) => chunk && typeof chunk.text === 'string' && chunk.text.trim().length >= 20);
        if (hasOtherEvidence) {
          updatePipelineWithDetails({
            webScraping: {
              status: 'warning',
              progress: 100,
              message: 'Nenhuma URL foi raspada com sucesso. Continuando com evidências dos arquivos (dry-run).',
              timestamp: new Date().toISOString(),
              urlsTotal: validUrls.length,
              successCount,
              failedCount,
              durationMs,
            },
          }, 'webScrapingCompleted');
          return true;
        }
        const errorMessage = 'Nenhuma URL foi raspada com sucesso. Verifique os logs do scraping.';
        setError(errorMessage);
        updatePipelineWithDetails({
          webScraping: {
            status: 'error',
            progress: 0,
            message: errorMessage,
            timestamp: new Date().toISOString(),
            urlsTotal: validUrls.length,
            successCount,
            failedCount,
            durationMs,
          },
        }, 'webScrapingCompleted');
        setExecuting(false);
        return false;
      }

      updatePipelineWithDetails({
        webScraping: {
          status: 'completed',
          progress: 100,
          message: `Web scraping (dry-run) concluído: ${successCount}/${validUrls.length} URL(s) processada(s)`,
          timestamp: new Date().toISOString(),
          urlsTotal: validUrls.length,
          successCount,
          failedCount,
          durationMs,
        },
      }, 'webScrapingCompleted');
      return true;
    } catch (scrapingError) {
      logger.warn('[TenantMode] Web scraping dry-run falhou', scrapingError);
      const hasOtherEvidence = Array.isArray(ephemeralChunks)
        && ephemeralChunks.some((chunk) => chunk && typeof chunk.text === 'string' && chunk.text.trim().length >= 20);
      if (hasOtherEvidence) {
        updatePipelineWithDetails({
          webScraping: {
            status: 'warning',
            progress: 100,
            message: 'Web scraping falhou. Continuando com evidências dos arquivos (dry-run).',
            timestamp: new Date().toISOString(),
            urlsTotal: validUrls.length,
            successCount: 0,
            failedCount: validUrls.length,
            error: scrapingError?.message || 'erro',
          },
        }, 'webScrapingCompleted');
        return true;
      }
      const errorMessage = 'Nenhuma URL foi raspada com sucesso. Verifique os logs do scraping.';
      updatePipelineWithDetails({
        webScraping: {
          status: 'error',
          progress: 0,
          message: errorMessage,
          timestamp: new Date().toISOString(),
          urlsTotal: validUrls.length,
          successCount: 0,
          failedCount: validUrls.length,
          error: scrapingError?.message || 'erro',
        },
      }, 'webScrapingCompleted');
      setError(errorMessage);
      setExecuting(false);
      return false;
    }
  }, [fetchJson, setError, setExecuting, updatePipelineWithDetails]);

  const runTenantWebScraping = useCallback(async ({
    validUrls,
    validatedTenantId,
    pipelineExecutionId,
  }) => {
    const scrapingStartedAt = Date.now();
    try {
      const shouldPersistScraping = !isTenantMode;
      const scrapingResponse = await fetchJson('/web-scraping/scrape-batch', {
        method: 'POST',
        headers: validatedTenantId ? { 'X-Tenant-Id': validatedTenantId } : undefined,
        body: JSON.stringify({
          urls: validUrls,
          autoIndex: shouldPersistScraping,
          source: 'web_scraping',
          category: 'general',
          executionId: pipelineExecutionId || null,
          dryRun: !shouldPersistScraping,
        }),
        timeoutMs: 60000,
      });
      const durationMs = Date.now() - scrapingStartedAt;
      const results = Array.isArray(scrapingResponse?.results) ? scrapingResponse.results : [];
      const successCount = Number.isFinite(scrapingResponse?.success)
        ? Number(scrapingResponse.success)
        : results.filter((result) => result.success).length;
      const failedCount = Number.isFinite(scrapingResponse?.failed)
        ? Number(scrapingResponse.failed)
        : (validUrls.length - successCount);
      const errorSummary = Array.isArray(scrapingResponse?.errorSummary)
        ? scrapingResponse.errorSummary
        : results.filter((result) => !result.success).map((result) => ({
            url: result.url,
            name: result.error?.name || 'Error',
            message: result.error?.message || (typeof result.error === 'string' ? result.error : 'Erro desconhecido'),
          }));

      logger.info('[Pipeline][webScraping] Web scraping concluído', {
        urlsTotal: validUrls.length,
        successCount,
        failedCount,
        durationMs,
        errorSummary,
      });

      if (successCount === 0) {
        const errorMessage = 'Nenhuma URL foi raspada com sucesso. Verifique os logs do scraping.';
        setError(errorMessage);
        console.error('[TenantMode][webScraping] Nenhuma URL raspada com sucesso. Resumo de erros:', errorSummary);
        setExecuting(false);
        return false;
      }

      try {
        if (isTenantMode && !shouldPersistScraping) {
          for (const result of results) {
            const url = result?.url;
            const text = (result?.extractedText || '').trim();
            if (url && text && text.length >= 20) {
              ephemeralChunksRef.current.push({ sourceType: 'web_scraping', sourceId: url, text });
            }
          }
        }
      } catch (_) {
        // noop
      }

      if (shouldPersistScraping) {
        logger.info('[Pipeline] Aguardando indexação completar...', { waitTime: 2000, executionMode });
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      return true;
    } catch (scrapingError) {
      logger.error('[TenantMode] Erro ao processar web scraping', scrapingError);
      setError('Nenhuma URL foi raspada com sucesso. Verifique os logs do scraping.');
      console.error('[TenantMode][webScraping] Falha no scraping (request crash). URLs:', validUrls, scrapingError);
      setExecuting(false);
      return false;
    }
  }, [ephemeralChunksRef, executionMode, fetchJson, isTenantMode, setError, setExecuting]);

  const suggestTenantDescriptionFromEphemeralContext = useCallback(async ({
    dryRunExecutionId,
    validatedTenantId,
    ephemeralChunks,
    validUrls,
    pipelineExecutionId,
  }) => {
    let useInlineChunksForSuggest = false;
    if (executionMode === 'dry-run' && dryRunExecutionId) {
      try {
        if (!ephemeralChunks || ephemeralChunks.length === 0) {
          logger.warn('[TenantMode] Nenhum chunk efêmero para persistir (dry-run). Isso pode causar fallback no suggest-description.', {
            tenantId: validatedTenantId,
            executionId: dryRunExecutionId,
          });
        } else {
          logger.info('[TenantMode] Persistindo contexto efêmero (dry-run) no backend...', {
            tenantId: validatedTenantId,
            executionId: dryRunExecutionId,
            chunksToSend: ephemeralChunks.length,
          });
        }
        const ephRes = await fetchJson('/rag/ephemeral/context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: validatedTenantId,
            executionId: dryRunExecutionId,
            chunks: ephemeralChunks,
            replace: true,
          }),
          timeoutMs: 15000,
        });
        logger.info('[TenantMode] Contexto efêmero persistido (dry-run)', {
          tenantId: validatedTenantId,
          executionId: dryRunExecutionId,
          stored: ephRes?.stored ?? null,
          used: ephRes?.used ?? null,
          key: ephRes?.key ?? null,
          stats: ephRes?.stats ?? null,
        });
        if (ephRes?.used && String(ephRes.used) !== 'redis') {
          useInlineChunksForSuggest = true;
          useInlineChunksForSuggestRef.current = true;
          logger.warn('[TenantMode] Contexto efêmero não persistido em Redis. Enviando chunks inline para sugestão.', {
            tenantId: validatedTenantId,
            executionId: dryRunExecutionId,
            used: ephRes?.used,
          });
        }
      } catch (error) {
        useInlineChunksForSuggest = true;
        useInlineChunksForSuggestRef.current = true;
        logger.warn('[TenantMode] Falha ao persistir contexto efêmero (Redis). Enviando chunks inline para sugestão.', error);
      }
    }
    const uploadedFileNames = Array.from(new Set(uploadedFiles.map((file) => (typeof file?.name === 'string' ? file.name.trim() : '')).filter(Boolean)));
    const suggestionResponse = await fetchJson('/system/suggest-description', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        tenantId: validatedTenantId,
        urls: validUrls,
        fileNames: uploadedFileNames,
        mode: descriptionMode,
        dryRun: executionMode === 'dry-run',
        executionId: pipelineExecutionId,
        ...(executionMode === 'dry-run'
          ? (useInlineChunksForSuggest
              ? { chunks: ephemeralChunks.slice(0, 30).map((chunk) => ({ ...chunk, text: (chunk?.text || '').slice(0, 5000) })) }
              : { contextMode: 'ephemeral' })
          : {}),
      }),
      timeoutMs: 60000,
    });
    if (!suggestionResponse?.suggestion) {
      logger.error('[TenantMode] Descrição não sugerida', { suggestionResponse });
      setError('A IA não retornou uma descrição sugerida. Não é possível continuar sem descrição.');
      setExecuting(false);
      return null;
    }
    const suggestedDescription = suggestionResponse.suggestion.trim();
    setDescription(suggestedDescription);
    if (suggestionResponse?.initialFlow && typeof suggestionResponse.initialFlow === 'object') {
      setInitialFlow(suggestionResponse.initialFlow);
    }
    logger.info('[TenantMode] Descrição sugerida e aplicada', { suggestedLength: suggestedDescription.length });
    return suggestedDescription;
  }, [descriptionMode, executionMode, fetchJson, name, setDescription, setError, setExecuting, setInitialFlow, uploadedFiles, useInlineChunksForSuggestRef]);

  const resolveCreatedTenantFromAiResult = useCallback((generateResult) => {
    logger.info('[TenantMode] Verificando modo de execução antes de criar tenant', {
      executionMode,
      isDryRun: executionMode === 'dry-run',
      tenantData: { name: generateResult?.tenant?.name, site: generateResult?.tenant?.site },
    });
    if (executionMode === 'dry-run') {
      logger.info('[TenantMode] Modo dry-run: simulando criação do tenant (não será persistido)');
      return {
        tenant: {
          ...(generateResult.tenant || {}),
          name: name.trim() || generateResult?.tenant?.name,
          id: `tenant-dry-run-${Date.now()}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        dryRun: true,
        pipelineUpdate: {
          payloadValid: true,
          dryRun: true,
          message: 'Tenant simulado (modo dry-run - não foi persistido)',
        },
      };
    }
    const tenantFromServer = generateResult?.createdTenant || generateResult?.existingTenant || null;
    if (!tenantFromServer) throw new Error('Tenant não foi criado/reutilizado no modo seguro (createdTenant/existingTenant ausente).');
    if (tenantFromServer.status !== 'pending_review') throw new Error('Tenant existente para este site não está em modo draft (pending_review). Não é seguro continuar.');
    logger.info(generateResult?.existingTenant ? '[TenantMode] Tenant existente reaproveitado (site duplicado)' : '[TenantMode] Tenant criado em modo seguro (pending_review)', { tenantId: tenantFromServer?.id });
    return {
      tenant: tenantFromServer,
      dryRun: false,
      pipelineUpdate: {
        payloadValid: true,
        message: generateResult?.existingTenant ? 'Tenant existente reaproveitado (site já cadastrado)' : 'Tenant criado em modo seguro (pendente de aprovação)',
      },
    };
  }, [executionMode, name]);

  const persistTenantModeContentToTargetTenant = useCallback(async ({ validatedTenantId, tenantTargetId }) => {
    if (executionMode === 'dry-run') return;
    const contextTenantId = validatedTenantId || agentTenantId || null;
    if (!contextTenantId || !tenantTargetId) return;
    targetTenantIdRef.current = tenantTargetId;
    try {
      const filesSnapshot = Array.isArray(uploadedFilesRef.current) ? uploadedFilesRef.current : [];
      const filesToPersist = filesSnapshot.filter((file) => file && file.status === 'success').filter((file) => !file.documentId);
      for (const file of filesToPersist) {
        try {
          const res = await uploadDocument(file.file, {
            executionId: pipelineExecutionIdRef.current,
            tenantId: contextTenantId,
            persistTenantId: tenantTargetId,
            headers: { 'X-Tenant-Id': contextTenantId },
            category: file.category,
            tags: [file.category, 'generate-system'],
            metadata: {
              uploadedFrom: 'generate-system',
              originalFileName: file.name,
              fileName: file.name,
              fileSize: file.size,
              extractedContent: (typeof file.extractedContent === 'string' ? file.extractedContent : null),
              deferredPersist: true,
              deferredPersistReason: file.deferredPersistReason || 'tenant_mode_pre_creation',
            },
            autoIndex: true,
          });
          updateUploadedFile(file.id, {
            documentId: res?.document?.id || res?.id || null,
            isDuplicate: !!(res?.isDuplicate),
            deferredPersist: false,
            persistedTenantId: tenantTargetId,
          });
        } catch (error) {
          logger.warn('[TenantMode] Falha ao persistir arquivo no tenant alvo', {
            fileName: file?.name,
            tenantTargetId,
            error: error?.message || String(error),
          });
        }
      }
      const validUrlsToPersist = (Array.isArray(scrapingTargets) ? scrapingTargets : []).filter((url) => url && String(url).trim().startsWith('http'));
      if (useWebScraping && validUrlsToPersist.length > 0) {
        await fetchJson('/web-scraping/scrape-batch', {
          method: 'POST',
          headers: { 'X-Tenant-Id': contextTenantId },
          body: JSON.stringify({
            urls: validUrlsToPersist,
            autoIndex: true,
            source: 'web_scraping',
            category: 'general',
            executionId: pipelineExecutionIdRef.current || null,
            dryRun: false,
            persistTenantId: tenantTargetId,
          }),
          timeoutMs: 60000,
          silent: true,
        });
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      logger.warn('[TenantMode] Falha ao persistir conteúdo no tenant alvo (best-effort)', {
        tenantTargetId,
        error: error?.message || String(error),
      });
    }
  }, [agentTenantId, executionMode, fetchJson, pipelineExecutionIdRef, scrapingTargets, updateUploadedFile, uploadedFilesRef, useWebScraping]);

  const handleTenantArtifactsGeneration = useCallback(async ({
    createdTenant,
    pipelineExecutionId,
    startInitialFlowBestEffort,
  }) => {
    setPipelineStatus((prev) => ({
      ...prev,
      contractValid: false,
      contextBuilt: false,
      aiExecuted: false,
      flowGenerated: false,
      seedGenerated: false,
      rpaGenerated: false,
      rpaExecuted: false,
      approved: false,
    }));
    setPipelineDetails((prev) => ({
      ...prev,
      contractValid: { status: 'pending', timestamp: null, message: null, progress: 0 },
      contextBuilt: { status: 'pending', timestamp: null, message: null, progress: 0 },
      aiExecuted: { status: 'pending', timestamp: null, message: null, progress: 0 },
      flowGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
      seedGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
      rpaGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
      rpaExecuted: { status: 'pending', timestamp: null, message: null, progress: 0 },
      approved: { status: 'pending', timestamp: null, message: null, progress: 0 },
    }));
    const payload = generatePayload();
    payload.name = name.trim();
    if (payload.includeQuestions === true && (!Array.isArray(payload.questions) || payload.questions.length === 0)) {
      try {
        const autoQuestions = await suggestQuestionsAutoList();
        if (!autoQuestions || autoQuestions.length === 0) {
          pipelineAbortRef.current = true;
          const msg = 'Não foi possível gerar perguntas automaticamente. Adicione ao menos 1 pergunta.';
          setError(msg);
          showToast?.(msg, 'error');
          setExecuting(false);
          return false;
        }
        setQuestionsList(autoQuestions);
        payload.questions = autoQuestions.slice(0, 50);
        startInitialFlowBestEffort();
      } catch (error) {
        logger.warn('[Questions] Falha ao gerar perguntas automaticamente (tenant mode)', { error: error?.message });
        pipelineAbortRef.current = true;
        const msg = error?.message || 'Falha ao gerar perguntas automaticamente. Adicione ao menos 1 pergunta.';
        setError(msg);
        showToast?.(msg, 'error');
        setExecuting(false);
        return false;
      }
    } else if (payload.includeQuestions === true && Array.isArray(payload.questions) && payload.questions.length > 0) {
      startInitialFlowBestEffort();
    }
    logger.info('[TenantMode] Arquivos já processados antes da sugestão de descrição', {
      totalFiles: uploadedFiles.length,
      filesByStatus: {
        pending: uploadedFiles.filter((file) => file.status === 'pending').length,
        processing: uploadedFiles.filter((file) => file.status === 'processing').length,
        success: uploadedFiles.filter((file) => file.status === 'success').length,
        error: uploadedFiles.filter((file) => file.status === 'error').length,
      },
    });
    if (executionMode === 'real') {
      try {
        logger.info('[TenantMode] Verificando saúde do servidor antes de executar em modo real...');
        await fetchJson('/health', { method: 'GET', timeoutMs: 5000 });
        logger.info('[TenantMode] Servidor está disponível, aguardando 2s para garantir estabilidade...');
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (healthError) {
        logger.error('[TenantMode] Servidor não está disponível', healthError);
        const errorMessage = 'Servidor não está respondendo. Verifique se o servidor está rodando e tente novamente.';
        setError(errorMessage);
        showToast?.(errorMessage, 'error');
        updatePipelineWithDetails({
          aiExecuted: {
            status: 'error',
            progress: 0,
            message: 'Servidor não está disponível',
            timestamp: new Date().toISOString(),
          },
        }, 'server-unavailable');
        setExecuting(false);
        return false;
      }
    }
    payload.executionId = pipelineExecutionId;
    payload.tenantPipeline = true;
    const response = await generateAndValidate(payload);
    try {
      const flowFromArtifacts = response?.flowDefinition || null;
      if (flowFromArtifacts && typeof flowFromArtifacts === 'object') {
        setInitialFlow((prev) => (prev ? prev : flowFromArtifacts));
      }
    } catch (_) {
      // noop
    }
    setResult({ success: true, tenant: createdTenant.tenant, generated: true, ...response });
    return true;
  }, [executionMode, fetchJson, generateAndValidate, generatePayload, name, pipelineAbortRef, setError, setExecuting, setInitialFlow, setPipelineDetails, setPipelineStatus, setQuestionsList, setResult, showToast, suggestQuestionsAutoList, updatePipelineWithDetails, uploadedFiles]);

  const handleTenantCreationOnly = useCallback(async ({ createdTenant }) => {
    const pendingFiles = uploadedFiles.filter((file) => file.status === 'pending');
    if (pendingFiles.length > 0) {
      logger.info('[TenantMode] Processando arquivos pendentes (sem gerar artefatos)', {
        pendingFilesCount: pendingFiles.length,
        files: pendingFiles.map((file) => ({ id: file.id, name: file.name })),
      });
      (async () => {
        for (let i = 0; i < pendingFiles.length; i += 1) {
          const fileObj = pendingFiles[i];
          try {
            logger.debug(`[TenantMode] Processando arquivo ${i + 1}/${pendingFiles.length}`, {
              fileName: fileObj.name,
              fileId: fileObj.id,
            });
            const inferredCategory = await inferFileCategoryWithAI(fileObj.file);
            updateUploadedFile(fileObj.id, { category: inferredCategory });
            await handleFileUpload({ ...fileObj, category: inferredCategory });
          } catch (error) {
            logger.error(`[TenantMode] Erro ao processar arquivo ${fileObj.name}`, {
              error: error.message,
              stack: error.stack,
              fileId: fileObj.id,
            });
            updateUploadedFile(fileObj.id, { status: FileStatus.error, error: error.message || 'Erro ao processar arquivo', progress: 0 });
          }
        }
      })();
    }
    setResult({ success: true, tenant: createdTenant.tenant, generated: true });
    setTimeout(() => navigate('/tenants'), 2000);
    return true;
  }, [FileStatus.error, handleFileUpload, inferFileCategoryWithAI, navigate, setResult, updateUploadedFile, uploadedFiles]);

  return {
    processPendingTenantFiles,
    runDryRunTenantWebScraping,
    runTenantWebScraping,
    suggestTenantDescriptionFromEphemeralContext,
    resolveCreatedTenantFromAiResult,
    persistTenantModeContentToTargetTenant,
    handleTenantArtifactsGeneration,
    handleTenantCreationOnly,
  };
}
