'use strict';

/**
 * Learning Core — Mission Service.
 *
 * Missões de treinamento: disponíveis para o tenant (agentId null) ou
 * atribuídas a um usuário. Conclusão é declarada pelo próprio usuário na
 * Academy (a validação por evidência entra na Fase 4 — Assessment Engine).
 */

const { Op } = require('sequelize');

const getLearningMissionModel = require('../../db/models/LearningMission');
const logger = require('../../utils/logger');

/**
 * Lista missões visíveis para o usuário: as disponíveis para o tenant
 * (agentId null) + as atribuídas a ele, com o status dele.
 */
async function listMissionsForUser({ tenantId, agentId }) {
  const Model = getLearningMissionModel();
  const rows = await Model.findAll({
    where: {
      tenant_id: String(tenantId),
      [Op.or]: [
        { agentId: null },
        { agentId: String(agentId) },
      ],
    },
    order: [['created_at', 'DESC']],
    limit: 100,
  });

  return rows.map((row) => {
    const plain = row.toJSON ? row.toJSON() : row;
    // Missão coletiva concluída por outro usuário continua disponível para mim.
    const completedByMe = plain.status === 'completed' && plain.completedBy === String(agentId);
    const status = plain.agentId === null
      ? (completedByMe ? 'completed' : 'available')
      : plain.status;
    return {
      id: plain.id,
      journeyKey: plain.journeyKey,
      title: plain.title,
      summary: plain.summary,
      ragDocumentId: plain.ragDocumentId,
      replayId: plain.replayId,
      status,
      completedAt: completedByMe ? plain.completedAt : null,
      createdAt: plain.createdAt,
    };
  });
}

/**
 * Marca uma missão como concluída pelo usuário. Missão coletiva (agentId
 * null) gera uma cópia atribuída ao usuário, preservando a disponibilidade
 * para os demais.
 */
async function completeMission({ tenantId, agentId, missionId }) {
  const Model = getLearningMissionModel();
  const mission = await Model.findOne({
    where: { id: missionId, tenant_id: String(tenantId) },
  });
  if (!mission) {
    const error = new Error('Missao nao encontrada');
    error.code = 'NOT_FOUND';
    throw error;
  }

  const now = new Date();

  if (mission.agentId === null) {
    const [copy] = await Model.findOrCreate({
      where: {
        tenant_id: String(tenantId),
        agentId: String(agentId),
        replayId: mission.replayId || mission.id,
      },
      defaults: {
        tenant_id: String(tenantId),
        agentId: String(agentId),
        journeyKey: mission.journeyKey,
        title: mission.title,
        summary: mission.summary,
        ragDocumentId: mission.ragDocumentId,
        replayId: mission.replayId,
        status: 'completed',
        completedAt: now,
        completedBy: String(agentId),
        metadata: mission.metadata || {},
      },
    });
    if (copy.status !== 'completed') {
      await copy.update({ status: 'completed', completedAt: now, completedBy: String(agentId) });
    }
    logger.info('[learning-core] Missao coletiva concluida por usuario', {
      tenantId, agentId: String(agentId), missionId, copyId: copy.id,
    });
    return { id: copy.id, status: 'completed', completedAt: now };
  }

  if (mission.agentId !== String(agentId)) {
    const error = new Error('Missao atribuida a outro usuario');
    error.code = 'FORBIDDEN';
    throw error;
  }

  await mission.update({ status: 'completed', completedAt: now, completedBy: String(agentId) });
  return { id: mission.id, status: 'completed', completedAt: now };
}

module.exports = {
  listMissionsForUser,
  completeMission,
};
