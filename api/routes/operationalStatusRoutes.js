'use strict';

const express = require('express');
const { OperationalGateService } = require('../services/qa');
const { requireAuth: defaultRequireAuth } = require('../middleware/auth');
const { checkClassification: defaultCheckClassification } = require('../middleware/requireClassification');

/**
 * Endpoint para status operacional do QA Mesh Gate.
 *
 * Superfície de engenharia (DEVELOPMENT): exige autenticação + classificação
 * DEVELOPMENT em todos os endpoints. Antes desta correção o router era
 * montado sem auth, expondo estado interno de governança e permitindo
 * injeção de governança via POST update-governance sem qualquer credencial.
 *
 * @param {{ requireAuth?: Function, checkClassification?: Function }} [deps]
 *   Dependências injetáveis para testes; por padrão usa os middlewares reais.
 */
function createOperationalStatusRoutes({ requireAuth, checkClassification } = {}) {
  const auth = typeof requireAuth === 'function' ? requireAuth : defaultRequireAuth;
  const classify = typeof checkClassification === 'function' ? checkClassification : defaultCheckClassification;
  const router = express.Router();
  let gateService = new OperationalGateService();
  let lastGovernance = null;

  router.use((req, res, next) => {
    const authResult = auth(req);
    if (!authResult.valid) {
      return res.status(401).json({ error: 'unauthorized', message: authResult.error });
    }
    const check = classify(req, 'DEVELOPMENT');
    if (!check.allowed) {
      return res.status(403).json({
        error: 'classification_required',
        required: check.required,
        classification: check.classification,
      });
    }
    return next();
  });

  /**
   * GET /qa/operational-status
   *
   * Retorna status operacional atual do sistema baseado no QA Mesh.
   */
  router.get('/operational-status', async (req, res) => {
    try {
      if (!lastGovernance) {
        return res.status(200).json({
          mode: 'MONITORING',
          allowed: true,
          decision: 'UNKNOWN',
          reason: 'No governance available; operating in monitoring mode',
          lastWave: null,
          timestamp: new Date().toISOString(),
        });
      }

      const gateResponse = gateService.evaluateOperationalGate(lastGovernance);

      return res.status(200).json({
        mode: gateResponse.mode,
        allowed: gateResponse.allowed,
        decision: gateResponse.decision,
        reason: gateResponse.reason,
        severity: gateResponse.severity,
        failedChecks: gateResponse.failedChecks,
        actions: gateResponse.actions,
        statusMessage: gateService.getStatusMessage(gateResponse),
        lastWave: lastGovernance.wave || null,
        timestamp: gateResponse.timestamp,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to evaluate operational status', message: error.message });
    }
  });

  /**
   * POST /qa/operational-status/update-governance
   *
   * Atualiza governance (chamado após QA Mesh executar uma wave).
   * Internal use only.
   */
  router.post('/operational-status/update-governance', (req, res) => {
    try {
      const { governance, wave } = req.body;

      if (!governance || !governance.decision) {
        return res.status(400).json({ error: 'Governance with decision required' });
      }

      lastGovernance = { ...governance, wave };

      const gateResponse = gateService.evaluateOperationalGate(lastGovernance);

      return res.status(200).json({
        updated: true,
        mode: gateResponse.mode,
        decision: gateResponse.decision,
        statusMessage: gateService.getStatusMessage(gateResponse),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update governance', message: error.message });
    }
  });

  /**
   * POST /qa/operational-status/check-operation
   *
   * Verifica se operação específica é permitida.
   */
  router.post('/operational-status/check-operation', (req, res) => {
    try {
      const { operationType } = req.body;

      if (!operationType) {
        return res.status(400).json({ error: 'operationType required' });
      }

      const gateResponse = gateService.evaluateOperationalGate(lastGovernance);
      const check = gateService.isOperationAllowed(operationType, gateResponse);

      return res.status(200).json({
        operationType,
        allowed: check.allowed,
        blocked: check.blocked,
        mode: check.mode,
        reason: check.reason,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to check operation', message: error.message });
    }
  });

  /**
   * Setter para injetar dependências externas (para testes).
   */
  router.setGateService = function (service) {
    gateService = service;
  };

  router.setLastGovernance = function (governance) {
    lastGovernance = governance;
  };

  return router;
}

module.exports = createOperationalStatusRoutes;
