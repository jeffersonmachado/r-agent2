const {
  ensureRagPermission,
  isRouteMatch,
  sendRagApiError,
} = require('./ragRouteUtils');

function normalizeExtractedText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function looksLikePlaceholder(text) {
  if (!text) return false;
  if (text.includes('Não foi possível extrair conteúdo automaticamente')) return true;
  if (text.startsWith('[Arquivo:') && text.includes('Não foi possível extrair')) return true;
  return false;
}

async function emitUploadStage(deps, pipelineWsForStage, execIdForStage, payload) {
  if (!pipelineWsForStage || !execIdForStage) {
    return;
  }

  deps.emitPipelineStage(pipelineWsForStage, execIdForStage, payload);
}

async function resolvePipelineStageContext(req, deps, fields, file, isDryRun) {
  try {
    const rawExec = (fields && fields.executionId) ? String(fields.executionId).trim() : null;
    if (!rawExec || !deps.isValidExecutionId(rawExec)) {
      return { execIdForStage: null, pipelineWsForStage: null };
    }

    const pipelineWsForStage = deps.createPipelineWs({ tenantId: req.tenantId || req.agent?.tenantId || null });
    await emitUploadStage(deps, pipelineWsForStage, rawExec, {
      stage: 'file-ocr',
      status: 'running',
      message: `Processando arquivo "${file.filename}"...`,
      meta: { fileName: file.filename, mimeType: file.mimeType, dryRun: !!isDryRun },
    });

    return { execIdForStage: rawExec, pipelineWsForStage };
  } catch {
    return { execIdForStage: null, pipelineWsForStage: null };
  }
}

