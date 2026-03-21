import { inferFileCategoryFallback } from './generateSystemFileUtils';

/**
 * @typedef {{id: string, name: string, file: File, status?: string, category?: string}} UploadedFileInput
 */

/** @typedef {{agent: {tenantId?: string}, uploadDocument: (file: File, options: Record<string, unknown>) => Promise<Record<string, unknown>>, processFile: (file: File, options: Record<string, unknown>) => Promise<{file: File, preview: string|null, content: string|null}>, fetchJson: (path: string, options: Record<string, unknown>) => Promise<Record<string, unknown>>, fetchBlob: (path: string, options: Record<string, unknown>) => Promise<Response>, addSelectedFiles: (files: File[]) => UploadedFileInput[], uploadedFiles: UploadedFileInput[], updateUploadedFile: (id: string, patch: Record<string, unknown>) => void, FileStatus: {processing: string, success: string, error: string}, fileCategoryInferenceIssuesRef: {current: {count?: number, last?: Record<string, unknown>}|null}, logger: {debug: Function, info: Function, warn: Function, error: Function}, showToast?: (message: string, type?: string) => void, setError: (message: string) => void, executionMode: 'dry-run'|'real', isTenantMode: boolean, targetTenantIdRef: {current: string|null}, pipelineExecutionIdRef: {current: string|null}}} UseGenerateSystemFileUploadParams */

/**
 * Encapsulates file-select, file-upload, download, and AI category-inference
 * logic for GenerateSystemPage.
 *
 * All external dependencies are injected as arguments so this hook remains
 * testable and free of hidden context coupling.
 * @param {UseGenerateSystemFileUploadParams} params
 * @param {{tenantId?: string}} params.agent
 * @param {(file: File, options: Object) => Promise<Object>} params.uploadDocument
 * @param {(file: File, options: Object) => Promise<{file: File, preview: string|null, content: string|null}>} params.processFile
 * @param {(path: string, options: Object) => Promise<Object>} params.fetchJson
 * @param {(path: string, options: Object) => Promise<Response>} params.fetchBlob
 * @param {(files: File[]) => Array<{id: string}>} params.addSelectedFiles
 * @param {UploadedFileInput[]} params.uploadedFiles
 * @param {(id: string, patch: Object) => void} params.updateUploadedFile
 * @param {{processing: string, success: string, error: string}} params.FileStatus
 * @param {{current: {count?: number, last?: Object}|null}} params.fileCategoryInferenceIssuesRef
 * @param {{debug: Function, info: Function, warn: Function, error: Function}} params.logger
 * @param {(message: string, type?: string) => void} [params.showToast]
 * @param {(message: string) => void} params.setError
 * @param {'dry-run'|'real'} params.executionMode
 * @param {boolean} params.isTenantMode
 * @param {{current: string|null}} params.targetTenantIdRef
 * @param {{current: string|null}} params.pipelineExecutionIdRef
 * @returns {{handleFileSelect: Function, handleFileUpload: Function, downloadRagOriginalFile: Function, inferFileCategoryWithAI: Function}}
 */
