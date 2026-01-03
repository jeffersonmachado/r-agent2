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