async function handleRagIngestionRoutes({ req, res, method, pathname, deps }) {
  if (!isRouteMatch(method, pathname, 'POST', '/rag/documents/upload')) {
    return false;
  }

  if (!ensureRagPermission({ req, res, deps, permission: 'create' })) return true;

  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    deps.badRequest(res, 'Content-Type deve ser multipart/form-data');
    return true;
  }

  try {
    const { fields, files } = await deps.parseMultipartFormData(req);
    const file = Array.isArray(files) ? files[0] : null;
    if (!file) {
      deps.badRequest(res, 'Arquivo é obrigatório');
      return true;
    }

    const requestTenantId = req.tenantId || req.agent?.tenantId || null;
    const isSuperAdminUser = deps.isSuperAdmin(req.agent);

    if (fields && fields.tenantId) {
      const bodyTenantId = String(fields.tenantId).trim();
      if (requestTenantId && bodyTenantId && bodyTenantId !== String(requestTenantId)) {
        deps.badRequest(res, 'tenantId no form-data não é permitido (use X-Tenant-Id).');
        return true;
      }
    }

    const rawPersistTenantId = (fields && (fields.persistTenantId || fields.targetTenantId))
      ? String(fields.persistTenantId || fields.targetTenantId).trim()
      : null;
    if (rawPersistTenantId && !isSuperAdminUser) {
      deps.sendJson(res, 403, { error: 'forbidden', message: 'persistTenantId é permitido apenas para super-admin' });
      return true;
    }

    const finalTenantId = (rawPersistTenantId && rawPersistTenantId.trim())
      ? rawPersistTenantId.trim()
      : requestTenantId;

    if (!requestTenantId || !finalTenantId) {
      deps.sendJson(res, 403, { error: 'forbidden', message: 'tenantId é obrigatório' });
      return true;
    }

    const isDryRun = fields && String(fields.dryRun || '').toLowerCase() === 'true';
    const { execIdForStage, pipelineWsForStage } = await resolvePipelineStageContext(req, deps, fields, file, isDryRun);

    const maxSizeBytes = 10 * 1024 * 1024;
    if (Number(file.size || 0) > maxSizeBytes) {
      return sendRagApiError(req, res, deps, {
        code: 'FILE_TOO_LARGE',
        message: 'Arquivo muito grande. Tamanho máximo: 10MB.',
        httpStatus: 400,
        retryable: false,
        details: { fileName: file.filename, fileSize: file.size, maxSizeBytes },
      }, 'Arquivo de upload maior que o limite permitido:', new Error('FILE_TOO_LARGE'));
    }

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

    const clientProvidedExtracted = normalizeExtractedText(
      (metadataFromField && (metadataFromField.extractedContent || metadataFromField.extractedText)) || ''
    );
    const hasMeaningfulClientText = !!clientProvidedExtracted
      && clientProvidedExtracted.length >= 10
      && !looksLikePlaceholder(clientProvidedExtracted);

    let extractionResult = { extractedText: '', warnings: [], source: 'none' };
    if (hasMeaningfulClientText) {
      extractionResult = { extractedText: clientProvidedExtracted, warnings: [], source: 'client' };
    } else {
      const extraction = await deps.extractTextFromFile({
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
      await emitUploadStage(deps, pipelineWsForStage, execIdForStage, {
        stage: 'file-ocr',
        status: Array.isArray(warnings) && warnings.length > 0 ? 'warning' : 'success',
        message: `Arquivo "${file.filename}" processado`,
        meta: { fileName: file.filename, dryRun: true, warningsCount: Array.isArray(warnings) ? warnings.length : 0 },
      });
      deps.sendJson(res, 200, { ok: true, data: payload, warnings, ...payload });
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
        extractedText,
        extractedContent: extractedText,
        extractionSource: extractionResult.source,
        extractionWarnings: warnings,
        ...metadataFromField,
      },
      autoIndex: !(fields && String(fields.autoIndex).toLowerCase() === 'false'),
    };

    const result = await deps.createDocument(documentData, finalTenantId);
    if (!result.success) {
      await emitUploadStage(deps, pipelineWsForStage, execIdForStage, {
        stage: 'file-ocr',
        status: 'error',
        message: result.error || 'Falha ao criar/indexar documento no RAG',
        meta: { code: 'RAG_INDEX_FAILED', fileName: file.filename },
      });
      return sendRagApiError(req, res, deps, {
        code: 'RAG_INDEX_FAILED',
        message: result.error || 'Falha ao criar/indexar documento no RAG',
        httpStatus: 500,
        retryable: true,
        details: { tenantId: finalTenantId, fileName: file.filename, mimeType: file.mimeType },
      }, 'Erro ao criar/indexar documento no RAG:', new Error(result.error || 'RAG_INDEX_FAILED'));
    }

    try {
      await deps.ragDocumentsService.upsertDocumentFileToDb({
        documentId: result.document.id,
        tenantId: finalTenantId,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: Number(file.size || 0),
        data: file.buffer,
      });

      try {
        await deps.ragDocumentsService.updateDocument(result.document.id, {
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
      deps.logger.warn('[RAGDocuments] Falha ao salvar binário original no BD (best-effort)', {
        tenantId: finalTenantId,
        documentId: result.document?.id,
        error: e.message,
      });
    }

    if (result.isDuplicate) {
      const payload = { ...result.document, isDuplicate: true, warnings };
      await emitUploadStage(deps, pipelineWsForStage, execIdForStage, {
        stage: 'file-ocr',
        status: 'success',
        message: `Arquivo "${file.filename}" processado`,
        meta: { fileName: file.filename, isDuplicate: true, warningsCount: Array.isArray(warnings) ? warnings.length : 0 },
      });
      deps.sendJson(res, 200, { ok: true, data: payload, warnings, ...payload });
      return true;
    }

    const payload = { ...result.document, warnings, indexing: result.indexing || null };

    if (result.indexing && result.indexing.attempted && result.indexing.success === false) {
      await emitUploadStage(deps, pipelineWsForStage, execIdForStage, {
        stage: 'file-ocr',
        status: 'warning',
        message: `Arquivo "${file.filename}" processado`,
        meta: { fileName: file.filename, indexing: result.indexing, warningsCount: Array.isArray(warnings) ? warnings.length : 0 },
      });
      deps.sendJson(res, 207, { ok: true, data: payload, warnings, ...payload });
      return true;
    }

    await emitUploadStage(deps, pipelineWsForStage, execIdForStage, {
      stage: 'file-ocr',
      status: Array.isArray(warnings) && warnings.length > 0 ? 'warning' : 'success',
      message: `Arquivo "${file.filename}" processado`,
      meta: { fileName: file.filename, warningsCount: Array.isArray(warnings) ? warnings.length : 0 },
    });

    deps.sendJson(res, 201, { ok: true, data: payload, warnings, ...payload });
  } catch (err) {
    try {
      const rawExec = (req && req.headers && (req.headers['x-execution-id'] || req.headers['x-pipeline-execution-id'])) || null;
      const execId = (typeof rawExec === 'string' && rawExec.trim() && deps.isValidExecutionId(rawExec.trim()))
        ? rawExec.trim()
        : null;
      const tenantIdForWs = req.tenantId || req.agent?.tenantId || null;
      if (execId && tenantIdForWs) {
        deps.emitPipelineStage(deps.createPipelineWs({ tenantId: tenantIdForWs }), execId, {
          stage: 'file-ocr',
          status: 'error',
          message: err.message || 'Erro ao processar upload de arquivo',
          meta: { code: 'FILE_UPLOAD_FAILED' },
        });
      }
    } catch {}

    return sendRagApiError(req, res, deps, {
      code: 'FILE_UPLOAD_FAILED',
      message: err.message || 'Erro ao processar upload de arquivo',
      httpStatus: 500,
      retryable: true,
      details: null,
    }, 'Erro ao fazer upload e extrair arquivo:', err);
  }

  return true;
}

module.exports = {
  handleRagIngestionRoutes,
};
