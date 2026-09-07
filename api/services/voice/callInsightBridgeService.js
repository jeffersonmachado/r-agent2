'use strict';

/**
 * Call Insight Bridge — transcrição de chamada → intenção → Workspace Insight
 * → Next Best Action (P5.15).
 *
 * Dado um call message do Inbox com transcrição, extrai o insight via IA do
 * tenant (callTranscriptInsightService), grava o insight no corpo da
 * mensagem (timeline da conversa) e persiste um WorkspaceInsight na entidade
 * vinculada — o motor existente de NBA (WorkspaceActionService) passa a
 * responder à ligação sem nenhum desvio de arquitetura.
 *
 * Mapeamento intent → insight:
 *   cancelar/reclamacao            → risk       (confidence por urgência)
 *   compra/retorno/upsell-ish      → opportunity
 *   agendar/reagendar/confirmar    → opportunity (preservação de receita)
 *   duvida/suporte/outro           → sem insight (barulho) — apenas o
 *                                    resumo fica na mensagem.
 *
 * Fail-soft: qualquer indisponibilidade (IA, DB, link) deixa a chamada e a
 * transcrição intactas e apenas registra warn.
 */

const logger = require('../../utils/logger');
const { analyzeCallTranscript } = require('./callTranscriptInsightService');

const CONFIDENCE_BY_URGENCY = { alta: 0.85, media: 0.7, baixa: 0.55 };

const INTENT_TO_INSIGHT = {
  cancelar: { type: 'risk', label: 'cancelamento' },
  reclamacao: { type: 'risk', label: 'reclamação' },
  compra: { type: 'opportunity', label: 'interesse de compra' },
  retorno: { type: 'opportunity', label: 'interesse em retorno' },
  agendar: { type: 'opportunity', label: 'pedido de agendamento' },
  reagendar: { type: 'opportunity', label: 'pedido de reagendamento' },
  confirmar: { type: 'opportunity', label: 'confirmação' },
};

function buildInsightDescription({ mapping, insight }) {
  return `Cliente sinalizou ${mapping.label} em ligação: ${insight.summary}`;
}

/**
 * Processa o insight de um call message já transcrito.
 * Idempotente: se body.call.insight já existe, não reprocessa.
 *
 * @param {{ tenantId: string, message: object, deps?: object }} args
 *   message: instância Sequelize (ou plain) do ChannelMessage type='call'.
 * @returns {Promise<{processed: boolean, reason?: string, insight?: object, insightPersisted?: boolean}>}
 */
async function processCallInsight({ tenantId, message } = {}) {
  if (!tenantId || !message) return { processed: false, reason: 'invalid_input' };
  const body = message.body && typeof message.body === 'object' ? message.body : {};
  if (body.call?.insight) return { processed: false, reason: 'already_processed', insight: body.call.insight };
  const transcript = body.transcription?.text;
  if (!transcript) return { processed: false, reason: 'no_transcription' };

  const insight = await analyzeCallTranscript({ tenantId, transcript });
  if (!insight) return { processed: false, reason: 'insight_unavailable' };

  // 1. Insight na timeline da conversa (corpo da mensagem de chamada).
  const nextBody = {
    ...body,
    call: { ...(body.call || {}), insight },
  };
  if (typeof message.update === 'function') {
    await message.update({ body: nextBody, updated_at: new Date() });
  }

  // 2. WorkspaceInsight na entidade vinculada → NBA existente responde.
  let insightPersisted = false;
  const mapping = INTENT_TO_INSIGHT[insight.intent];
  if (mapping) {
    try {
      // Requires tardios: mantêm o módulo carregável em testes isolados.
      // eslint-disable-next-line global-require
      const { WorkspaceEntityLink } = require('../../db/models');
      const linkModel = typeof WorkspaceEntityLink === 'function' ? WorkspaceEntityLink() : WorkspaceEntityLink;
      const conversationId = message.conversation_id || message.conversationId;
      const link = await linkModel.findOne({
        where: { tenant_id: String(tenantId), source_type: 'conversation', source_id: String(conversationId) },
        attributes: ['entity_id'],
      }).catch(() => null);
      const entityId = link?.entity_id ? String(link.entity_id) : null;

      if (entityId) {
        // eslint-disable-next-line global-require
        const WorkspaceInsightService = require('../workspace/WorkspaceInsightService');
        const insightService = new WorkspaceInsightService();
        await insightService.persistInsight({
          tenantId: String(tenantId),
          entityId,
          insight: {
            type: mapping.type,
            description: buildInsightDescription({ mapping, insight }),
            confidence: CONFIDENCE_BY_URGENCY[insight.urgency] || 0.65,
            source: 'voice_call',
          },
        });
        insightPersisted = true;
      }
    } catch (err) {
      logger.warn('[CallInsightBridge] Falha ao persistir insight na entidade (fail-soft)', {
        tenantId,
        error: err?.message,
      });
    }
  }

  return { processed: true, insight, insightPersisted };
}

module.exports = {
  processCallInsight,
  INTENT_TO_INSIGHT,
};