export function useGenerateSystemFileUpload({
  agent,
  uploadDocument,
  processFile,
  fetchJson,
  fetchBlob,
  addSelectedFiles,
  uploadedFiles,
  updateUploadedFile,
  FileStatus,
  fileCategoryInferenceIssuesRef,
  logger,
  showToast,
  setError,
  executionMode,
  isTenantMode,
  targetTenantIdRef,
  pipelineExecutionIdRef,
}) {
  // ---------------------------------------------------------------------------
  // AI-powered category inference
  // ---------------------------------------------------------------------------
  const inferFileCategoryWithAI = async (file) => {
    try {
      const fileName = file.name;
      const fileType = file.type;
      const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';

      let contentSample = '';
      const isTextFile = fileType.startsWith('text/') ||
        ['txt', 'md', 'json', 'csv', 'doc', 'docx'].includes(fileExtension);
      const isImage = fileType.startsWith('image/') ||
        ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(fileExtension);

      if (isTextFile && file.size > 0 && file.size < 50000) {
        try {
          const text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve((e.target.result || '').substring(0, 2000));
            reader.onerror = reject;
            reader.readAsText(file);
          });
          contentSample = text;
        } catch (readError) {
          logger.warn('Erro ao ler amostra do arquivo para inferência', readError);
        }
      }

      let prompt = `Analise o seguinte arquivo e categorize-o em UMA das seguintes categorias: promocoes, avisos, tabelas_preco, imagens, outros.\n\n`;
      prompt += `Nome do arquivo: ${fileName}\n`;
      prompt += `Tipo MIME: ${fileType || 'desconhecido'}\n`;
      prompt += `Extensão: ${fileExtension || 'nenhuma'}\n`;

      if (isImage) {
        prompt += `Tipo: Imagem\n`;
      } else if (contentSample) {
        prompt += `Amostra do conteúdo (primeiros 2000 caracteres):\n${contentSample}\n`;
      }

      prompt += `\nCategorias disponíveis:\n`;
      prompt += `- promocoes: Arquivos relacionados a promoções, descontos, ofertas, campanhas promocionais\n`;
      prompt += `- avisos: Arquivos relacionados a avisos, comunicados, notícias, anúncios, informações gerais\n`;
      prompt += `- tabelas_preco: Arquivos relacionados a tabelas de preço, planilhas de valores, listas de preços\n`;
      prompt += `- imagens: Arquivos de imagem sem contexto específico de promoção, aviso ou tabela\n`;
      prompt += `- outros: Qualquer outro tipo de arquivo que não se encaixe nas categorias acima\n\n`;
      prompt += `Retorne APENAS o nome da categoria (uma das opções acima) em minúsculas, sem pontuação ou explicação adicional.`;

      const tenantId = agent?.tenantId;
      if (!tenantId) {
        throw new Error('Tenant ID é obrigatório para gerar categoria');
      }

      const response = await fetchJson('/api/ai/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt, tenantId }),
      });

      if (response?.text) {
        const category = response.text.trim().toLowerCase();
        const validCategories = ['promocoes', 'avisos', 'tabelas_preco', 'imagens', 'outros'];
        if (validCategories.includes(category)) {
          logger.debug('Categoria inferida pela IA', { fileName, category });
          return category;
        } else {
          logger.warn('IA retornou categoria inválida, usando fallback', { fileName, category });
        }
      }

      return inferFileCategoryFallback(file);
    } catch (error) {
      logger.error('Erro ao inferir categoria com IA, usando fallback', error);
      try {
        const code = error?.body?.error?.code || error?.code || null;
        const httpStatus = error?.status || error?.body?.error?.httpStatus || null;
        fileCategoryInferenceIssuesRef.current = {
          count: (Number(fileCategoryInferenceIssuesRef.current?.count) || 0) + 1,
          last: {
            code: code ? String(code) : null,
            httpStatus: httpStatus ? Number(httpStatus) : null,
            message: String(error?.message || error?.body?.error?.message || ''),
          },
        };
      } catch (_) {
        // noop
      }
      return inferFileCategoryFallback(file);
    }
  };

  // ---------------------------------------------------------------------------
  // File select (adds to upload queue; no upload yet)
  // ---------------------------------------------------------------------------
  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) {
      logger.warn('[FileSelect] Nenhum arquivo selecionado');
      return;
    }

    logger.info('[FileSelect] Arquivos selecionados', {
      filesCount: files.length,
      fileNames: files.map(f => f.name),
      fileSizes: files.map(f => f.size),
    });

    const newFiles = addSelectedFiles(files);

    logger.info('[FileSelect] Arquivos adicionados à lista de upload', {
      newFilesCount: newFiles.length,
      totalFilesCount: uploadedFiles.length + newFiles.length,
      fileIds: newFiles.map(f => f.id),
    });

    logger.debug('[FileSelect] Arquivos adicionados, aguardando execução para processar');
  };

  // ---------------------------------------------------------------------------
  // File upload (process + RAG indexing)
  // ---------------------------------------------------------------------------
  const handleFileUpload = async (fileObj) => {
    try {
      updateUploadedFile(fileObj.id, { status: FileStatus.processing, progress: 0, error: null });

      const isImage = fileObj.file.type.startsWith('image/');
      const isPdf = fileObj.file.type === 'application/pdf';
      const isText = fileObj.file.type.startsWith('text/') ||
        ['txt', 'md', 'json', 'csv'].includes(fileObj.file.name.split('.').pop()?.toLowerCase() || '');

      let processedFile = fileObj.file;
      let preview = null;
      let extractedContent = null;

      try {
        const processed = await processFile(fileObj.file, {
          compressImages: isImage,
          extractImageText: isImage,
          onProgress: (progress, message) => {
            logger.debug(`Processando arquivo ${fileObj.name}: ${message} (${progress}%)`);
            const raw = Number(progress);
            const pct = Number.isFinite(raw) ? Math.round(raw) : 0;
            const safePct = Math.max(0, Math.min(100, pct));
            updateUploadedFile(fileObj.id, { status: FileStatus.processing, progress: safePct });
          },
        });

        processedFile = processed.file;
        preview = processed.preview;
        extractedContent = processed.content;

        if (extractedContent) {
          logger.info(`[FileUpload] Conteúdo extraído do arquivo ${fileObj.name}`, {
            contentLength: extractedContent.length,
            preview: extractedContent.substring(0, 200),
            hasContent: extractedContent && extractedContent.length > 0,
          });
        }
      } catch (processError) {
        logger.warn('Erro ao processar arquivo, tentando fallback', {
          fileName: fileObj.name,
          error: processError.message,
        });

        if (isImage) {
          try {
            const reader = new FileReader();
            preview = await new Promise((resolve, reject) => {
              reader.onload = (e) => resolve(e.target.result);
              reader.onerror = reject;
              reader.readAsDataURL(fileObj.file);
            });
          } catch (previewError) {
            logger.warn('Erro ao criar preview da imagem', previewError);
          }
        }

        if (!extractedContent || extractedContent.trim().length === 0) {
          logger.warn('[FileUpload] Conteúdo extraído está vazio, usando placeholder', {
            fileName: fileObj.name,
            fileType: fileObj.file.type,
            extractedContentLength: extractedContent?.length || 0,
          });
          extractedContent = `[Arquivo: ${fileObj.name} - Tipo: ${fileObj.file.type}]\n\nNão foi possível extrair conteúdo automaticamente.`;
        }

        if (extractedContent.trim().length < 10) {
          logger.warn('[FileUpload] Conteúdo extraído muito curto, pode não ser indexado corretamente', {
            fileName: fileObj.name,
            contentLength: extractedContent.trim().length,
            contentPreview: extractedContent.substring(0, 100),
          });
        }
      }

      // DRY-RUN: extract only, no persistence
      if (executionMode === 'dry-run') {
        updateUploadedFile(fileObj.id, {
          status: FileStatus.success,
          documentId: null,
          preview,
          progress: 100,
          extractedContent,
          isDuplicate: false,
          dryRun: true,
        });
        return { ok: true, sourceType: 'uploaded_file', sourceId: fileObj.name, text: extractedContent };
      }

      if (!agent?.tenantId) {
        const errorMsg = 'Tenant não identificado. Faça login novamente e tente novamente.';
        setError(errorMsg);
        throw new Error(errorMsg);
      }
      const contextTenantId = agent.tenantId;

      // Tenant-mode (super-admin): defer persistence until the target tenant exists
      if (isTenantMode && !targetTenantIdRef.current) {
        updateUploadedFile(fileObj.id, {
          status: FileStatus.success,
          documentId: null,
          preview,
          progress: 100,
          extractedContent,
          isDuplicate: false,
          dryRun: false,
          deferredPersist: true,
          deferredPersistReason: 'tenant_mode_pre_creation',
        });
        return { ok: true, sourceType: 'uploaded_file', sourceId: fileObj.name, text: extractedContent };
      }

      const persistTenantId = (isTenantMode && targetTenantIdRef.current)
        ? targetTenantIdRef.current
        : contextTenantId;

      logger.info('[FileUpload] Preparando upload para RAG', {
        fileName: fileObj.name,
        tenantId: contextTenantId,
        persistTenantId,
        hasExtractedContent: !!extractedContent,
        extractedContentLength: extractedContent?.length || 0,
        autoIndex: true,
      });

      const result = await uploadDocument(processedFile, {
        executionId: pipelineExecutionIdRef.current,
        tenantId: contextTenantId,
        ...(persistTenantId && persistTenantId !== contextTenantId ? { persistTenantId } : {}),
        headers: contextTenantId ? { 'X-Tenant-Id': contextTenantId } : undefined,
        category: fileObj.category,
        tags: [fileObj.category, 'generate-system'],
        metadata: {
          uploadedFrom: 'generate-system',
          originalFileName: fileObj.name,
          fileName: fileObj.name,
          fileSize: fileObj.file.size,
          isImage,
          isPdf,
          isText,
          extractedContent,
        },
        autoIndex: true,
      });

      logger.info('[FileUpload] Upload concluído', {
        fileName: fileObj.name,
        documentId: result.document?.id || result.id,
        isDuplicate: result.isDuplicate || false,
        success: !!result,
      });

      const isDuplicate = result.isDuplicate || false;

      updateUploadedFile(fileObj.id, {
        status: FileStatus.success,
        documentId: result.document?.id || result.id,
        preview,
        progress: 100,
        extractedContent,
        isDuplicate,
      });

      if (isDuplicate) {
        logger.info('[FileUpload] Arquivo duplicado detectado', {
          fileName: fileObj.name,
          documentId: result.document?.id || result.id,
        });
      }
    } catch (error) {
      logger.error('Erro ao fazer upload do arquivo:', error);
      updateUploadedFile(fileObj.id, { status: FileStatus.error, error: error.message || 'Erro desconhecido', progress: 0 });
      const msg = `Erro ao processar arquivo "${fileObj.name}": ${error.message}`;
      setError(msg);
      showToast?.(msg, 'error');
      return { ok: false, error: error.message || 'Erro ao processar arquivo' };
    }
  };

  // ---------------------------------------------------------------------------
  // Download / open original RAG file
  // ---------------------------------------------------------------------------
  const downloadRagOriginalFile = async (documentId, filenameHint = null, mode = 'download') => {
    if (!documentId) return;
    try {
      const path = `/rag/documents/${encodeURIComponent(documentId)}/download`;
      const res = await fetchBlob(path, { method: 'GET', timeoutMs: 45000 });
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);

      if (mode === 'open') {
        window.open(objectUrl, '_blank', 'noopener,noreferrer');
        setTimeout(() => {
          try { URL.revokeObjectURL(objectUrl); } catch {}
        }, 15000);
        return;
      }

      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filenameHint || `documento-${documentId}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      if (e?.status === 404) {
        setError('Arquivo original não encontrado no banco (404).');
        return;
      }
      setError('Não foi possível baixar/abrir o arquivo original do RAG.');
    }
  };

  return { handleFileSelect, handleFileUpload, downloadRagOriginalFile, inferFileCategoryWithAI };
}
