import { fetchJson } from './client';
import logger from '../utils/logger';

/**
 * Funções para gerenciar configuração do sistema.
 */

/**
 * Obtém a configuração atual do sistema.
 *
 * @returns {Promise<Object>} Configuração completa
 */
export async function getConfig() {
  try {
    return await fetchJson('/config', {
      method: 'GET',
    });
  } catch (error) {
    logger.error('Erro ao carregar configuração', error);
    throw error;
  }
}

/**
 * Atualiza a configuração do sistema.
 *
 * @param {Object} configData - Objeto com a configuração completa
 * @returns {Promise<{success: boolean, message?: string}>}
 */
export async function updateConfig(configData) {
  try {
    if (!configData || typeof configData !== 'object' || Array.isArray(configData)) {
      throw new Error('Configuração deve ser um objeto válido');
    }

    return await fetchJson('/config', {
      method: 'PUT',
      body: JSON.stringify(configData),
    });
  } catch (error) {
    logger.error('Erro ao atualizar configuração', error);
    throw error;
  }
}

/**
 * Recarrega a configuração do servidor (útil após edições manuais).
 *
 * @returns {Promise<Object>} Nova configuração carregada
 */
export async function reloadConfig() {
  try {
    // Primeiro atualiza (isso força reload no servidor)
    const current = await getConfig();
    await updateConfig(current);
    // Depois lê novamente
    return await getConfig();
  } catch (error) {
    logger.error('Erro ao recarregar configuração', error);
    throw error;
  }
}

/**
 * Reinicia o servidor da API.
 * 
 * ⚠️ ATENÇÃO: Isso encerrará o processo do servidor.
 * Se estiver usando PM2, nodemon ou similar, o servidor será reiniciado automaticamente.
 * 
 * @returns {Promise<{success: boolean, message: string, processManager?: string, hasProcessManager?: boolean, note?: string}>}
 */
export async function restartServer() {
  try {
    return await fetchJson('/server/restart', {
      method: 'POST',
    });
  } catch (error) {
    // O erro é esperado pois o servidor será encerrado
    logger.info('Servidor sendo reiniciado...', error);
    return { 
      success: true, 
      message: 'Servidor sendo reiniciado...',
      hasProcessManager: false,
      processManager: 'unknown'
    };
  }
}

/**
 * Verifica qual gerenciador de processo está sendo usado.
 * 
 * @returns {Promise<{success: boolean, processManager: string, hasProcessManager: boolean, details?: object}>}
 */
export async function getProcessManager() {
  try {
    return await fetchJson('/server/process-manager', {
      method: 'GET',
    });
  } catch (error) {
    logger.error('Erro ao verificar gerenciador de processo', error);
    return {
      success: false,
      processManager: 'unknown',
      hasProcessManager: false,
    };
  }
}

