import { fetchJson } from './client';
import logger from '../utils/logger';

/**
 * Verifica se o tenant tem um provider de IA válido configurado.
 * 
 * @param {string} tenantId - ID do tenant
 * @returns {Promise<{hasValidProvider: boolean, tenantId: string}>}
 */
export async function checkTenantAiProviderStatus(tenantId) {
  try {
    if (!tenantId) {
      throw new Error('tenantId é obrigatório');
    }

    return await fetchJson(`/tenants/${encodeURIComponent(tenantId)}/ai-provider-status`, {
      method: 'GET',
    });
  } catch (error) {
    logger.error('Erro ao verificar status de provider de IA do tenant', error);
    throw error;
  }
}
