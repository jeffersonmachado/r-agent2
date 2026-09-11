'use strict';

/**
 * Política de acesso às superfícies técnicas de replay do Learning Core.
 *
 * Contexto (auditoria 2026-09-11): `GET /api/learning/replays`,
 * `POST /api/learning/training/from-replay` e
 * `POST /api/learning/manuals/from-replay` exigiam apenas papel de tenant
 * (owner/admin/super_admin). Um admin OPERACIONAL PRODUCTION (owner/admin de
 * tenant, sem `platformRole`) era autoridade suficiente para listar replays
 * técnicos e derivar conteúdo deles. O frontend escondia o menu, mas a API
 * aceitava a chamada direta — frontend não é enforcement.
 *
 * Regra canônica (AGENTS.md): a classificação de experiência é independente do
 * papel de tenant e é resolvida server-side por `platformClassification` /
 * `platformRole`. Estas superfícies são técnicas (evidência de execução de
 * replay), portanto exigem classificação SUPPORT+ — nunca PRODUCTION.
 *
 *   - owner/admin de tenant            → PRODUCTION → negado
 *   - auditor de tenant                → PRODUCTION → negado
 *   - platformRole support_n1..n3      → SUPPORT    → permitido
 *   - platformRole engineer/qa/devops  → DEVELOPMENT→ permitido
 *   - super_admin (flag de plataforma) → DEVELOPMENT→ permitido
 */

const { checkClassification } = require('../../middleware/requireClassification');

// Consumo de replay técnico (listar/ler) e derivação sanitizada (manual,
// treinamento) exigem o mesmo piso: SUPPORT.
const REPLAY_SURFACE_MIN_CLASSIFICATION = 'SUPPORT';

/**
 * Avalia o acesso a uma superfície de replay.
 *
 * @param {Object} req - Request com `req.agent` populado pelo requireAuth
 * @param {{minClassification?: string}} [options]
 * @returns {{allowed: boolean, status?: number, body?: Object}}
 */
function authorizeReplaySurface(req, { minClassification = REPLAY_SURFACE_MIN_CLASSIFICATION } = {}) {
  const check = checkClassification(req, minClassification);
  if (!check.allowed) {
    return {
      allowed: false,
      status: 403,
      body: {
        error: 'classification_required',
        required: check.required,
        classification: check.classification,
      },
    };
  }
  return { allowed: true };
}

module.exports = {
  REPLAY_SURFACE_MIN_CLASSIFICATION,
  authorizeReplaySurface,
};
