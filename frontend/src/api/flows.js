import { fetchJson, fetchBlob } from './client';
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

export function listFlowsByEnvironment(environment) {
  const qs = environment ? `?environment=${encodeURIComponent(String(environment))}` : '';
  return fetchJson(`/flows${qs}`, { method: 'GET' });
}

/**
 * Busca um fluxo específico pelo id.
 *
 * @param {string} flowId
 * @returns {Promise<any>}
 */
export function getFlow(flowId, options = {}) {
  if (!flowId) {
    return Promise.reject(new Error('getFlow: flowId é obrigatório'));
  }
  return fetchJson(`/flows/${encodeURIComponent(flowId)}`, {
    method: 'GET',
    ...(options && typeof options === 'object' && options.headers ? { headers: options.headers } : {}),
  });
}

/**
 * Cria um novo fluxo.
 *
 * @param {any} flowData
 * @returns {Promise<any>}
 */
export function createFlow(flowData, options = {}) {
  logger.info('Criando novo fluxo', { flowId: flowData?.id, flowName: flowData?.name });
  logger.debug('Dados do fluxo', flowData);
  
  try {
    const result = fetchJson('/flows', {
      method: 'POST',
      body: JSON.stringify(flowData || {}),
      ...(options && typeof options === 'object' && options.headers ? { headers: options.headers } : {}),
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
export function updateFlow(flowId, flowData, options = {}) {
  if (!flowId) {
    return Promise.reject(new Error('updateFlow: flowId é obrigatório'));
  }
  return fetchJson(`/flows/${encodeURIComponent(flowId)}`, {
    method: 'PUT',
    body: JSON.stringify(flowData || {}),
    ...(options && typeof options === 'object' && options.headers ? { headers: options.headers } : {}),
  });
}

export function updateFlowEnvironment(flowId, environment) {
  if (!flowId) {
    return Promise.reject(new Error('updateFlowEnvironment: flowId é obrigatório'));
  }
  return fetchJson(`/flows/${encodeURIComponent(flowId)}/environment`, {
    method: 'PUT',
    body: JSON.stringify({ environment }),
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
 * Lista arquivos de replay RPA com suporte a paginação.
 *
 * @param {{limit?: number, offset?: number}} [options]
 * @returns {Promise<{files: Array<{filename: string, size: number, modified: string, created: string}>, pagination?: {total: number, limit: number, offset: number, hasMore: boolean}}>} 
 */
export function listRpaReplays(options = {}) {
  const params = new URLSearchParams();

  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));
  if (options.search) params.set('search', String(options.search));
  if (options.result && options.result !== 'all') params.set('result', String(options.result));
  if (options.dateRange && options.dateRange !== 'all') params.set('dateRange', String(options.dateRange));
  if (options.sortBy) params.set('sortBy', String(options.sortBy));
  if (options.sortOrder) params.set('sortOrder', String(options.sortOrder));
  if (options.source) params.set('source', String(options.source));
  if (options.waveId) params.set('waveId', String(options.waveId));
  if (options.journeyId) params.set('journeyId', String(options.journeyId));
  if (options.scenarioId) params.set('scenarioId', String(options.scenarioId));
  if (options.seedId) params.set('seedId', String(options.seedId));
  if (options.executionId) params.set('executionId', String(options.executionId));

  const suffix = params.toString();
  // Use unified API endpoint /api/test-executions/replays
  const url = suffix ? `/api/test-executions/replays?${suffix}` : '/api/test-executions/replays';

  return fetchJson(url, {
    method: 'GET',
  });
}

/**
 * Carrega um arquivo de replay RPA específico.
 *
 * @param {string} filename
 * @returns {Promise<any>}
 */
export function getRpaReplay(filename) {
  if (!filename) {
    return Promise.reject(new Error('getRpaReplay: filename é obrigatório'));
  }
  return fetchJson(`/api/test-executions/replays/${encodeURIComponent(filename)}`, {
    method: 'GET',
  });
}

/**
 * Remove um arquivo de replay RPA.
 *
 * @param {string} filename
 * @returns {Promise<{success: boolean, deletedFilename: string, message: string}>}
 */
export function deleteRpaReplay(filename) {
  if (!filename) {
    return Promise.reject(new Error('deleteRpaReplay: filename é obrigatório'));
  }
  logger.info('Removendo replay RPA', { filename });
  return fetchJson(`/api/test-executions/replays/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  }).then(
    (result) => {
      logger.info('Replay RPA removido com sucesso', { filename, result });
      return result;
    },
    (error) => {
      logger.error('Erro ao remover replay RPA', { filename, error });
      throw error;
    }
  );
}

/**
 * Remove todos os arquivos de replay RPA.
 *
 * @returns {Promise<{success: boolean, deletedCount: number, deletedRootCount: number, deletedSystemCount: number, message: string}>}
 */
export function deleteAllRpaReplays() {
  logger.info('Removendo todos os replays RPA');
  return fetchJson('/api/test-executions/replays', {
    method: 'DELETE',
  }).then(
    (result) => {
      logger.info('Todos os replays RPA foram removidos com sucesso', { result });
      return result;
    },
    (error) => {
      logger.error('Erro ao remover todos os replays RPA', { error });
      throw error;
    }
  );
}

/**
 * Lista as execuções RPA persistidas no banco (roteiro + trace visual + replay).
 *
 * @returns {Promise<{items: Array<{executionId: string, recordingId: string, status: string, hasRecording: boolean, hasTrace: boolean, hasReplay: boolean, screenshots: number, startedAt: string, finishedAt: string, persistedAt: string}>}>}
 */
export function listRpaExecutionArtifacts() {
  return fetchJson('/api/test-executions/artifacts', {
    method: 'GET',
  });
}

/**
 * Baixa um artefato de execução RPA persistido (roteiro, replay, trace ou
 * screenshot).
 *
 * @param {string} executionId
 * @param {'recording'|'replay'|'trace'|'screenshot'} kind
 * @param {number} [index] - índice do screenshot
 * @returns {Promise<{blob: Blob, filename: string}>}
 */
export async function downloadRpaExecutionArtifact(executionId, kind, index = null) {
  if (!executionId) {
    throw new Error('downloadRpaExecutionArtifact: executionId é obrigatório');
  }
  const suffix = kind === 'screenshot' && Number.isFinite(Number(index))
    ? `/${Number(index)}`
    : '';
  const url = `/api/test-executions/${encodeURIComponent(executionId)}/artifact/${encodeURIComponent(kind)}${suffix}`;

  const response = await fetchBlob(url, { method: 'GET' });
  const contentDisposition = response.headers.get('Content-Disposition') || '';
  const match = /filename="([^"]+)"/i.exec(contentDisposition);
  const filename = match ? match[1] : `${executionId}.${kind}.bin`;
  const blob = await response.blob();
  return { blob, filename };
}

/**
 * Remove um fluxo.
 *
 * @param {string} flowId
 * @returns {Promise<{ success: boolean, deletedId: string }>}
 */
export function deleteFlow(flowId, options = {}) {
  if (!flowId) {
    return Promise.reject(new Error('deleteFlow: flowId é obrigatório'));
  }
  logger.info('Removendo fluxo', { flowId });
  return fetchJson(`/flows/${encodeURIComponent(flowId)}`, {
    method: 'DELETE',
    ...(options && typeof options === 'object' && options.headers ? { headers: options.headers } : {}),
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
  const includeQuestions = options.includeQuestions === true;
  const payload = {
    name: options.flowName || 'Fluxo Gerado',
    description: description.trim(),
    useRag: options.useRag || false,
    ragSources: options.useRag ? (options.ragSources || []) : [],
    useWebScraping: options.useWebScraping || false,
    scrapingTargets: options.useWebScraping ? (options.scrapingTargets || []) : [],
    generateRpaTest: options.generateRpaTest || false,
    rpaMode: options.rpaMode || 'infer',
    includeQuestions,
    questions: includeQuestions ? (options.questions || []) : [],
    // Ajustes de performance/arquitetura (opcionais; validados pelo contrato no backend)
    maxFixAttempts: options.maxFixAttempts,
    subflowMax: options.subflowMax,
    // Opções legadas (mantidas para compatibilidade)
    flowId: options.flowId,
    flowName: options.flowName,
    tenantId: options.tenantId,
  };

  // Timeout configurável (default 120s)
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(30000, Math.min(600000, Number(options.timeoutMs)))
    : 120000;

  return fetchJson('/flows/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs,
  }).then(
    (result) => {
      // O endpoint /flows/generate retorna { success, flowDefinition, ... }
      const flow = result?.flowDefinition || result;
      logger.info('Fluxo gerado com sucesso', { 
        flowId: flow?.id, 
        flowName: flow?.name,
        nodeCount: flow?.nodes?.length || 0,
        ragUsed: result?.ragUsed || false,
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
 * Pré-visualiza o prompt FINAL que será enviado ao provedor (incluindo RAG),
 * sem executar a geração.
 *
 * Observação:
 * - Endpoint é restrito a Super Admin no backend (pode expor conteúdo sensível).
 *
 * @param {string} description
 * @param {Object} options
 * @returns {Promise<{success: boolean, tenantId: string, objective: string, promptSummary: string, ragMeta: any, finalPrompt: string}>}
 */
export function previewFlowGenerationPrompt(description, options = {}) {
  if (!description || typeof description !== 'string' || description.trim() === '') {
    return Promise.reject(new Error('previewFlowGenerationPrompt: description é obrigatório'));
  }

  const includeQuestions = options.includeQuestions === true;
  const payload = {
    name: options.flowName || 'Fluxo Gerado',
    description: description.trim(),
    useRag: options.useRag || false,
    ragSources: options.useRag ? (options.ragSources || []) : [],
    useWebScraping: options.useWebScraping || false,
    scrapingTargets: options.useWebScraping ? (options.scrapingTargets || []) : [],
    includeQuestions,
    questions: includeQuestions ? (options.questions || []) : [],
    // Compat/legado
    flowId: options.flowId,
    flowName: options.flowName,
    tenantId: options.tenantId,
  };

  return fetchJson('/flows/generate/prompt-preview', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 60000,
  });
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


