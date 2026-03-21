import { useCallback, useMemo, useState } from 'react';
import { buildReplaySteps } from './generateSystemResultUtils';

/** @typedef {{fetchJson: (path: string) => Promise<Record<string, unknown>>, listRpaReplays: () => Promise<{files?: Array<{filename: string}>}>, getRpaReplay: (filename: string) => Promise<Record<string, unknown>>, executeRpaRecording: (recordingId: string, options?: Record<string, unknown>, runtimeOptions?: Record<string, unknown>) => Promise<Record<string, unknown>>, logger: {info: Function, warn: Function, error: Function}, setError: (message: string) => void}} UseGenerateSystemReportReplayParams */

/** @typedef {{showReportModal: boolean, setShowReportModal: Function, reportData: Record<string, unknown>|null, setReportData: Function, loadingReport: boolean, reportError: string|null, setReportError: Function, replayStepByStep: boolean, setReplayStepByStep: Function, currentReplayStep: number, setCurrentReplayStep: Function, currentStep: Record<string, unknown>|undefined, totalSteps: number, getReplaySteps: () => unknown[], goToFirst: Function, goToPrevious: Function, goToNext: Function, goToLast: Function, handleViewReport: (reportLink: string) => Promise<void>, handleReplayClick: (replayId: string, detail: Record<string, unknown>) => Promise<void>}} UseGenerateSystemReportReplayReturn */

/**
 * @param {UseGenerateSystemReportReplayParams} params
 * @returns {UseGenerateSystemReportReplayReturn}
 */
export function useGenerateSystemReportReplay({
  fetchJson,
  listRpaReplays,
  getRpaReplay,
  executeRpaRecording,
  logger,
  setError,
}) {
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState(null);
  const [replayStepByStep, setReplayStepByStep] = useState(false);
  const [currentReplayStep, setCurrentReplayStep] = useState(0);

  const replaySteps = useMemo(() => buildReplaySteps(reportData), [reportData]);
  const currentStep = replaySteps[currentReplayStep];
  const totalSteps = replaySteps.length;

  const getReplaySteps = useCallback(() => replaySteps, [replaySteps]);

  const goToStep = useCallback((stepIndex) => {
    if (stepIndex >= 0 && stepIndex < totalSteps) {
      setCurrentReplayStep(stepIndex);
    }
  }, [totalSteps]);

  const goToPrevious = useCallback(() => goToStep(currentReplayStep - 1), [goToStep, currentReplayStep]);
  const goToNext = useCallback(() => goToStep(currentReplayStep + 1), [goToStep, currentReplayStep]);
  const goToFirst = useCallback(() => goToStep(0), [goToStep]);
  const goToLast = useCallback(() => goToStep(totalSteps - 1), [goToStep, totalSteps]);

  const handleViewReport = useCallback(async (reportLink) => {
    if (!reportLink) return;

    setShowReportModal(true);
    setLoadingReport(true);
    setReportData(null);
    setReportError(null);
    setReplayStepByStep(false);
    setCurrentReplayStep(0);

    try {
      const data = await fetchJson(reportLink);
      const replayData = data.replayData || data;
      if (replayData) {
        const actionsCount = replayData.actions?.length || 0;
        const screensCount = replayData.screens?.length || 0;
        logger.info('Replay carregado', {
          replayId: replayData.id,
          recordingId: replayData.recordingId,
          actionsCount,
          screensCount,
          hasActions: actionsCount > 0,
          hasScreens: screensCount > 0,
          startTime: replayData.startTime,
          endTime: replayData.endTime,
        });
      }

      setReportData(data);
    } catch (err) {
      logger.error('Erro ao carregar relatório', err);
      setReportError(err.message || 'Erro ao carregar relatório');
    } finally {
      setLoadingReport(false);
    }
  }, [fetchJson, logger]);

  const handleReplayClick = useCallback(async (replayId, detail) => {
    if (!replayId) {
      setError('Replay ID não encontrado');
      return;
    }

    try {
      let recordingId = detail?.recordingId;
      let replayFilename = null;
      let replayLink = null;

      const replayPath = detail?.replayPath;
      if (replayPath) {
        replayFilename = replayPath.split('/').pop();
        if (replayFilename) {
          replayLink = `/tests/rpa/replay/${replayFilename}`;
        }
      }

      if (!replayFilename) {
        try {
          const replaysList = await listRpaReplays();
          for (const file of replaysList.files || []) {
            try {
              const replayData = await getRpaReplay(file.filename);
              if (replayData?.id === replayId) {
                replayFilename = file.filename;
                replayLink = `/tests/rpa/replay/${file.filename}`;
                if (!recordingId) {
                  recordingId = replayData?.recordingId;
                }
                break;
              }
            } catch {
              continue;
            }
          }
        } catch (err) {
          logger.warn('Erro ao buscar replay na lista', { error: err.message });
        }
      }

      if (!recordingId && replayFilename) {
        try {
          const replayData = await getRpaReplay(replayFilename);
          recordingId = replayData?.recordingId;
        } catch (err) {
          logger.warn('Erro ao buscar replay pelo filename', { replayFilename, error: err.message });
        }
      }

      if (replayLink) {
        await handleViewReport(replayLink);
      } else {
        setError('Não foi possível encontrar o arquivo de replay');
        logger.warn('ReplayLink não encontrado', { replayId, detail });
      }

      if (recordingId) {
        const result = await executeRpaRecording(recordingId, {}, {});
        if (result && result.success !== false) {
          logger.info('Replay executado com sucesso', { replayId, recordingId, result });
        } else {
          setError('Erro ao executar replay');
          logger.error('Erro ao executar replay', { replayId, recordingId, result });
        }
      } else {
        logger.warn('RecordingId não encontrado, apenas abrindo tela de reprodução', { replayId, detail });
      }
    } catch (err) {
      logger.error('Erro ao executar replay', err);
      setError(err.message || 'Erro ao executar replay');
    }
  }, [executeRpaRecording, getRpaReplay, handleViewReport, listRpaReplays, logger, setError]);

  return {
    showReportModal,
    setShowReportModal,
    reportData,
    setReportData,
    loadingReport,
    reportError,
    setReportError,
    replayStepByStep,
    setReplayStepByStep,
    currentReplayStep,
    setCurrentReplayStep,
    currentStep,
    totalSteps,
    getReplaySteps,
    goToFirst,
    goToPrevious,
    goToNext,
    goToLast,
    handleViewReport,
    handleReplayClick,
  };
}
