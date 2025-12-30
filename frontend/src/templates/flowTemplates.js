/**
 * Modelos de fluxo pré-definidos para facilitar a criação de novos fluxos
 * 
 * IMPORTANTE:
 * - Os templates são carregados de arquivos JSON em /public/templates/
 * - Os templates devem seguir a estrutura do schema centralizado (nodeSchemas.js)
 * - Router rules devem usar: { op: 'equals'|'contains'|'always', var: 'variable_name', value: 'value' }
 * - Use condition: { op: 'always' } para fallback em routers
 * - Todos os nós devem ter IDs únicos dentro do template
 */

import logger from '../utils/logger';
import { fetchJson } from '../api/client';

// Cache de templates carregados
let templatesCache = null;
let loadPromise = null;

/**
 * Carrega todos os templates dos arquivos JSON
 * Descobre automaticamente quais templates existem no diretório
 * @returns {Promise<Array>} Array de templates
 */
async function loadTemplates() {
  // Retorna cache se já foi carregado
  if (templatesCache) {
    return templatesCache;
  }

  // Se já há uma promise de carregamento em andamento, retorna ela
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    try {
      // Primeiro, obtém a lista de templates disponíveis do backend
      const templateList = await fetchJson('/templates', {
        method: 'GET',
      });

      logger.debug('Lista de templates obtida do backend', { count: templateList.length });

      // Agora carrega cada template completo do backend
      const templates = [];

      for (const templateInfo of templateList) {
        try {
          // Busca o template completo via API do backend
          const template = await fetchJson(`/templates/${encodeURIComponent(templateInfo.id)}`, {
            method: 'GET',
          });
          
          if (template && template.id && template.name && template.flow) {
            templates.push(template);
            logger.debug('Template carregado', { templateId: template.id, name: template.name });
          } else {
            logger.warn(`Template ${templateInfo.id} retornado sem estrutura válida, pulando...`);
          }
        } catch (err) {
          // Se o erro for 404, apenas loga como warning (template pode ter sido removido)
          if (err && typeof err === 'object' && 'status' in err && err.status === 404) {
            logger.warn(`Template ${templateInfo.id} não encontrado no backend, pulando...`);
          } else {
            logger.error(`Erro ao carregar template ${templateInfo.id}:`, err);
          }
        }
      }

      templatesCache = templates;
      logger.info('Templates carregados', { count: templates.length });
      return templates;
    } catch (err) {
      logger.error('Erro ao carregar lista de templates:', err);
      // Fallback: retorna array vazio em caso de erro
      return [];
    }
  })();

  return loadPromise;
}

/**
 * Limpa o cache de templates, forçando recarregamento na próxima chamada
 */
export function clearTemplatesCache() {
  templatesCache = null;
  loadPromise = null;
  logger.debug('Cache de templates limpo');
}

/**
 * Obtém todos os templates disponíveis
 * @returns {Promise<Array>} Array de templates
 */
export async function getFlowTemplates() {
  return await loadTemplates();
}

/**
 * Obtém um template específico por ID
 * @param {string} templateId
 * @returns {Promise<Object|null>} Template ou null se não encontrado
 */
export async function getFlowTemplate(templateId) {
  const templates = await getFlowTemplates();
  return templates.find(t => t.id === templateId) || null;
}

/**
 * Gera um ID único para um novo fluxo baseado em template
 */
export function generateFlowId(templateId, baseName) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 6);
  return `${templateId}-${timestamp}-${random}`;
}

/**
 * Cria um novo fluxo a partir de um template
 */
export function createFlowFromTemplate(template, customId = null, customName = null) {
  const flowId = customId || generateFlowId(template.id, template.name);
  const flowName = customName || `${template.name} (cópia)`;

  return {
    ...template.flow,
    id: flowId,
    name: flowName,
    metadata: {
      ...template.flow.metadata,
      createdFromTemplate: template.id,
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * Remove um template
 * @param {string} templateId - ID do template a ser removido
 * @returns {Promise<{success: boolean, deletedId: string, message: string}>}
 */
export async function deleteTemplate(templateId) {
  if (!templateId || typeof templateId !== 'string' || templateId.trim() === '') {
    return Promise.reject(new Error('deleteTemplate: templateId é obrigatório'));
  }

  logger.info('Removendo template', { templateId });

  try {
    const result = await fetchJson(`/templates/${encodeURIComponent(templateId)}`, {
      method: 'DELETE',
    });

    // Limpa o cache após remover
    clearTemplatesCache();

    logger.info('Template removido com sucesso', { templateId, result });
    return result;
  } catch (error) {
    logger.error('Erro ao remover template', { templateId, error });
    throw error;
  }
}
