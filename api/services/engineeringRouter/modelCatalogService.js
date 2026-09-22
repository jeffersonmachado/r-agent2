'use strict';

/**
 * api/services/engineeringRouter/modelCatalogService.js — ER-V1-FINAL-008 (Current Model
 * Catalog).
 *
 * Persistência real (sem fallback em memória — convenção do projeto: `persistence_required`)
 * do catálogo governado de `providerId:modelId` observados pelo discovery real. Reconcilia cada
 * par com `engine/engineeringRouter/modelCatalogPolicy.js` (política pura) a partir de fatos de
 * discovery (isMapped, listedByProviderNow) — nunca decide elegibilidade sozinho, só registra o
 * estado resultante para auditoria/governança.
 */

const getEngineeringModelCatalogEntryModel = require('../../db/models/EngineeringModelCatalogEntry');
const { resolveCatalogStatus, isEligibleForRisk } = require('../../../engine/engineeringRouter/modelCatalogPolicy');
const logger = require('../../utils/logger');

function toPlain(row) {
  return row.get ? row.get({ plain: true }) : row;
}

/**
 * Reconcilia um par `providerId:modelId` observado pelo discovery real: cria a entrada se for a
 * primeira vez, ou atualiza `status`/`last_seen_at`/evidence se o status resultante mudou.
 * Idempotente — chamar repetidamente com os mesmos fatos nunca duplica nem gera churn.
 *
 * Nunca lança para o chamador: uma falha de persistência aqui é logada e best-effort — o
 * catálogo é uma camada de auditoria sobre o discovery, e uma falha nele nunca pode derrubar o
 * roteamento real (que já decide elegibilidade só a partir da allowlist estática).
 *
 * @param {{providerId: string, modelId: string, isMapped: boolean, listedByProviderNow: boolean|null, evidence?: object}} params
 */
async function reconcileDiscoveredModel({ providerId, modelId, isMapped, listedByProviderNow = null, evidence = {} }) {
  const Model = getEngineeringModelCatalogEntryModel();
  const now = new Date();
  try {
    const existing = await Model.findOne({ where: { provider_id: providerId, model_id: modelId } });
    const previousStatus = existing ? existing.get('status') : null;
    const status = resolveCatalogStatus({ isMapped, listedByProviderNow, previousStatus });

    if (!existing) {
      const row = await Model.create({
        provider_id: providerId,
        model_id: modelId,
        status,
        evidence,
        first_discovered_at: now,
        last_seen_at: now,
        last_status_change_at: now,
      });
      return toPlain(row);
    }

    const statusChanged = status !== previousStatus;
    await existing.update({
      status,
      evidence,
      last_seen_at: now,
      last_status_change_at: statusChanged ? now : existing.get('last_status_change_at'),
    });
    return toPlain(existing);
  } catch (err) {
    logger.warn('[modelCatalogService] falha ao reconciliar entrada do catálogo', { providerId, modelId, error: err.message });
    return null;
  }
}

async function getCatalogEntry(providerId, modelId) {
  const Model = getEngineeringModelCatalogEntryModel();
  const row = await Model.findOne({ where: { provider_id: providerId, model_id: modelId } });
  return row ? toPlain(row) : null;
}

async function listCatalogEntries({ status } = {}) {
  const Model = getEngineeringModelCatalogEntryModel();
  const where = status ? { status } : {};
  const rows = await Model.findAll({ where, order: [['first_discovered_at', 'ASC']] });
  return rows.map(toPlain);
}

module.exports = {
  reconcileDiscoveredModel,
  getCatalogEntry,
  listCatalogEntries,
  isEligibleForRisk,
};
