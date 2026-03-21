import { useCallback } from 'react';

const MACHINE_KEYS = new Set([
  'providerValidated',
  'ragValidated',
  'filesInferred',
  'webScraping',
  'descriptionSuggested',
  'payloadValid',
  'contractValid',
  'contextBuilt',
  'questionsGenerated',
  'aiExecuted',
  'flowGenerated',
  'seedGenerated',
  'rpaGenerated',
  'rpaExecuted',
  'approved',
  'failed',
]);

export const useGenerateSystemPipelineDetailsUpdater = ({
  logger,
  getStepMessage,
  setPipelineStatus,
  setPipelineDetails,
}) => {
  return useCallback((statusUpdate, source = 'unknown') => {
    const timestamp = new Date().toISOString();
    logger.debug(`[Pipeline] Atualizacao recebida de ${source}`, { statusUpdate, timestamp });

    const statusUpdateSimple = {};
    const detailsUpdate = {};

    Object.keys(statusUpdate).forEach((key) => {
      const value = statusUpdate[key];
      const isMachineKey = MACHINE_KEYS.has(key);
      if (value === true) {
        if (!isMachineKey) {
          statusUpdateSimple[key] = true;
          detailsUpdate[key] = {
            status: 'completed',
            timestamp,
            message: getStepMessage(key, 'completed') || `Etapa concluida: ${key}`,
            progress: 100,
          };
        }
        return;
      }

      if (value === false) {
        if (!isMachineKey) {
          statusUpdateSimple[key] = false;
        }
        return;
      }

      if (typeof value === 'object' && value !== null) {
        const {
          status: rawStatus,
          timestamp: rawTimestamp,
          message: rawMessage,
          progress: rawProgress,
          ...rest
        } = value;
        const status = rawStatus || 'pending';
        if (!isMachineKey) {
          statusUpdateSimple[key] = status === 'completed';
          detailsUpdate[key] = {
            status,
            timestamp: rawTimestamp || timestamp,
            message: rawMessage || getStepMessage(key, status),
            progress: rawProgress !== undefined ? rawProgress : (status === 'completed' ? 100 : 0),
            ...rest,
          };
        }
      }
    });

    setPipelineStatus((prev) => {
      const next = { ...prev, ...statusUpdateSimple };
      if (next.approved === true && next.aiExecuted !== true) {
        next.approved = false;
      }
      return next;
    });

    setPipelineDetails((prev) => {
      const updated = { ...prev };
      Object.keys(detailsUpdate).forEach((key) => {
        updated[key] = detailsUpdate[key];
        if (detailsUpdate[key].status === 'completed') {
          logger.info(`[Pipeline] Etapa ${key} concluida`, { timestamp: detailsUpdate[key].timestamp, source });
        } else if (detailsUpdate[key].status === 'error') {
          logger.error(`[Pipeline] Etapa ${key} falhou`, {
            timestamp: detailsUpdate[key].timestamp,
            source,
            message: detailsUpdate[key].message,
          });
        }
      });

      return updated;
    });
  }, [getStepMessage, logger, setPipelineDetails, setPipelineStatus]);
};
