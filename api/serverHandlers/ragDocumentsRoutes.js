/**
 * RAG Documents Management Routes Handler
 *
 * Rotas para gerenciar documentos RAG, upload de arquivos, consultas, learning,
 * validação e deduplicação.
 */

const logger = require('../utils/logger');
const { buildApiError, sendApiError } = require('../utils/apiError');
const { parseMultipartFormData } = require('../utils/multipartParser');

async function handleRagDocumentsRoutes({
  req,
  res,
  method,
  pathname,
  deps: {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    requireTenant,
    isSuperAdmin,
    logAction,
    setCorsHeaders,
    // RAG services
    listDocuments,
    getDocument,
    getDocumentsStats,
    createDocument,
    updateDocument,
    deleteDocument,
    reindexDocument,
    reindexAllNotIndexed,
    ragService,
    scrapeUrl,
    scrapeUrls,
  },
}) {
  // GET /rag/documents - Lista documentos
  if (method === 'GET' && pathname === '/rag/documents') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;
      const filters = {
        tenantId,
        source: url.searchParams.get('source') || null,
        category: url.searchParams.get('category') || null,
        productId: url.searchParams.get('productId') || null,
        clientId: url.searchParams.get('clientId') || null,
        status: url.searchParams.get('status') || null,
        search: url.searchParams.get('search') || null,
      };

      const documents = listDocuments(filters);
      sendJson(res, 200, documents);
    } catch (err) {
      logger.error('Erro ao listar documentos:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // GET /rag/health - Health do RAG (Node): compara BD vs vector store e retorna warning se inconsistente
  if (method === 'GET' && pathname === '/rag/health') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;
      const autoRepair = url.searchParams.get('autoRepair') === 'true';

      const { getRagHealth } = require('../services/ragDocumentsService');
      const health = await getRagHealth(tenantId, { autoRepair });

      // status code: 200 sempre, mas inclui status=warning para UI
      sendJson(res, 200, health);
    } catch (err) {
      logger.error('Erro ao obter rag health:', err);
      sendApiError(res, buildApiError({
        code: 'INTERNAL_ERROR',
        message: 'Erro ao obter health do RAG',
        httpStatus: 500,
        retryable: true,
        details: { message: err.message },
        req,
      }), setCorsHeaders);
    }
    return true;
  }

  // POST /rag/documents/clean-orphans - Limpa documentos órfãos do vector store (vector_ahead)
  if (method === 'POST' && pathname === '/rag/documents/clean-orphans') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;

      const body = await parseJsonBody(req);
      const { documentIds } = body || {};

      const ragDocuments = require('../services/ragDocumentsService');

      // Se o caller fornecer IDs, usa a limpeza direta; senão, detecta automaticamente.
      let result;
      if (Array.isArray(documentIds) && documentIds.length > 0) {
        result = await ragDocuments.cleanOrphanedDocuments(tenantId, documentIds.map(String));
        sendJson(res, 200, result);
        return true;
      }

      result = await ragDocuments.detectAndCleanOrphanedVectorDocuments(tenantId);
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao limpar documentos órfãos:', err);
      sendApiError(res, buildApiError({
        code: 'INTERNAL_ERROR',
        message: 'Erro ao limpar documentos órfãos do vector store',
        httpStatus: 500,
        retryable: true,
        details: { message: err.message },
        req,
      }), setCorsHeaders);
    }
    return true;
  }

  // GET /rag/deduplication/stats - Estatísticas de deduplicação
  if (method === 'GET' && pathname === '/rag/deduplication/stats') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;

      const { getDeduplicationStats } = require('../services/ragDeduplicationService');
      const stats = getDeduplicationStats(tenantId);

      sendJson(res, 200, stats);
    } catch (err) {
      logger.error('Erro ao obter estatísticas de deduplicação:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // GET /rag/documents/stats - Estatísticas de documentos
  if (method === 'GET' && pathname === '/rag/documents/stats') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;
      const stats = await getDocumentsStats(tenantId);
      sendJson(res, 200, stats);
    } catch (err) {
      logger.error('Erro ao obter estatísticas:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // GET /rag/documents/:id - Obtém documento específico
  if (method === 'GET' && pathname.startsWith('/rag/documents/') && pathname !== '/rag/documents/stats') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      // GET /rag/documents/:id/download - Download do binário original (quando existir)
      if (pathname.endsWith('/download')) {
        const tenantId = requireTenant(req, res);
        if (!tenantId) return true;

        const rawId = decodeURIComponent(pathname.slice('/rag/documents/'.length).replace(/\/download$/, ''));
        const { getDocumentFileFromDb } = require('../services/ragDocumentsService');
        const fileRow = await getDocumentFileFromDb(rawId, tenantId);
        if (!fileRow || !fileRow.data) {
          sendJson(res, 404, { error: 'file_not_found', message: 'Arquivo original não encontrado no banco de dados' });
          return true;
        }

        const filename = (fileRow.filename || `documento-${rawId}`).replace(/[\r\n"]/g, '_');
        const mimeType = fileRow.mimeType || 'application/octet-stream';
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        if (Number.isFinite(fileRow.sizeBytes)) {
          res.setHeader('Content-Length', String(fileRow.sizeBytes));
        }
        res.writeHead(200);
        res.end(fileRow.data);
        return true;
      }

      // Para GET /rag/documents/:id, exige tenant e valida ownership
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;

      const documentId = decodeURIComponent(pathname.slice('/rag/documents/'.length));
      const document = getDocument(documentId);
      
      if (!document || (document.tenantId && document.tenantId !== tenantId)) {
        sendJson(res, 404, { error: 'document_not_found' });
        return true;
      }

      // Se for documento de upload (source=file), confirma (best-effort) se há binário no BD
      // e anexa metadata.originalBinary para a UI (sem expor o binário aqui).
      try {
        const meta = document.metadata || {};
        const looksLikeFileUpload = meta.source === 'file' || !!meta.fileName || !!meta.filename;
        if (looksLikeFileUpload && (!meta.originalBinary || meta.originalBinary.stored !== true)) {
          const { getDocumentFileFromDb } = require('../services/ragDocumentsService');
          const fileRow = await getDocumentFileFromDb(documentId, tenantId);
          if (fileRow && fileRow.data) {
            document.metadata = {
              ...meta,
              originalBinary: {
                stored: true,
                filename: fileRow.filename || meta.fileName || meta.filename || null,
                mimeType: fileRow.mimeType || meta.mime || meta.fileType || null,
                sizeBytes: Number.isFinite(fileRow.sizeBytes) ? fileRow.sizeBytes : null,
              },
            };
          }
        }
      } catch {
        // best-effort: não bloqueia GET do documento
      }

      sendJson(res, 200, document);
    } catch (err) {
      logger.error('Erro ao obter documento:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // POST /rag/documents/upload - Upload (multipart) com extração server-side (PDF/OCR)
  if (method === 'POST' && pathname === '/rag/documents/upload') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      badRequest(res, 'Content-Type deve ser multipart/form-data');
      return true;
    }

    try {
      const { fields, files } = await parseMultipartFormData(req);
      const file = Array.isArray(files) ? files[0] : null;
      if (!file) {
        badRequest(res, 'Arquivo é obrigatório');
        return true;
      }

      const requestTenantId = req.tenantId || req.agent?.tenantId || null;
      const isSuperAdminUser = isSuperAdmin(req.agent);

      // Hardening: tenantId em form-data não define tenant efetivo (compat: aceita se igual)
      if (fields && fields.tenantId) {
        const bodyTenantId = String(fields.tenantId).trim();
        if (requestTenantId && bodyTenantId && bodyTenantId !== String(requestTenantId)) {
          badRequest(res, 'tenantId no form-data não é permitido (use X-Tenant-Id).');
          return true;
        }
      }

      const rawPersistTenantId = (fields && (fields.persistTenantId || fields.targetTenantId))
        ? String(fields.persistTenantId || fields.targetTenantId).trim()
        : null;
      if (rawPersistTenantId && !isSuperAdminUser) {
        sendJson(res, 403, { error: 'forbidden', message: 'persistTenantId é permitido apenas para super-admin' });
        return true;
      }

      const finalTenantId = (rawPersistTenantId && rawPersistTenantId.trim())
        ? rawPersistTenantId.trim()
        : requestTenantId;

      if (!requestTenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'tenantId é obrigatório' });
        return true;
      }
      if (!finalTenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'tenantId é obrigatório' });
        return true;
      }

      const isDryRun = fields && String(fields.dryRun || '').toLowerCase() === 'true';

      // Pipeline (toasts): executionId é opcional aqui para não quebrar uploads fora do pipeline,
      // mas quando fornecido, emitimos feedback via `generation.stage`.
      let pipelineWsForStage = null;
      let execIdForStage = null;
      try {
        const { isValidExecutionId } = require('../middleware/requireExecutionId');
        const rawExec = (fields && fields.executionId) ? String(fields.executionId).trim() : null;
        if (rawExec && isValidExecutionId(rawExec)) {
          const { createPipelineWs } = require('../ws/pipelineEmitter');
          const { emitPipelineStage } = require('../ws/emitPipelineStage');
          execIdForStage = rawExec;
          // WS deve seguir o tenant do contexto do request (token/header), não o tenant de persistência.
          pipelineWsForStage = createPipelineWs({ tenantId: requestTenantId });
          emitPipelineStage(pipelineWsForStage, execIdForStage, {
            stage: 'file-ocr',
            status: 'running',
            message: `Processando arquivo "${file.filename}"...`,
            meta: { fileName: file.filename, mimeType: file.mimeType, dryRun: !!isDryRun },
          });
        }
      } catch (_) {
        // best-effort
      }

      // Limite simples de tamanho (10MB)
      const maxSizeBytes = 10 * 1024 * 1024;
      if (Number(file.size || 0) > maxSizeBytes) {
        sendApiError(res, buildApiError({
          code: 'FILE_TOO_LARGE',
          message: 'Arquivo muito grande. Tamanho máximo: 10MB.',
          httpStatus: 400,
          retryable: false,
          details: { fileName: file.filename, fileSize: file.size, maxSizeBytes },
          req,
        }), setCorsHeaders);
        return true;
      }

      // eslint-disable-next-line global-require
      const { extractTextFromFile } = require('../services/fileExtractionService');

      // Parse de metadados/tags (best-effort)
      let metadataFromField = {};
      try {
        if (fields && fields.metadata) {
          metadataFromField = JSON.parse(String(fields.metadata));
        }
      } catch {
        metadataFromField = {};
      }
      let tags = [];
      try {
        if (fields && fields.tags) {
          const parsed = JSON.parse(String(fields.tags));
          tags = Array.isArray(parsed) ? parsed : [];
        }
      } catch {
        tags = (fields && fields.tags) ? [String(fields.tags)] : [];
      }

      const normalizeExtractedText = (value) => (typeof value === 'string' ? value.trim() : '');
      const looksLikePlaceholder = (text) => {
        if (!text) return false;
        // Placeholder gerado no frontend quando a extração falha
        if (text.includes('Não foi possível extrair conteúdo automaticamente')) return true;
        if (text.startsWith('[Arquivo:') && text.includes('Não foi possível extrair')) return true;
        return false;
      };

      // Se o frontend já enviou conteúdo extraído (OCR/PDF/etc.), priorizamos isso.
      // Motivo: em dev/prod o OCR server-side pode estar desabilitado (USE_OCR!=true),
      // mas o cliente pode ter conseguido extrair texto.
      const clientProvidedExtracted = normalizeExtractedText(
        (metadataFromField && (metadataFromField.extractedContent || metadataFromField.extractedText)) || ''
      );
      const hasMeaningfulClientText = !!clientProvidedExtracted && clientProvidedExtracted.length >= 10 && !looksLikePlaceholder(clientProvidedExtracted);

      /** @type {{ extractedText: string, warnings: Array<any>, source: 'client'|'server'|'none' }} */
      let extractionResult = { extractedText: '', warnings: [], source: 'none' };

      if (hasMeaningfulClientText) {
        extractionResult = { extractedText: clientProvidedExtracted, warnings: [], source: 'client' };
      } else {
        const extraction = await extractTextFromFile({
          buffer: file.buffer,
          mimeType: file.mimeType,
          filename: file.filename,
        }, {
          timeoutMs: 15000,
          useOcr: String(process.env.USE_OCR || '').toLowerCase() === 'true',
        });
        extractionResult = {
          extractedText: normalizeExtractedText(extraction.extractedText),
          warnings: Array.isArray(extraction.warnings) ? extraction.warnings : [],
          source: 'server',
        };
      }

      const extractedText = extractionResult.extractedText;
      const warnings = extractionResult.warnings;
      const finalText = extractedText || 'Sem texto extraído. Indexando metadados do arquivo.';
      if (!extractedText) {
        warnings.push({
          code: 'NO_TEXT_EXTRACTED',
          message: 'Sem texto extraído. Indexando metadados do arquivo.',
          details: { fileName: file.filename, mimeType: file.mimeType },
        });
      }

      // DRY-RUN: não cria documento nem grava binário no BD.
      if (isDryRun) {
        const payload = {
          dryRun: true,
          tenantId: finalTenantId,
          fileName: file.filename,
          mimeType: file.mimeType,
          sizeBytes: Number(file.size || 0),
          extractedText,
          warnings,
          message: 'DRY-RUN: extração concluída, sem persistência no RAG/BD.',
        };
        try {
          if (pipelineWsForStage && execIdForStage) {
            const { emitPipelineStage } = require('../ws/emitPipelineStage');
            emitPipelineStage(pipelineWsForStage, execIdForStage, {
              stage: 'file-ocr',
              status: Array.isArray(warnings) && warnings.length > 0 ? 'warning' : 'success',
              message: `Arquivo "${file.filename}" processado`,
              meta: { fileName: file.filename, dryRun: true, warningsCount: Array.isArray(warnings) ? warnings.length : 0 },
            });
          }
        } catch (_) {}
        sendJson(res, 200, { ok: true, data: payload, warnings, ...payload });
        return true;
      }

      const nowIso = new Date().toISOString();
      const documentData = {
        title: file.filename || 'Arquivo enviado',
        content: finalText,
        metadata: {
          source: (fields && fields.source) ? String(fields.source).trim() : 'file',
          category: (fields && fields.category) ? String(fields.category).trim() : null,
          tags,
          fileName: file.filename,
          filename: file.filename,
          mime: file.mimeType,
          fileType: file.mimeType,
          fileSize: file.size,
          uploadedAt: nowIso,
          // Para UI: texto extraído puro (OCR/PDF) quando disponível
          extractedText,
          extractedContent: extractedText,
          extractionSource: extractionResult.source,
          extractionWarnings: warnings,
          ...metadataFromField,
        },
        autoIndex: !(fields && String(fields.autoIndex).toLowerCase() === 'false'),
      };

      const result = await createDocument(documentData, finalTenantId);
      if (!result.success) {
        try {
          if (pipelineWsForStage && execIdForStage) {
            const { emitPipelineStage } = require('../ws/emitPipelineStage');
            emitPipelineStage(pipelineWsForStage, execIdForStage, {
              stage: 'file-ocr',
              status: 'error',
              message: result.error || 'Falha ao criar/indexar documento no RAG',
              meta: { code: 'RAG_INDEX_FAILED', fileName: file.filename },
            });
          }
        } catch (_) {}
        sendApiError(res, buildApiError({
          code: 'RAG_INDEX_FAILED',
          message: result.error || 'Falha ao criar/indexar documento no RAG',
          httpStatus: 500,
          retryable: true,
          details: { tenantId: finalTenantId, fileName: file.filename, mimeType: file.mimeType },
          req,
        }), setCorsHeaders);
        return true;
      }

      // Salva binário original no BD (best-effort)
      try {
        const ragDocumentsService = require('../services/ragDocumentsService');
        await ragDocumentsService.upsertDocumentFileToDb({
          documentId: result.document.id,
          tenantId: finalTenantId,
          filename: file.filename,
          mimeType: file.mimeType,
          sizeBytes: Number(file.size || 0),
          data: file.buffer,
        });

        // Marca no metadata (best-effort) para a UI saber que há binário disponível
        try {
          await ragDocumentsService.updateDocument(result.document.id, {
            metadata: {
              originalBinary: {
                stored: true,
                filename: file.filename,
                mimeType: file.mimeType,
                sizeBytes: Number(file.size || 0),
                storedAt: new Date().toISOString(),
              },
            },
          });
        } catch {
          // ignore
        }
      } catch (e) {
        logger.warn('[RAGDocuments] Falha ao salvar binário original no BD (best-effort)', {
          tenantId: finalTenantId,
          documentId: result.document?.id,
          error: e.message,
        });
      }

      if (result.isDuplicate) {
        const payload = { ...result.document, isDuplicate: true, warnings };
        try {
          if (pipelineWsForStage && execIdForStage) {
            const { emitPipelineStage } = require('../ws/emitPipelineStage');
            emitPipelineStage(pipelineWsForStage, execIdForStage, {
              stage: 'file-ocr',
              status: 'success',
              message: `Arquivo "${file.filename}" processado`,
              meta: { fileName: file.filename, isDuplicate: true, warningsCount: Array.isArray(warnings) ? warnings.length : 0 },
            });
          }
        } catch (_) {}
        sendJson(res, 200, { ok: true, data: payload, warnings, ...payload });
        return true;
      }

      const payload = { ...result.document, warnings, indexing: result.indexing || null };

      // Sucesso parcial: upload/extraiu/criou, mas indexação falhou
      if (result.indexing && result.indexing.attempted && result.indexing.success === false) {
        try {
          if (pipelineWsForStage && execIdForStage) {
            const { emitPipelineStage } = require('../ws/emitPipelineStage');
            emitPipelineStage(pipelineWsForStage, execIdForStage, {
              stage: 'file-ocr',
              status: 'warning',
              message: `Arquivo "${file.filename}" processado`,
              meta: { fileName: file.filename, indexing: result.indexing, warningsCount: Array.isArray(warnings) ? warnings.length : 0 },
            });
          }
        } catch (_) {}
        sendJson(res, 207, { ok: true, data: payload, warnings, ...payload });
        return true;
      }

      try {
        if (pipelineWsForStage && execIdForStage) {
          const { emitPipelineStage } = require('../ws/emitPipelineStage');
          emitPipelineStage(pipelineWsForStage, execIdForStage, {
            stage: 'file-ocr',
            status: Array.isArray(warnings) && warnings.length > 0 ? 'warning' : 'success',
            message: `Arquivo "${file.filename}" processado`,
            meta: { fileName: file.filename, warningsCount: Array.isArray(warnings) ? warnings.length : 0 },
          });
        }
      } catch (_) {}

      sendJson(res, 201, { ok: true, data: payload, warnings, ...payload });
    } catch (err) {
      logger.error('Erro ao fazer upload e extrair arquivo:', err);
      try {
        // best-effort: tenta emitir erro se for parte de um pipeline
        const { isValidExecutionId } = require('../middleware/requireExecutionId');
        const rawExec = (req && req.headers && (req.headers['x-execution-id'] || req.headers['x-pipeline-execution-id'])) || null;
        const execId = (typeof rawExec === 'string' && rawExec.trim() && isValidExecutionId(rawExec.trim())) ? rawExec.trim() : null;
        const tenantIdForWs = req.tenantId || req.agent?.tenantId || null;
        if (execId && tenantIdForWs) {
          const { createPipelineWs } = require('../ws/pipelineEmitter');
          const { emitPipelineStage } = require('../ws/emitPipelineStage');
          emitPipelineStage(createPipelineWs({ tenantId: tenantIdForWs }), execId, {
            stage: 'file-ocr',
            status: 'error',
            message: err.message || 'Erro ao processar upload de arquivo',
            meta: { code: 'FILE_UPLOAD_FAILED' },
          });
        }
      } catch (_) {}
      sendApiError(res, buildApiError({
        code: 'FILE_UPLOAD_FAILED',
        message: err.message || 'Erro ao processar upload de arquivo',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }), setCorsHeaders);
    }
    return true;
  }

  // POST /rag/documents - Cria documento
  if (method === 'POST' && pathname === '/rag/documents') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const requestTenantId = req.tenantId || req.agent?.tenantId || null;
      const isSuperAdminUser = isSuperAdmin(req.agent);

      // Hardening: tenantId no body não deve definir o tenant efetivo.
      // - compat: se vier igual ao tenant do request, aceitamos e ignoramos
      // - segurança: se vier diferente, rejeitamos
      if (body && body.tenantId) {
        const bodyTenantId = String(body.tenantId).trim();
        if (requestTenantId && bodyTenantId && bodyTenantId !== String(requestTenantId)) {
          badRequest(res, 'tenantId no body não é permitido (use X-Tenant-Id).');
          return true;
        }
        // remove para evitar fallback interno
        try { delete body.tenantId; } catch {}
      }

      const rawPersistTenantId = body?.persistTenantId || body?.targetTenantId || null;
      if (rawPersistTenantId && !isSuperAdminUser) {
        sendJson(res, 403, { error: 'forbidden', message: 'persistTenantId é permitido apenas para super-admin' });
        return true;
      }
      if (rawPersistTenantId) {
        try { delete body.persistTenantId; } catch {}
        try { delete body.targetTenantId; } catch {}
      }

      const persistTenantId = rawPersistTenantId ? String(rawPersistTenantId).trim() : null;
      const finalTenantId = persistTenantId || requestTenantId;
      if (!finalTenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'tenantId é obrigatório' });
        return true;
      }

      const result = await createDocument(body, finalTenantId);

      if (!result.success) {
        sendJson(res, 400, { error: 'creation_failed', message: result.error });
        return true;
      }

      // Se a criação funcionou mas a indexação falhou, retorna 207 com aviso (sem quebrar criação).
      // O frontend pode exibir toast com base em `indexing.errorCode`.
      if (result.indexing && result.indexing.attempted && result.indexing.success === false) {
        logAction({
          agentId: req.agent.id,
          username: req.agent.username,
          action: 'rag_document_create_index_failed',
          resource: 'rag_document',
          resourceId: result.document.id,
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        });

        // 207 Multi-Status: indica sucesso parcial (criou, mas não indexou)
        sendJson(res, 207, {
          ...result.document,
          indexing: result.indexing,
        });
        return true;
      }

      // Se é duplicata, retorna 200 (OK) ao invés de 201 (Created)
      if (result.isDuplicate) {
        logger.info('[RAGDocuments] Documento duplicado detectado no endpoint', {
          documentId: result.document.id,
          tenantId: finalTenantId,
          isDuplicate: true
        });
        
        sendJson(res, 200, {
          ...result.document,
          isDuplicate: true,
          message: result.existingDocument ? 'Documento já existe (duplicado detectado)' : 'Documento duplicado',
        });
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_document_create',
        resource: 'rag_document',
        resourceId: result.document.id,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 201, result.document);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar documento:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    }
    return true;
  }

  // PUT /rag/documents/:id - Atualiza documento
  if (method === 'PUT' && pathname.startsWith('/rag/documents/') && !pathname.endsWith('/reindex')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const documentId = decodeURIComponent(pathname.slice('/rag/documents/'.length));
      const body = await parseJsonBody(req);
      const result = await updateDocument(documentId, body);

      if (!result.success) {
        sendJson(res, 400, { error: 'update_failed', message: result.error });
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_document_update',
        resource: 'rag_document',
        resourceId: documentId,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result.document);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atualizar documento:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    }
    return true;
  }

  // DELETE /rag/documents/:id - Deleta documento
  if (method === 'DELETE' && pathname.startsWith('/rag/documents/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'delete');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const documentId = decodeURIComponent(pathname.slice('/rag/documents/'.length));
      const result = await deleteDocument(documentId);

      if (!result.success) {
        sendJson(res, 400, { error: 'delete_failed', message: result.error });
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_document_delete',
        resource: 'rag_document',
        resourceId: documentId,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, { success: true });
    } catch (err) {
      logger.error('Erro ao deletar documento:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // POST /rag/documents/:id/reindex - Reindexa documento
  if (method === 'POST' && pathname.startsWith('/rag/documents/') && pathname.endsWith('/reindex')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const documentId = decodeURIComponent(pathname.slice('/rag/documents/'.length).replace('/reindex', ''));
      const result = await reindexDocument(documentId);

      if (!result.success) {
        sendApiError(res, buildApiError({
          code: result.errorCode || 'RAG_INDEX_FAILED',
          message: result.error || 'Falha ao reindexar documento no RAG',
          httpStatus: 500,
          retryable: true,
          details: { documentId, tenantId: req.tenantId || req.agent?.tenantId || null },
          req,
        }), setCorsHeaders);
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_document_reindex',
        resource: 'rag_document',
        resourceId: documentId,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, {
        success: true,
        chunksCreated: result.chunksCreated,
      });
    } catch (err) {
      logger.error('Erro ao reindexar documento:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // POST /rag/documents/reindex-all - Reindexa todos os documentos não indexados
  if (method === 'POST' && pathname === '/rag/documents/reindex-all') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      let tenantId = null;
      // Body é opcional - se fornecido, parseia
      let includeInconsistent = false;
      if (hasJsonContentType(req) && req.headers['content-length'] && parseInt(req.headers['content-length']) > 0) {
        const body = await parseJsonBody(req);
        tenantId = body?.tenantId || null;
        includeInconsistent = body?.includeInconsistent === true;
      }
      
      const result = await reindexAllNotIndexed(tenantId, includeInconsistent);

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_documents_reindex_all',
        resource: 'rag_documents',
        resourceId: 'all',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao reindexar documentos em lote:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // POST /rag/reindex-all?tenantId=... - Reindex completo do tenant (zera rag_chunks e reprocessa)
  if (method === 'POST' && pathname === '/rag/reindex-all') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const tenantId = url.searchParams.get('tenantId') || requireTenant(req, res);
      if (!tenantId) return true;

      const { reindexAllTenant } = require('../services/ragDocumentsService');
      const result = await reindexAllTenant(String(tenantId));

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao reindexar tenant:', err);
      sendApiError(res, buildApiError({
        code: 'RAG_REINDEX_ALL_FAILED',
        message: 'Erro ao reindexar tenant',
        httpStatus: 500,
        retryable: true,
        details: { message: err.message },
        req,
      }), setCorsHeaders);
    }
    return true;
  }

  // POST /rag/query - Faz uma pergunta ao sistema RAG
  if (method === 'POST' && pathname === '/rag/query') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'query');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { query, tenantId, options = {} } = body;

      if (!query || !query.trim()) {
        sendJson(res, 400, { error: 'invalid_request', message: 'Query não pode ser vazia' });
        return true;
      }

      // Obtém tenantId do body ou do agente autenticado
      const finalTenantId = tenantId || req.tenantId;

      // Prepara filtros (pode ser expandido no futuro)
      const filters = {
        topK: options.topK || 6,  // Aumentado de 5 para 6 para melhor cobertura
        minScore: options.minScore || 0.45,  // Reduzido de 0.5 para 0.45 para melhor taxa de sucesso
        maxTokens: options.maxTokens || 1000,
      };

      const result = await ragService.queryRag(query, finalTenantId, {}, filters);

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_query',
        resource: 'rag',
        resourceId: 'query',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao consultar RAG:', {
        error: err.message,
        stack: err.stack,
        originalError: err.originalError?.message,
      });
      
      // Melhora mensagens de erro para o usuário
      let errorMessage = err.message || 'Erro desconhecido ao consultar RAG';
      
      // Se o erro original contém informações sobre o serviço não estar disponível
      if (err.message && (err.message.includes('não está acessível') || err.message.includes('não encontrado'))) {
        errorMessage = err.message;
      } else if (err.originalError) {
        errorMessage = err.originalError.message || errorMessage;
      }
      
      sendJson(res, 500, { 
        error: 'internal_error', 
        message: errorMessage,
        success: false 
      });
    }
    return true;
  }

  // GET /rag/learning/metrics/:tenantId - Obtém métricas de aprendizado
  if (method === 'GET' && pathname.startsWith('/rag/learning/metrics/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const tenantId = decodeURIComponent(pathname.slice('/rag/learning/metrics/'.length));
      const metrics = await ragService.getLearningMetrics(tenantId);
      sendJson(res, 200, metrics);
    } catch (err) {
      logger.error('Erro ao obter métricas de aprendizado:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // POST /rag/learning/update-synonyms - Atualiza sinônimos baseado em documentos
  if (method === 'POST' && pathname === '/rag/learning/update-synonyms') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { tenant_id, documents } = body;

      if (!tenant_id || !documents) {
        sendJson(res, 400, { error: 'invalid_request', message: 'tenant_id e documents são obrigatórios' });
        return true;
      }

      const result = await ragService.updateSynonymsFromDocuments(tenant_id, documents);
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao atualizar sinônimos:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // POST /rag/learning/trigger-learning/:tenantId - Dispara aprendizado completo
  if (method === 'POST' && pathname.startsWith('/rag/learning/trigger-learning/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const tenantId = decodeURIComponent(pathname.slice('/rag/learning/trigger-learning/'.length));
      const result = await ragService.triggerLearning(tenantId);
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao disparar aprendizado:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // GET /rag/learning/full-data/:tenantId - Obtém todos os dados de aprendizado
  if (method === 'GET' && pathname.startsWith('/rag/learning/full-data/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const tenantId = decodeURIComponent(pathname.slice('/rag/learning/full-data/'.length));
      const result = await ragService.getFullLearningData(tenantId);
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao obter dados completos de aprendizado:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // PUT /rag/learning/synonyms - Atualiza sinônimo específico
  if (method === 'PUT' && pathname === '/rag/learning/synonyms') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { tenant_id, term, synonyms } = body;

      if (!tenant_id || !term || !synonyms) {
        sendJson(res, 400, { error: 'invalid_request', message: 'tenant_id, term e synonyms são obrigatórios' });
        return true;
      }

      const result = await ragService.updateSynonym(tenant_id, term, synonyms);
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao atualizar sinônimo:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // DELETE /rag/learning/synonyms/:tenantId/:term - Remove sinônimo específico
  if (method === 'DELETE' && pathname.startsWith('/rag/learning/synonyms/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'delete');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const parts = pathname.split('/').filter(p => p);
      if (parts.length < 5) {
        sendJson(res, 400, { error: 'invalid_request', message: 'Caminho inválido' });
        return true;
      }

      const tenantId = decodeURIComponent(parts[3]);
      const term = decodeURIComponent(parts[4]);

      const result = await ragService.deleteSynonym(tenantId, term);
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao remover sinônimo:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // GET /rag/learning/validation-rules - Obtém regras de validação
  if (method === 'GET' && pathname === '/rag/learning/validation-rules') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const serviceUrl = ragService.getRagServiceUrl(req.tenantId);
      const timeout = ragService.getRagTimeout(req.tenantId);

      const response = await fetch(`${serviceUrl}/rag/learning/validation-rules`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`RAG learning service error: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao obter regras de validação:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // POST /rag/learning/validation-rules/adapt/:tenantId - Dispara adaptação de regras
  if (method === 'POST' && pathname.startsWith('/rag/learning/validation-rules/adapt/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const tenantId = decodeURIComponent(pathname.slice('/rag/learning/validation-rules/adapt/'.length));
      const serviceUrl = ragService.getRagServiceUrl(tenantId);
      const timeout = ragService.getRagTimeout(tenantId);

      const response = await fetch(`${serviceUrl}/rag/learning/validation-rules/adapt/${tenantId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`RAG learning service error: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao adaptar regras:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // POST /rag/learning/clean-invalid-queries/:tenantId - Remove queries inválidas
  if (method === 'POST' && pathname.startsWith('/rag/learning/clean-invalid-queries/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const tenantId = decodeURIComponent(pathname.slice('/rag/learning/clean-invalid-queries/'.length));
      const result = await ragService.cleanInvalidQueries(tenantId);
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao limpar queries inválidas:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // GET /rag/domains - Obtém configuração de domínios RAG para o tenant
  if (method === 'GET' && pathname === '/rag/domains') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      // Obtém tenantId do agente autenticado ou do query param
      const queryParams = new URLSearchParams(req.url.split('?')[1] || '');
      const tenantIdParam = queryParams.get('tenantId');
      const finalTenantId = tenantIdParam || req.tenantId;

      // Obtém configuração de domínios
      const domains = ragService.getRagDomains(finalTenantId);
      
      // Adiciona informações detalhadas para cada domínio
      const domainsInfo = {
        tenantId: finalTenantId,
        domains: {
          chatbot: {
            ...domains.chatbot,
            enabled: ragService.isRagDomainEnabled(finalTenantId, 'chatbot'),
            sources: ragService.getRagDomainSources(finalTenantId, 'chatbot'),
          },
          rpa: {
            ...domains.rpa,
            enabled: ragService.isRagDomainEnabled(finalTenantId, 'rpa'),
            sources: ragService.getRagDomainSources(finalTenantId, 'rpa'),
          },
        },
      };

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_domains_read',
        resource: 'rag_domains',
        resourceId: finalTenantId,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, domainsInfo);
    } catch (err) {
      logger.error('Erro ao obter configuração de domínios RAG:', err);
      sendJson(res, 500, { 
        error: 'internal_error', 
        message: err.message,
      });
    }
    return true;
  }

  // Nenhuma rota RAG foi manipulada
  return false;
}

module.exports = {
  handleRagDocumentsRoutes,
};
