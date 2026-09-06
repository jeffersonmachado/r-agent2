'use strict';

/**
 * Sinal de no-show da vertical Beauty para o Workspace (Customer 360).
 *
 * A jornada beauty já detecta no-show de forma autônoma
 * (beautyJourneyService.detectNoShow → vertical_journey_events) e oferece
 * reagendamento — mas nada disso aparecia para o operador no Workspace.
 * Este serviço resolve telefone do contato → subject beauty → faltas
 * recentes, para virar insight operacional e Next Best Action.
 *
 * Fonte durável: vertical_journey_events (o scheduleService é em memória).
 */

const { Op } = require('sequelize');
const models = require('../../db/models');

const NO_SHOW_LOOKBACK_DAYS = 45;

function digitsOnly(value) {
  return String(value || '').replace(/\D+/g, '');
}

/**
 * Subjects beauty/fitness do tenant cujo telefone (metadata.phone/whatsapp)
 * casa com o telefone informado. Comparação por dígitos com pré-filtro
 * tolerante a formatação (mesmo padrão do voiceInboxBridgeService).
 */
async function findSubjectsByPhone({ tenantId, phone }) {
  const digits = digitsOnly(phone);
  if (!digits) return [];
  // Pré-filtro no banco pelos últimos 4 dígitos (tolerante a formatação,
  // evita varrer a base inteira de subjects) + confirmação por dígitos em JS.
  const tail = digits.slice(-4);
  const SubjectModel = models.AccessSubject();
  const candidates = await SubjectModel.findAll({
    where: {
      tenant_key: String(tenantId),
      vertical_profile: { [Op.in]: ['beauty', 'fitness'] },
      [Op.or]: [
        { metadata: { phone: { [Op.iLike]: `%${tail}%` } } },
        { metadata: { whatsapp: { [Op.iLike]: `%${tail}%` } } },
      ],
    },
    limit: 50,
  }).catch(() => []);

  return (candidates || []).filter((item) => {
    const row = item.toJSON ? item.toJSON() : item;
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    return [metadata.phone, metadata.whatsapp].some((value) => digitsOnly(value) === digits);
  });
}

/**
 * Faltas (no_show_detected) recentes do contato, mais recentes primeiro.
 * @returns {Promise<Array<{scheduleId: string|null, subjectId: string|null, occurredAt: string, payload: object}>>}
 */
async function recentNoShowsByPhone({ tenantId, phone, lookbackDays = NO_SHOW_LOOKBACK_DAYS } = {}) {
  if (!tenantId || !phone) return [];
  const subjects = await findSubjectsByPhone({ tenantId, phone }).catch(() => []);
  const subjectIds = subjects
    .map((item) => String((item.toJSON ? item.toJSON() : item).id || ''))
    .filter(Boolean);
  if (subjectIds.length === 0) return [];

  const since = new Date(Date.now() - Math.max(1, Number(lookbackDays) || NO_SHOW_LOOKBACK_DAYS) * 864e5);
  const EventModel = models.VerticalJourneyEvent();
  const rows = await EventModel.findAll({
    where: {
      tenant_key: String(tenantId),
      vertical: 'beauty',
      event_type: 'no_show_detected',
      subject_id: { [Op.in]: subjectIds },
      occurred_at: { [Op.gte]: since },
    },
    order: [['occurred_at', 'DESC']],
    limit: 10,
  }).catch(() => []);

  return (rows || []).map((item) => {
    const row = item.toJSON ? item.toJSON() : item;
    return {
      scheduleId: row.schedule_id || null,
      subjectId: row.subject_id || null,
      occurredAt: row.occurred_at ? new Date(row.occurred_at).toISOString() : null,
      payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
    };
  }).filter((event) => event.occurredAt);
}

module.exports = {
  recentNoShowsByPhone,
  NO_SHOW_LOOKBACK_DAYS,
};
