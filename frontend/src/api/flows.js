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

/**
 * Gera um fluxo a partir de uma descrição em linguagem natural.
 *
 * @param {string} description - Descrição do fluxo em linguagem natural
 * @param {Object} options - Opções adicionais (flowId, flowName, tenantId)
 * @returns {Promise<any>}
 */
export function generateFlowFromDescription(description, options = {}) {
  if (!description || typeof description !== 'string' || description.trim() === '') {
    return Promise.reject(new Error('generateFlowFromDescription: description é obrigatório'));
  }

  logger.info('Gerando fluxo a partir de descrição', { 
    description: description.substring(0, 100),
    options 
  });

  // Valida opções conforme contrato generation.interface.json
  const payload = {
    name: options.flowName || 'Fluxo Gerado',
    description: description.trim(),
    useRag: options.useRag || false,
    ragSources: options.useRag ? (options.ragSources || []) : [],
    useWebScraping: options.useWebScraping || false,
    scrapingTargets: options.useWebScraping ? (options.scrapingTargets || []) : [],
    generateRpaTest: options.generateRpaTest || false,
    rpaMode: options.rpaMode || 'infer',
    // Opções legadas (mantidas para compatibilidade)
    flowId: options.flowId,
    flowName: options.flowName,
    tenantId: options.tenantId,
  };

  return fetchJson('/flows/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
    // Timeout aumentado para 60 segundos pois a geração de fluxo pode demorar
    // especialmente quando precisa chamar a IA
    timeoutMs: 60000,
  }).then(
    (result) => {
      logger.info('Fluxo gerado com sucesso', { 
        flowId: result?.id, 
        flowName: result?.name,
        nodeCount: result?.nodes?.length || 0 
      });
      return result;
    },
    (error) => {
      logger.error('Erro ao gerar fluxo', error);
      throw error;
    }
  );
}

/**
 * Gera um teste RPA a partir de um fluxo usando IA.
 *
 * @param {string} flowId - ID do fluxo
 * @param {Object} options - Opções (version, autoResolveDependencies)
 * @returns {Promise<any>}
 */
export function generateRpaTestFromFlow(flowId, options = {}) {
  if (!flowId || typeof flowId !== 'string' || flowId.trim() === '') {
    return Promise.reject(new Error('generateRpaTestFromFlow: flowId é obrigatório'));
  }

  logger.info('Gerando teste RPA a partir de fluxo', { 
    flowId,
    options 
  });

  return fetchJson(`/flows/${encodeURIComponent(flowId)}/generate-rpa-test`, {
    method: 'POST',
    body: JSON.stringify({
      version: options.version,
      autoResolveDependencies: options.autoResolveDependencies || false,
    }),
    // Timeout aumentado para 60 segundos pois a geração de teste RPA pode demorar
    // especialmente quando precisa chamar a IA e processar dependências
    timeoutMs: 60000,
  }).then(
    (result) => {
      logger.info('Teste RPA gerado com sucesso', { 
        testId: result?.rpaTest?.id, 
        stepCount: result?.rpaTest?.steps?.length || 0,
        assertCount: result?.rpaTest?.asserts?.length || 0
      });
      return result;
    },
    (error) => {
      logger.error('Erro ao gerar teste RPA', error);
      throw error;
    }
  );
}

/**
 * Salva um teste RPA gerado.
 *
 * @param {Object} rpaTest - Teste RPA a ser salvo
 * @returns {Promise<any>}
 */
export function saveRpaTest(rpaTest) {
  if (!rpaTest || !rpaTest.id) {
    return Promise.reject(new Error('saveRpaTest: rpaTest é obrigatório e deve ter um id'));
  }

  logger.info('Salvando teste RPA', { testId: rpaTest.id });

  return fetchJson('/rpa-tests', {
    method: 'POST',
    body: JSON.stringify({ rpaTest }),
  }).then(
    (result) => {
      logger.info('Teste RPA salvo com sucesso', { testId: rpaTest.id, filePath: result?.filePath });
      return result;
    },
    (error) => {
      logger.error('Erro ao salvar teste RPA', error);
      throw error;
    }
  );
}

/**
 * Gera fluxo e teste RPA usando o orquestrador completo (suporta Bootstrap).
 * 
 * @param {Object} payload - Payload completo conforme generation.interface.json
 * @returns {Promise<any>}
 */
export function generateFlowWithOrchestrator(payload) {
  if (!payload || typeof payload !== 'object') {
    return Promise.reject(new Error('generateFlowWithOrchestrator: payload é obrigatório'));
  }

  if (!payload.description || typeof payload.description !== 'string' || payload.description.trim() === '') {
    return Promise.reject(new Error('generateFlowWithOrchestrator: description é obrigatório'));
  }

  logger.info('Gerando fluxo com orquestrador', { 
    name: payload.name,
    bootstrap: payload.bootstrap || false,
    useRag: payload.useRag || false,
    useWebScraping: payload.useWebScraping || false,
    generateRpaTest: payload.generateRpaTest || false,
  });

  // Envia o payload completo para o endpoint /flows/generate
  return fetchJson('/flows/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
    // Timeout aumentado para 120 segundos pois o modo Bootstrap pode demorar mais
    // (precisa gerar fluxo, seed, RPA e executar validação)
    timeoutMs: 120000,
  }).then(
    (result) => {
      logger.info('Geração concluída com sucesso', { 
        flowId: result?.flowDefinition?.id, 
        flowName: result?.flowDefinition?.name,
        bootstrap: result?.bootstrap || false,
        bootstrapValidation: result?.validation?.bootstrap?.success || null,
      });
      return result;
    },
    (error) => {
      logger.error('Erro ao gerar fluxo com orquestrador', error);
      throw error;
    }
  );
}


