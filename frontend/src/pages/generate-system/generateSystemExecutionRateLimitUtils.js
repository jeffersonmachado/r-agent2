/**
 * @typedef {'BOOTSTRAP'|'DRY_RUN'|'GENERATION_REAL'} ExecutionOperationType
 */

/** @typedef {{role?: string, tenantId?: string}} AgentLike */

/** @typedef {{allowed: boolean, retryAfter?: number, remainingPoints?: number, totalPoints?: number, isSuperAdmin?: boolean, informativeOnly?: boolean}} RateLimitCheckResult */

/** @typedef {{err: *, agent: AgentLike, bootstrap: boolean, executionMode: string, setRateLimitUntil: (until: number|null) => void, setRateLimitSecondsRemaining: (remaining: number) => void, setError: (message: string) => void, setExecuting: (executing: boolean) => void, logger: {warn: Function}}} HandleExecutionRateLimitErrorParams */

/** @typedef {{rateLimitUntil: number|null, bootstrap: boolean, executionMode: string, agent: AgentLike, setRateLimitUntil: (until: number|null) => void, setRateLimitSecondsRemaining: (remaining: number) => void, setError: (message: string) => void, setExecuting: (executing: boolean) => void, logger: {warn: Function}}} EnforceLocalRateLimitParams */

/** @typedef {{checkRateLimit: (payload: Record<string, unknown>) => Promise<RateLimitCheckResult>, payload: Record<string, unknown>, agent: AgentLike, bootstrap: boolean, executionMode: string, setRateLimitUntil: (until: number|null) => void, setRateLimitSecondsRemaining: (remaining: number) => void, setError: (message: string) => void, setExecuting: (executing: boolean) => void, logger: {debug: Function, warn: Function}}} VerifyServerRateLimitParams */

/** @typedef {{err: *, pipelineDetails: {aiExecuted?: {status?: string}}, updatePipelineWithDetails: (details: Record<string, unknown>, sourceTag: string) => void, setError: (message: string) => void}} HandleGenericExecutionFailureParams */

/**
 * @param {{bootstrap: boolean, executionMode: string}} params
 * @returns {ExecutionOperationType}
 */
export function getExecutionOperationType({ bootstrap, executionMode }) {
  return bootstrap ? 'BOOTSTRAP' : (executionMode === 'dry-run' ? 'DRY_RUN' : 'GENERATION_REAL');
}

/**
 * @param {{agent: AgentLike, extraFlags?: boolean[]}} params
 * @returns {boolean}
 */
export function isSuperAdminExecution({ agent, extraFlags = [] }) {
  const byRole = agent?.role === 'super_admin' || (agent?.tenantId === 'system' && agent?.role === 'admin');
  const byExtra = extraFlags.some((flag) => Boolean(flag));
  return byRole || byExtra;
}

function getModeText(operationType) {
  if (operationType === 'BOOTSTRAP') return 'Modo Bootstrap: 1 execução a cada 5 minutos';
  if (operationType === 'GENERATION_REAL') return 'Modo Real: 5 execuções por minuto';
  return 'Modo Dry-Run: 50 execuções por minuto';
}

/**
 * @param {{operationType: ExecutionOperationType, retryAfter: number, duringExecution?: boolean}} params
 * @returns {string}
 */
export function buildSuperAdminRateLimitMessage({ operationType, retryAfter, duringExecution = false }) {
  let message = duringExecution
    ? 'ℹ️ Limite de execuções atingido durante execução (apenas informativo para super-admin)'
    : 'ℹ️ Limite de execuções atingido (apenas informativo para super-admin)';
  message += `\n\n${getModeText(operationType)}`;
  message += duringExecution
    ? `\nNormalmente seria necessário aguardar ${retryAfter} segundos, mas como super-admin a execução continua.`
    : `\nNormalmente seria necessário aguardar ${retryAfter} segundos, mas como super-admin você pode continuar.`;
  return message;
}

/**
 * @param {{operationType: ExecutionOperationType, retryAfter: number, duringExecution?: boolean}} params
 * @returns {string}
 */
export function buildRegularRateLimitMessage({ operationType, retryAfter, duringExecution = false }) {
  if (duringExecution) {
    let message = '⏱️ Limite de execuções atingido';
    if (operationType === 'BOOTSTRAP') {
      const minutes = Math.ceil(retryAfter / 60);
      message += `\n\n${getModeText(operationType)}\nTente novamente em ${retryAfter} segundos (${minutes} minuto${minutes !== 1 ? 's' : ''})`;
      return message;
    }
    message += `\n\n${getModeText(operationType)}\nTente novamente em ${retryAfter} segundos`;
    return message;
  }

  let message = 'Limite de execuções atingido';
  if (operationType === 'BOOTSTRAP') {
    message += ' (modo Bootstrap: 1 execução a cada 5 minutos)';
  } else if (operationType === 'GENERATION_REAL') {
    message += ' (modo Real: 5 execuções por minuto)';
  }
  message += `. Tente novamente em ${retryAfter} segundos.`;
  return message;
}

