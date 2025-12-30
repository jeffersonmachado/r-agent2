import { fetchJson } from './client';
import logger from '../utils/logger';

/**
 * Funções de alto nível para trabalhar com fluxos no backend.
 *
 * Importante:
 * - Nenhuma regra de negócio aqui, apenas chamadas HTTP.
 * - A forma exata dos objetos é definida pelo backend; o frontend
 *   apenas encaminha/recebe JSON.
 */

/**
 * Lista fluxos disponíveis.
 *
 * @returns {Promise<any[]>}
 */
export function listFlows() {
  return fetchJson('/flows', {
    method: 'GET',
  });
}

/**
 * Busca um fluxo específico pelo id.
 *
 * @param {string} flowId
 * @returns {Promise<any>}
 */
export function getFlow(flowId) {
  if (!flowId) {
    return Promise.reject(new Error('getFlow: flowId é obrigatório'));
  }
  return fetchJson(`/flows/${encodeURIComponent(flowId)}`, {
    method: 'GET',
  });
}

/**
 * Cria um novo fluxo.
 *
 * @param {any} flowData
 * @returns {Promise<any>}
 */
export function createFlow(flowData) {
  logger.info('Criando novo fluxo', { flowId: flowData?.id, flowName: flowData?.name });
  logger.debug('Dados do fluxo', flowData);
  
  try {
    const result = fetchJson('/flows', {
      method: 'POST',
      body: JSON.stringify(flowData || {}),
    });
    
    result.then(
      (savedFlow) => {
        logger.info('Fluxo criado com sucesso', { flowId: savedFlow?.id, flowName: savedFlow?.name });
      },
      (error) => {
        logger.error('Erro ao criar fluxo', error);
      }
    );
    
    return result;
  } catch (error) {
    logger.error('Erro ao criar fluxo (síncrono)', error);
    throw error;
  }
}

/**
 * Atualiza um fluxo existente.
 *
 * @param {string} flowId
 * @param {any} flowData
 * @returns {Promise<any>}
 */
export function updateFlow(flowId, flowData) {
  if (!flowId) {
    return Promise.reject(new Error('updateFlow: flowId é obrigatório'));
  }
  return fetchJson(`/flows/${encodeURIComponent(flowId)}`, {
    method: 'PUT',
    body: JSON.stringify(flowData || {}),
  });
}

/**
 * Valida um fluxo (FlowDefinition completo) no backend.
 *
 * @param {any} flowData
 * @returns {Promise<{ valid: boolean, errors: any[] }>}
 */
export function validateFlow(flowData) {
  return fetchJson('/flows/validate', {
    method: 'POST',
    body: JSON.stringify(flowData || {}),
  });
}

/**
 * Simula um fluxo no backend.
 *
 * Importante:
 * - Segue o contrato do backend: envia flowId + options.
 *
 * @param {string} flowId
 * @param {any} options
 * @returns {Promise<any>}
 */
export function simulateFlow(flowId, options) {
  if (!flowId) {
    return Promise.reject(new Error('simulateFlow: flowId é obrigatório'));
  }
  return fetchJson('/flows/simulate', {
    method: 'POST',
    body: JSON.stringify({
      flowId,
      ...(options || {}),
    }),
  });
}

/**
 * Carrega replay de uma sessão real.
 *
 * @param {string} sessionId
 * @returns {Promise<any>}
 */
export function getReplay(sessionId) {
  if (!sessionId) {
    return Promise.reject(new Error('getReplay: sessionId é obrigatório'));
  }
  return fetchJson(`/replay/${encodeURIComponent(sessionId)}`, {
    method: 'GET',
  });
}

/**
 * Remove um fluxo.
 *
 * @param {string} flowId
 * @returns {Promise<{ success: boolean, deletedId: string }>}
 */
export function deleteFlow(flowId) {
  if (!flowId) {
    return Promise.reject(new Error('deleteFlow: flowId é obrigatório'));
  }
  logger.info('Removendo fluxo', { flowId });
  return fetchJson(`/flows/${encodeURIComponent(flowId)}`, {
    method: 'DELETE',
  }).then(
    (result) => {
      logger.info('Fluxo removido com sucesso', { flowId, result });
      return result;
    },
    (error) => {
      logger.error('Erro ao remover fluxo', { flowId, error });
      throw error;
    }
  );
}

/**
 * Salva um fluxo como template.
 *
 * @param {any} templateData - Dados do template { id, name, description, icon, flow }
 * @returns {Promise<any>}
 */
export function saveTemplate(templateData) {
  logger.info('Salvando template', { templateId: templateData?.id, templateName: templateData?.name });
  return fetchJson('/templates', {
    method: 'POST',
    body: JSON.stringify(templateData || {}),
  }).then(
    (result) => {
      logger.info('Template salvo com sucesso', { templateId: result?.id || result?.template?.id, templateName: result?.template?.name || result?.name });
      return result;
    },
    (error) => {
      logger.error('Erro ao salvar template', error);
      throw error;
    }
  );
}


