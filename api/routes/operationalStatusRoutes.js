'use strict';

const express = require('express');
const { OperationalGateService } = require('../services/qa');

/**
 * Endpoint para status operacional do QA Mesh Gate
 */
function createOperationalStatusRoutes() {
  const router = express.Router();
  let gateService = new OperationalGateService();
  let lastGovernance = null;

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