/**
 * @param {HandleExecutionRateLimitErrorParams} params
 * @param {*} params.err
 * @param {AgentLike} params.agent
 * @param {boolean} params.bootstrap
 * @param {string} params.executionMode
 * @param {(until: number|null) => void} params.setRateLimitUntil
 * @param {(remaining: number) => void} params.setRateLimitSecondsRemaining
 * @param {(message: string) => void} params.setError
 * @param {(executing: boolean) => void} params.setExecuting
 * @param {{warn: Function}} params.logger
 * @returns {{handled: boolean, blocked: boolean}}
 */
export function handleExecutionRateLimitError({
  err,
  agent,
  bootstrap,
  executionMode,
  setRateLimitUntil,
  setRateLimitSecondsRemaining,
  setError,
  setExecuting,
  logger,
}) {
  const isRateLimitError = err?.status === 429 || (err?.body && err.body.error === 'rate_limit_exceeded');
  if (!isRateLimitError) {
    return { handled: false, blocked: false };
  }

  const retryAfter = err?.body?.retryAfter || err?.retryAfter || 60;
  const isSuperAdminUser = isSuperAdminExecution({
    agent,
    extraFlags: [err?.isSuperAdmin, err?.body && err.body.isSuperAdmin],
  });
  const operationType = getExecutionOperationType({ bootstrap, executionMode });

  if (isSuperAdminUser) {
    logger.warn('[Execute] Rate limit excedido durante execução (super-admin - apenas informativo)', {
      operationType,
      retryAfter,
      bootstrap,
      executionMode,
      severity: 'LOW',
      alert: 'RATE_LIMIT_EXCEEDED_DURING_EXECUTION_SUPER_ADMIN',
    });
    return { handled: true, blocked: false };
  }

  const until = Date.now() + (retryAfter * 1000);
  setRateLimitUntil(until);
  setRateLimitSecondsRemaining(retryAfter);

  const message = buildRegularRateLimitMessage({
    operationType,
    retryAfter,
    duringExecution: true,
  });

  logger.warn('[Execute] Rate limit excedido durante execução', {
    operationType,
    retryAfter,
    bootstrap,
    executionMode,
    severity: 'MEDIUM',
    alert: 'RATE_LIMIT_EXCEEDED_DURING_EXECUTION',
  });

  setError(message);
  setExecuting(false);
  return { handled: true, blocked: true };
}

/**
 * @param {EnforceLocalRateLimitParams} params
 * @param {number|null} params.rateLimitUntil
 * @param {boolean} params.bootstrap
 * @param {string} params.executionMode
 * @param {AgentLike} params.agent
 * @param {(until: number|null) => void} params.setRateLimitUntil
 * @param {(remaining: number) => void} params.setRateLimitSecondsRemaining
 * @param {(message: string) => void} params.setError
 * @param {(executing: boolean) => void} params.setExecuting
 * @param {{warn: Function}} params.logger
 * @returns {boolean}
 */
export function enforceLocalRateLimitBeforeExecution({
  rateLimitUntil,
  bootstrap,
  executionMode,
  agent,
  setRateLimitUntil,
  setRateLimitSecondsRemaining,
  setError,
  setExecuting,
  logger,
}) {
  if (!rateLimitUntil || rateLimitUntil <= Date.now()) {
    return true;
  }

  const remaining = Math.ceil((rateLimitUntil - Date.now()) / 1000);
  const operationType = getExecutionOperationType({ bootstrap, executionMode });
  const isSuperAdminUser = isSuperAdminExecution({ agent });

  if (isSuperAdminUser) {
    logger.warn('[Execute] Rate limit local excedido (super-admin - apenas informativo)', {
      remaining,
      operationType,
    });
    setRateLimitUntil(null);
    setRateLimitSecondsRemaining(0);
    return true;
  }

  const message = buildRegularRateLimitMessage({
    operationType,
    retryAfter: remaining,
  });

  setError(message);
  setExecuting(false);
  return false;
}

/**
 * @param {VerifyServerRateLimitParams} params
 * @param {(payload: Record<string, unknown>) => Promise<RateLimitCheckResult>} params.checkRateLimit
 * @param {Record<string, unknown>} params.payload
 * @param {AgentLike} params.agent
 * @param {boolean} params.bootstrap
 * @param {string} params.executionMode
 * @param {(until: number|null) => void} params.setRateLimitUntil
 * @param {(remaining: number) => void} params.setRateLimitSecondsRemaining
 * @param {(message: string) => void} params.setError
 * @param {(executing: boolean) => void} params.setExecuting
 * @param {{debug: Function, warn: Function}} params.logger
 * @returns {Promise<boolean>}
 */
