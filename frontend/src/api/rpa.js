import { fetchJson } from './client';

/**
 * Serviço de API para testes RPA.
 */

/**
 * Lista todas as gravações RPA disponíveis.
 */
export async function listRpaRecordings() {
  return fetchJson('/rpa/recordings', {
    method: 'GET',
  });
}

/**
 * Executa uma gravação RPA com configurações personalizadas.
 * 
 * @param {string} recordingId - ID da gravação a executar
 * @param {Object} config - Configurações de execução
 * @param {number} config.slowMo - Delay entre ações em ms
 * @param {boolean} config.headless - Executar em modo headless
 * @param {number} config.timeout - Timeout padrão em ms
 * @param {boolean} config.screenshotOnFailure - Capturar screenshot em falhas
 * @param {number} config.maxRetries - Máximo de tentativas
 * @param {number} config.retryDelay - Delay entre tentativas em ms
 * @param {Object} data - Dados adicionais para substituição de variáveis
 */
export async function executeRpaRecording(recordingId, config = {}, data = {}) {
  return fetchJson(`/rpa/execute/${encodeURIComponent(recordingId)}`, {
    method: 'POST',
    body: JSON.stringify({
      config,
      data,
    }),
  });
}

/**
 * Obtém o status de uma execução RPA em andamento.
 * 
 * @param {string} executionId - ID da execução
 */
export async function getRpaExecutionStatus(executionId) {
  return fetchJson(`/rpa/execution/${encodeURIComponent(executionId)}`, {
    method: 'GET',
  });
}

/**
 * Cancela uma execução RPA em andamento.
 * 
 * @param {string} executionId - ID da execução
 */
export async function cancelRpaExecution(executionId) {
  return fetchJson(`/rpa/execution/${encodeURIComponent(executionId)}/cancel`, {
    method: 'POST',
  });
}

/**
 * Continua uma execução RPA pausada sem pausas (desativa step-by-step).
 * 
 * @param {string} executionId - ID da execução
 */
export async function continueRpaExecution(executionId) {
  return fetchJson(`/rpa/execution/${encodeURIComponent(executionId)}/continue`, {
    method: 'POST',
  });
}

/**
 * Executa apenas o próximo step e pausa novamente.
 * 
 * @param {string} executionId - ID da execução
 */
export async function nextRpaStep(executionId) {
  return fetchJson(`/rpa/execution/${encodeURIComponent(executionId)}/next`, {
    method: 'POST',
  });
}

/**
 * Obtém o relatório de uma execução RPA concluída.
 * 
 * @param {string} executionId - ID da execução
 */
export async function getRpaExecutionReport(executionId) {
  return fetchJson(`/rpa/execution/${encodeURIComponent(executionId)}/report`, {
    method: 'GET',
  });
}

/**
 * Inicia gravação manual de seed RPA.
 * 
 * @param {string} seedName - Nome do seed a ser gravado
 * @param {string} initialUrl - URL inicial (opcional)
 * @returns {Promise<{success: boolean, recordingId: string, message: string}>}
 */
export async function startManualRecording(seedName, initialUrl) {
  return fetchJson('/rpa/record/start', {
    method: 'POST',
    body: JSON.stringify({
      seedName,
      initialUrl,
    }),
  });
}

/**
 * Para gravação manual e salva o seed.
 * 
 * @param {string} recordingId - ID da gravação (nome do seed)
 * @returns {Promise<{success: boolean, seedId?: string, replayId?: string, message?: string}>}
 */
export async function stopManualRecording(recordingId) {
  return fetchJson(`/rpa/record/stop/${encodeURIComponent(recordingId)}`, {
    method: 'POST',
  });
}

/**
 * Obtém status de uma gravação manual em andamento.
 * 
 * @param {string} recordingId - ID da gravação
 * @returns {Promise<{success: boolean, status?: string, seedName?: string, startTime?: string}>}
 */
export async function getRecordingStatus(recordingId) {
  return fetchJson(`/rpa/record/status/${encodeURIComponent(recordingId)}`, {
    method: 'GET',
  });
}

/**
 * Remove uma gravação RPA.
 * 
 * Tratamento idempotente: se a gravação já foi removida (404), trata como sucesso
 * e retorna um resultado indicando que já estava removida.
 * 
 * @param {string} recordingId - ID da gravação a ser removida
 * @returns {Promise<{success: boolean, deletedId: string, message: string, alreadyDeleted?: boolean}>}
 */
export async function deleteRpaRecording(recordingId) {
  if (!recordingId || typeof recordingId !== 'string' || recordingId.trim() === '') {
    return Promise.reject(new Error('deleteRpaRecording: recordingId é obrigatório'));
  }

  try {
    const result = await fetchJson(`/rpa/recordings/${encodeURIComponent(recordingId)}`, {
      method: 'DELETE',
    });
    return result;
  } catch (error) {
    // Tratamento idempotente: 404 significa que a gravação já foi removida
    // Retorna sucesso para manter consistência do estado local
    if (error.status === 404) {
      const errorBody = error.body || {};
      const isNotFound = errorBody.error === 'not_found' || 
                        (typeof errorBody === 'string' && errorBody.includes('não encontrada'));
      
      if (isNotFound) {
        // Gravação já removida - retorna sucesso idempotente
        return {
          success: true,
          deletedId: recordingId,
          message: `Gravação "${recordingId}" já havia sido removida`,
          alreadyDeleted: true,
        };
      }
    }
    
    // Para outros erros (500, 403, etc), relança o erro
    throw error;
  }
}
