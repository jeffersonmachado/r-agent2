'use strict';

/**
 * Middleware de classificação de experiência (PRODUCTION / SUPPORT / DEVELOPMENT).
 *
 * Consome a fonte única da política em
 * `api/modules/agent-os/experience-segregation.js`:
 *   super_admin → DEVELOPMENT; auditor → SUPPORT; demais → PRODUCTION.
 * Hierarquia: DEVELOPMENT > SUPPORT > PRODUCTION.
 *
 * Uso (Express):
 *   router.get('/rota', requireClassification('DEVELOPMENT'), handler);
 *
 * Uso em rotas que respondem via deps.sendJson (auth chamado dentro do handler):
 *   const check = checkClassification(req, 'DEVELOPMENT');
 *   if (!check.allowed) {
 *     deps.sendJson(res, 403, { error: 'classification_required', required: check.required, classification: check.classification });
 *     return;
 *   }
 */

const logger = require('../utils/logger');
const {
  CLASSIFICATIONS,
  getClassificationForAgent,
  classificationMeets,
} = require('../modules/agent-os/experience-segregation');

/**
 * Avalia a classificação do ator do request contra o mínimo exigido.
 * Negações são auditadas via logger.warn (sem tokens nem payloads sensíveis).
 *
 * @param {Object} req - Request (espera req.agent populado pelo requireAuth)
 * @param {string} min - Classificação mínima ('PRODUCTION' | 'SUPPORT' | 'DEVELOPMENT')
 * @returns {{allowed: boolean, required: string, classification: string}}
 */
function checkClassification(req, min) {
  const required = String(min || '').toUpperCase();
  const classification = getClassificationForAgent(req?.agent);
  const allowed = classificationMeets(classification, required);

  if (!allowed) {
    logger.warn('[security] classification_required', {
      required,
      classification,
      role: req?.agent?.role || null,
      method: req?.method || null,
      path: req?.originalUrl || req?.url || null,
    });
  }

  return { allowed, required, classification };
}

/**
 * Middleware Express que exige classificação mínima do ator.
 * Responde 403 { error: 'classification_required', required, classification }.
 *
 * @param {string} min - Classificação mínima exigida
 */
function requireClassification(min) {
  const required = String(min || '').toUpperCase();

  return (req, res, next) => {
    const check = checkClassification(req, required);
    if (!check.allowed) {
      res.status(403).json({
        error: 'classification_required',
        required: check.required,
        classification: check.classification,
      });
      return;
    }
    if (typeof next === 'function') next();
  };
}

module.exports = {
  requireClassification,
  checkClassification,
  getClassificationForAgent,
  CLASSIFICATIONS,
};