export async function verifyServerRateLimitBeforeExecution({
  checkRateLimit,
  payload,
  agent,
  bootstrap,
  executionMode,
  setRateLimitUntil,
  setRateLimitSecondsRemaining,
  setError,
  setExecuting,
  logger,
}) {
  try {
    logger.debug('[Execute] Verificando rate limit no servidor antes de executar');
    const rateLimitCheck = await checkRateLimit(payload);
    const isSuperAdminUser = isSuperAdminExecution({
      agent,
      extraFlags: [rateLimitCheck?.isSuperAdmin, rateLimitCheck?.informativeOnly],
    });

    if (!rateLimitCheck.allowed) {
      const retryAfter = rateLimitCheck.retryAfter || 60;
      const operationType = getExecutionOperationType({ bootstrap, executionMode });

      if (isSuperAdminUser) {
        logger.warn('[Execute] Rate limit excedido (super-admin - apenas informativo)', {
          retryAfter,
          remainingPoints: rateLimitCheck.remainingPoints,
          totalPoints: rateLimitCheck.totalPoints,
          operationType,
        });
      } else {
        const until = Date.now() + (retryAfter * 1000);
        setRateLimitUntil(until);
        setRateLimitSecondsRemaining(retryAfter);

        const message = buildRegularRateLimitMessage({
          operationType,
          retryAfter,
        });

        setError(message);
        setExecuting(false);
        logger.warn('[Execute] Rate limit verificado no servidor: bloqueado', {
          retryAfter,
          remainingPoints: rateLimitCheck.remainingPoints,
          totalPoints: rateLimitCheck.totalPoints,
        });
        return false;
      }
    }

    logger.debug('[Execute] Rate limit verificado no servidor: permitido', {
      remainingPoints: rateLimitCheck.remainingPoints,
      totalPoints: rateLimitCheck.totalPoints,
      isSuperAdmin: isSuperAdminUser,
    });
    return true;
  } catch (rateLimitError) {
    logger.warn('[Execute] Erro ao verificar rate limit no servidor, continuando execução', {
      error: rateLimitError.message,
    });
    return true;
  }
}

/**
 * @param {*} err
 * @returns {string}
 */
export function inferPipelineErrorStepKey(err) {
  let inferredStepKey = 'aiExecuted';

  try {
    const details = err?.details ?? err?.body?.error?.details ?? null;
    const code = err?.code || err?.body?.error?.code || null;
    if (code === 'PIPELINE_ABORTED' && details) {
      const rpa = details?.rpa || null;
      if (rpa?.executed) inferredStepKey = 'rpaExecuted';
      else if (rpa?.generated) inferredStepKey = 'rpaGenerated';
      else if (details?.contextBuilt === false) inferredStepKey = 'contextBuilt';
      else if (details?.contractValid === false) inferredStepKey = 'contractValid';
    }
  } catch {
    // best-effort
  }

  return inferredStepKey;
}

/**
 * @param {HandleGenericExecutionFailureParams} params
 * @param {*} params.err
 * @param {{aiExecuted?: {status?: string}}} params.pipelineDetails
 * @param {(details: Object, sourceTag: string) => void} params.updatePipelineWithDetails
 * @param {(message: string) => void} params.setError
 * @returns {void}
 */
export function handleGenericExecutionFailure({
  err,
  pipelineDetails,
  updatePipelineWithDetails,
  setError,
}) {
  const currentAiStatus = pipelineDetails?.aiExecuted?.status;
  if (currentAiStatus === 'in_progress' || currentAiStatus === 'pending') {
    updatePipelineWithDetails({
      aiExecuted: {
        status: 'error',
        progress: 0,
        message: 'Erro na execução da IA',
        timestamp: new Date().toISOString(),
      },
    }, 'execute-error');
  }

  if (err?.connectionRefused || err?.status === 0 || err?.message === 'Failed to fetch') {
    const errorMessage = 'Servidor não está respondendo. Verifique se o servidor está rodando e tente novamente.';
    setError(errorMessage);
    updatePipelineWithDetails({
      aiExecuted: {
        status: 'error',
        progress: 0,
        message: 'Servidor não está disponível',
        timestamp: new Date().toISOString(),
      },
    }, 'server-unavailable');
    return;
  }

  if (err?.code) {
    const inferredStepKey = inferPipelineErrorStepKey(err);
    const message = err?.body?.message || err?.message || 'Erro na execução do pipeline';
    updatePipelineWithDetails({
      [inferredStepKey]: {
        status: 'error',
        progress: 0,
        message,
        timestamp: new Date().toISOString(),
      },
    }, 'execute-error');
    setError(message);
    return;
  }

  setError(err?.message || 'Erro desconhecido');
}