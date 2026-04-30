'use strict';

const { OperationalGateService } = require('../services/qa');

let gateService;
let lastGovernance = null;
let gateCache = null;
let gateCacheExpiry = 0;

/**
 * Middleware de Gate Operacional
 *
 * Intercepta operações críticas e decide se são permitidas baseado
 * na última decisão de governance do QA Mesh.
 */
function operationalGateMiddleware(deps = {}) {
  const { logger = console, governanceSource = null } = deps;

  if (!gateService) {
    gateService = new OperationalGateService({ logger });
  }

  /**
   * Obtém a governança mais recente (cache por 10 segundos).
   */
  async function getLatestGovernance() {
    const now = Date.now();
    if (gateCache && now < gateCacheExpiry) {
      return gateCache;
    }

    // Tentar obter de governanceSource se fornecido (ex: DB, Redis)
    if (governanceSource && typeof governanceSource.getLatest === 'function') {
      try {
        lastGovernance = await governanceSource.getLatest();
      } catch (error) {
        logger.warn('[Gate] Erro ao obter governança mais recente:', error.message);
      }
    }

    gateCache = lastGovernance;
    gateCacheExpiry = now + 10000; // 10 segundos

    return gateCache;
  }

  /**
   * Avalia se operação é permitida.
   */
  async function evaluateOperation(operationType, context = {}) {
    const governance = await getLatestGovernance();
    if (!governance) {
      // Fallback: modo MONITORING se sem governance
      governance = {
        decision: 'GO_WITH_WARNINGS',
        reason: 'No governance available; defaulting to monitoring mode',
        severity: 'medium',
        failedChecks: [],
      };
      lastGovernance = governance;
    }

    const gateResponse = gateService.evaluateOperationalGate(governance);
    const operationCheck = gateService.isOperationAllowed(operationType, gateResponse);

    return {
      allowed: operationCheck.allowed,
      blocked: operationCheck.blocked,
      mode: gateResponse.mode,
      decision: gateResponse.decision,
      reason: operationCheck.reason,
      gateResponse,
    };
  }

  /**
   * Express middleware para proteger rotas críticas.
   */
  function protectCriticalOperation(operationType) {
    return async (req, res, next) => {
      try {
        const evaluation = await evaluateOperation(operationType, req);

        if (!evaluation.allowed) {
          logger.warn(`[Gate] Blocked operation '${operationType}' in mode ${evaluation.mode}`, {
            decision: evaluation.decision,
            reason: evaluation.reason,
          });

          return res.status(423).json({
            error: 'Operation blocked by operational gate',
            mode: evaluation.mode,
            reason: evaluation.reason,
            decision: evaluation.decision,
          });
        }

        // Adicionar informações de gate ao request para logs posteriores
        req.operationalGate = {
          mode: evaluation.mode,
          decision: evaluation.decision,
          allowed: true,
        };

        // Se modo MONITORING, adicionar log extra
        if (evaluation.mode === 'MONITORING') {
          req.operationalGate.extraLogging = true;
        }

        next();
      } catch (error) {
        logger.error('[Gate] Erro ao avaliar operação:', error);
        // Fallback seguro: usar MONITORING
        req.operationalGate = { mode: 'MONITORING', decision: 'UNKNOWN', allowed: true };
        next();
      }
    };
  }

  /**
   * Retorna status operacional atual.
   */
  async function getCurrentStatus() {
    const governance = await getLatestGovernance();
    const gateResponse = gateService.evaluateOperationalGate(governance);

    return {
      mode: gateResponse.mode,
      allowed: gateResponse.allowed,
      decision: gateResponse.decision,
      reason: gateResponse.reason,
      severity: gateResponse.severity,
      failedChecks: gateResponse.failedChecks,
      statusMessage: gateService.getStatusMessage(gateResponse),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Atualiza governança (chamado após QA Mesh executar).
   */
  function updateGovernance(governance) {
    lastGovernance = governance;
    gateCache = null;
    gateCacheExpiry = 0;
    logger.log('[Gate] Governança atualizada:', governance.decision);
  }

  return {
    evaluateOperation,
    protectCriticalOperation,
    getCurrentStatus,
    updateGovernance,
    getLatestGovernance,
  };
}

module.exports = operationalGateMiddleware;
