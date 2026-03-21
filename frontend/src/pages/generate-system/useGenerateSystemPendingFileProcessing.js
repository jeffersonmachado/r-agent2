/** @typedef {{inferFileCategoryWithAI: (file: File) => Promise<string>, handleFileUpload: (fileObj: Record<string, unknown>) => Promise<Record<string, unknown>>, updateUploadedFile: (id: string, patch: Record<string, unknown>) => void, FileStatus: {error: string}, logger: {info: Function, debug: Function, error: Function}, fileCategoryInferenceIssuesRef: {current: {count?: number, last?: Record<string, unknown>}|null}}} UseGenerateSystemPendingFileProcessingParams */

/**
 * @param {UseGenerateSystemPendingFileProcessingParams} params
 * @param {(file: File) => Promise<string>} params.inferFileCategoryWithAI
 * @param {(fileObj: Object) => Promise<Object>} params.handleFileUpload
 * @param {(id: string, patch: Object) => void} params.updateUploadedFile
 * @param {{error: string}} params.FileStatus
 * @param {{info: Function, debug: Function, error: Function}} params.logger
 * @param {{current: {count?: number, last?: Object}|null}} params.fileCategoryInferenceIssuesRef
 * @returns {{processPendingFilesWithPipeline: Function, processPendingFilesInBackground: Function}}
 */
export function useGenerateSystemPendingFileProcessing({
  inferFileCategoryWithAI,
  handleFileUpload,
  updateUploadedFile,
  FileStatus,
  logger,
  fileCategoryInferenceIssuesRef,
}) {
  const processPendingFilesWithPipeline = async ({
    pendingFiles,
    source,
    sourceTag,
    setPipelineDetails,
    updatePipelineWithDetails,
    collectEvidence = false,
    evidenceChunks,
    completionMessage,
    emptyMessage,
    waitAfterMs = 0,
  }) => {
    if (!Array.isArray(pendingFiles) || pendingFiles.length === 0) {
      updatePipelineWithDetails({
        filesInferred: {
          status: 'completed',
          progress: 100,
          message: emptyMessage,
          timestamp: new Date().toISOString(),
        },
      }, sourceTag);
      return { processedCount: 0, issuesCount: 0, lastIssue: null };
    }

    fileCategoryInferenceIssuesRef.current = { count: 0, last: null };

    logger.info(`[${source}] Processando arquivos pendentes`, {
      pendingFilesCount: pendingFiles.length,
      files: pendingFiles.map((file) => ({ id: file.id, name: file.name })),
    });

    updatePipelineWithDetails({
      filesInferred: {
        status: 'in_progress',
        progress: 0,
        message: `Processando ${pendingFiles.length} arquivo(s)...`,
      },
    }, sourceTag);

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
        if (collectEvidence && evidenceChunks && uploadRes?.ok && uploadRes?.text) {
          evidenceChunks.push({
            sourceType: uploadRes.sourceType || 'uploaded_file',
            sourceId: uploadRes.sourceId || fileObj.name,
            text: uploadRes.text,
          });
        }
      } catch (error) {
        logger.error(`[${source}] Erro ao processar arquivo ${fileObj.name}`, {
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
    const warningMessage = issuesCount > 0
      ? `${completionMessage}. Categoria de ${issuesCount} arquivo(s) inferida via fallback (IA indisponível: ${lastIssue?.code || lastIssue?.httpStatus || 'erro'}).`
      : completionMessage;

    updatePipelineWithDetails({
      filesInferred: {
        status: issuesCount > 0 ? 'warning' : 'completed',
        progress: 100,
        message: warningMessage,
        timestamp: new Date().toISOString(),
        ...(issuesCount > 0 ? { warning: { issuesCount, lastIssue } } : {}),
      },
    }, sourceTag);

    if (waitAfterMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitAfterMs));
    }

    return { processedCount, issuesCount, lastIssue };
  };

  const processPendingFilesInBackground = ({
    pendingFiles,
    source,
    uploadedFiles,
  }) => {
    if (!Array.isArray(pendingFiles) || pendingFiles.length === 0) return;

    logger.info(`[${source}] Processando arquivos pendentes (sem gerar artefatos)`, {
      pendingFilesCount: pendingFiles.length,
      files: pendingFiles.map((file) => ({ id: file.id, name: file.name })),
    });

    (async () => {
      for (let index = 0; index < pendingFiles.length; index += 1) {
        const fileObj = pendingFiles[index];
        try {
          logger.debug(`[${source}] Processando arquivo ${index + 1}/${pendingFiles.length}`, {
            fileName: fileObj.name,
            fileId: fileObj.id,
          });

          const inferredCategory = await inferFileCategoryWithAI(fileObj.file);
          logger.info(`[${source}] Categoria inferida: ${inferredCategory}`, {
            fileName: fileObj.name,
            category: inferredCategory,
          });

          updateUploadedFile(fileObj.id, { category: inferredCategory });

          logger.debug(`[${source}] Fazendo upload do arquivo ${fileObj.name}`);
          await handleFileUpload({
            ...fileObj,
            category: inferredCategory,
          });
          logger.info(`[${source}] Upload concluído para arquivo ${fileObj.name}`);
        } catch (error) {
          logger.error(`[${source}] Erro ao processar arquivo ${fileObj.name}`, {
            error: error.message,
            stack: error.stack,
            fileId: fileObj.id,
          });
          updateUploadedFile(fileObj.id, {
            status: FileStatus.error,
            error: error.message || 'Erro ao processar arquivo',
            progress: 0,
          });
        }
      }

      logger.info(`[${source}] Todos os arquivos processados (sem gerar artefatos)`, {
        totalFiles: uploadedFiles.length,
        processedFiles: pendingFiles.length,
        successFiles: uploadedFiles.filter((file) => file.status === 'success').length,
        errorFiles: uploadedFiles.filter((file) => file.status === 'error').length,
      });
    })();
  };

  return {
    processPendingFilesWithPipeline,
    processPendingFilesInBackground,
  };
}