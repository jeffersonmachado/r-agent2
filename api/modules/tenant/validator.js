function resolvePlanUsageTenantId({ tenantIdParam, agent }) {
  const tenantId = tenantIdParam === 'current' ? agent?.tenantId : tenantIdParam;
  if (!tenantId || tenantId === 'current') {
    const error = new Error('tenantId ausente ou inválido');
    error.httpStatus = 400;
    error.code = 'bad_request';
    throw error;
  }
  return tenantId;
}

function resolveAuthenticatedTenantId(agent) {
  const tenantId = agent?.tenantId;
  if (tenantId === 'current') {
    const error = new Error('tenantId inválido: "current" não é um tenant válido. Verifique a configuração do agente.');
    error.httpStatus = 400;
    error.code = 'bad_request';
    throw error;
  }
  if (!tenantId) {
    const error = new Error('Agente não possui tenantId');
    error.httpStatus = 400;
    error.code = 'bad_request';
    throw error;
  }
  return tenantId;
}

function validateSuperAdminAccess({ isSuperAdmin, message }) {
  if (!isSuperAdmin) {
    const error = new Error(message || 'Apenas super-admins podem executar esta operação');
    error.httpStatus = 403;
    error.code = 'forbidden';
    throw error;
  }
}

function validatePlanUsageAccess({ agent, isSuperAdmin }) {
  if (!isSuperAdmin && agent?.role !== 'owner' && agent?.role !== 'admin') {
    const error = new Error('Apenas owner ou admin podem ver plano/uso');
    error.httpStatus = 403;
    error.code = 'forbidden';
    throw error;
  }
}

function validateTenantReadAccess({ tenantId, agent, isSuperAdmin }) {
  if (!isSuperAdmin && agent?.role !== 'admin' && agent?.tenantId !== tenantId) {
    const error = new Error('Você só pode ver seu próprio tenant');
    error.httpStatus = 403;
    error.code = 'forbidden';
    throw error;
  }
}

function validateTenantUsageAccess({ tenantId, agent, isSuperAdmin }) {
  if (agent?.role !== 'owner' && agent?.role !== 'admin' && !isSuperAdmin) {
    const error = new Error('Apenas owner ou admin podem ver métricas');
    error.httpStatus = 403;
    error.code = 'forbidden';
    throw error;
  }

  if (!isSuperAdmin && agent?.role === 'owner' && agent?.tenantId !== tenantId) {
    const error = new Error('Você só pode ver métricas do seu próprio tenant');
    error.httpStatus = 403;
    error.code = 'forbidden';
    throw error;
  }
}

function validateOwnerOrAdminAccess({ agent, message }) {
  if (agent?.role !== 'owner' && agent?.role !== 'admin') {
    const error = new Error(message || 'Apenas owner ou admin podem executar esta operação');
    error.httpStatus = 403;
    error.code = 'forbidden';
    throw error;
  }
}

function validateOwnerScope({ tenantId, agent, message }) {
  if (agent?.role === 'owner' && agent?.tenantId !== tenantId) {
    const error = new Error(message || 'Você só pode executar esta operação no seu próprio tenant');
    error.httpStatus = 403;
    error.code = 'forbidden';
    throw error;
  }
}

module.exports = {
  resolvePlanUsageTenantId,
  resolveAuthenticatedTenantId,
  validateSuperAdminAccess,
  validatePlanUsageAccess,
  validateTenantReadAccess,
  validateTenantUsageAccess,
  validateOwnerOrAdminAccess,
  validateOwnerScope,
};
