/**
 * Classificação de plataforma (PRODUCTION / SUPPORT / DEVELOPMENT) — espelho
 * da política do backend (api/modules/agent-os/experience-segregation.js).
 *
 * tenantRole e platformClassification são eixos INDEPENDENTES: um role de
 * negócio do tenant (ex.: auditor) NÃO concede acesso a plataforma.
 * Precedência:
 *   1. agent.classification válido (setado server-side no payload de auth);
 *   2. agent.platformRole (concedido server-side);
 *   3. fallback legado: role 'super_admin' → DEVELOPMENT;
 *   4. caso contrário → PRODUCTION.
 */

export const CLASSIFICATIONS = { PRODUCTION: 'PRODUCTION', SUPPORT: 'SUPPORT', DEVELOPMENT: 'DEVELOPMENT' };

const PLATFORM_ROLE_CLASSIFICATION = {
  support_n1: 'SUPPORT',
  support_n2: 'SUPPORT',
  support_n3: 'SUPPORT',
  customer_success: 'SUPPORT',
  platform_support: 'SUPPORT',
  engineer: 'DEVELOPMENT',
  qa_engineer: 'DEVELOPMENT',
  devops: 'DEVELOPMENT',
  platform_engineer: 'DEVELOPMENT',
  developer: 'DEVELOPMENT',
};

export function getAgentClassification(agent) {
  const explicit = String((agent && agent.classification) || '').trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(CLASSIFICATIONS, explicit)) {
    return CLASSIFICATIONS[explicit];
  }
  const platformRole = String((agent && agent.platformRole) || '').trim().toLowerCase();
  if (platformRole && PLATFORM_ROLE_CLASSIFICATION[platformRole]) {
    return PLATFORM_ROLE_CLASSIFICATION[platformRole];
  }
  const role = String((agent && agent.role) || '').trim().toLowerCase();
  if (role === 'super_admin') return 'DEVELOPMENT';
  return 'PRODUCTION';
}

export function isPlatformInternal(agent) {
  return getAgentClassification(agent) !== 'PRODUCTION';
}
