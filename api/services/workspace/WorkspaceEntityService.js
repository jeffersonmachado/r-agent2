'use strict';

const { Op } = require('sequelize');
const {
  WorkspaceEntity,
  WorkspaceEntityLink,
  MarketingLead,
  ChannelConversation,
  Ticket,
} = require('../../db/models');
const logger = require('../../utils/logger');
const {
  safeString,
  normalizePhone,
  normalizeEmail,
  toPlain,
  compactObject,
} = require('./workspaceUtils');

class WorkspaceEntityService {
  constructor(deps = {}) {
    this.WorkspaceEntity = deps.WorkspaceEntity || WorkspaceEntity;
    this.WorkspaceEntityLink = deps.WorkspaceEntityLink || WorkspaceEntityLink;
    this.MarketingLead = deps.MarketingLead || MarketingLead;
    this.ChannelConversation = deps.ChannelConversation || ChannelConversation;
    this.Ticket = deps.Ticket || Ticket;
    this.logger = deps.logger || logger;
  }

  async listEntities({ tenantId, q = '', limit = 50, offset = 0 } = {}) {
    const where = { tenant_id: tenantId };
    const term = safeString(q).trim();
    if (term) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${term}%` } },
        { phone: { [Op.iLike]: `%${term}%` } },
        { email: { [Op.iLike]: `%${term}%` } },
      ];
    }

    const result = await this.WorkspaceEntity().findAndCountAll({
      where,
      order: [['updated_at', 'DESC'], ['created_at', 'DESC']],
      limit,
      offset,
    });

    return {
      items: result.rows.map(toPlain),
      total: result.count,
      limit,
      offset,
      hasMore: offset + result.rows.length < result.count,
    };
  }

  async getEntity({ tenantId, entityId }) {
    const entity = await this.WorkspaceEntity().findOne({ where: { tenant_id: tenantId, id: entityId } });
    return toPlain(entity);
  }

  async createEntity({ tenantId, type = 'contact', name, phone = null, email = null, metadata = {} }) {
    const normalizedPhone = normalizePhone(phone) || null;
    const normalizedEmail = normalizeEmail(email) || null;
    const finalName = safeString(name).trim() || normalizedEmail || normalizedPhone || 'Contato sem nome';
    return toPlain(await this.WorkspaceEntity().create({
      tenant_id: tenantId,
      type: safeString(type, 'contact') || 'contact',
      name: finalName,
      phone: normalizedPhone,
      email: normalizedEmail,
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
    }));
  }

  async getOrCreateEntityFromContact({ tenantId, contact = {} }) {
    const phone = normalizePhone(contact.phone || contact.phone_number || contact.whatsapp);
    const email = normalizeEmail(contact.email);
    const name = safeString(contact.name || contact.fullName || contact.displayName).trim();
    const source = contact.source || 'workspace';

    const filters = [];
    if (phone) filters.push({ phone });
    if (email) filters.push({ email });

    if (filters.length > 0) {
      const existing = await this.WorkspaceEntity().findOne({ where: { tenant_id: tenantId, [Op.or]: filters } });
      if (existing) {
        const current = toPlain(existing);
        await existing.update({
          name: current.name || name || email || phone,
          phone: current.phone || phone || null,
          email: current.email || email || null,
          metadata: {
            ...(current.metadata || {}),
            lastSource: source,
            sourceRefs: {
              ...((current.metadata || {}).sourceRefs || {}),
              ...(contact.refId ? { [source]: contact.refId } : {}),
            },
          },
        });
        return toPlain(existing);
      }
    }

    return this.createEntity({
      tenantId,
      type: contact.type || 'contact',
      name: name || email || phone || 'Contato sem nome',
      phone,
      email,
      metadata: compactObject({
        lastSource: source,
        sourceRefs: contact.refId ? { [source]: contact.refId } : {},
        raw: contact.raw || null,
      }),
    });
  }

  async linkEntity({ tenantId, entityId, sourceType, sourceId, confidence = 1 }) {
    const normalizedType = safeString(sourceType).trim();
    const normalizedId = safeString(sourceId).trim();
    if (!tenantId || !entityId || !normalizedType || !normalizedId) {
      throw new Error('tenantId, entityId, sourceType e sourceId sao obrigatorios');
    }

    const entity = await this.WorkspaceEntity().findOne({ where: { tenant_id: tenantId, id: entityId } });
    if (!entity) throw new Error('workspace_entity_not_found');

    const [link, created] = await this.WorkspaceEntityLink().findOrCreate({
      where: { tenant_id: tenantId, source_type: normalizedType, source_id: normalizedId },
      defaults: {
        tenant_id: tenantId,
        entity_id: entityId,
        source_type: normalizedType,
        source_id: normalizedId,
        confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
      },
    });

    if (!created && (link.entity_id !== entityId || Number(link.confidence) < Number(confidence))) {
      await link.update({
        entity_id: entityId,
        confidence: Math.max(Number(link.confidence) || 0, Math.max(0, Math.min(1, Number(confidence) || 0))),
      });
    }

    return toPlain(link);
  }

  async linkSourceToEntity({ tenantId, sourceType, sourceId, entityId = null, contact = null, confidence = 1 }) {
    let finalEntityId = entityId;
    if (!finalEntityId) {
      const entity = await this.getOrCreateEntityFromContact({
        tenantId,
        contact: {
          ...(contact || {}),
          source: sourceType,
          refId: sourceId,
        },
      });
      finalEntityId = entity.id;
    }
    return this.linkEntity({ tenantId, entityId: finalEntityId, sourceType, sourceId, confidence });
  }

  async linkEntityToLead({ tenantId, entityId, leadId }) {
    const link = await this.linkEntity({ tenantId, entityId, sourceType: 'lead', sourceId: leadId, confidence: 1 });
    let lead = null;
    try {
      lead = await this.MarketingLead().findOne({ where: { tenant_key: tenantId, id: leadId } });
    } catch (err) {
      this.logger.warn('[WorkspaceEntity] Falha ao buscar lead para enriquecer entity', { tenantId, leadId, error: err.message });
    }
    if (lead) {
      const entity = await this.WorkspaceEntity().findOne({ where: { tenant_id: tenantId, id: entityId } });
      const plain = toPlain(entity);
      await entity.update({ phone: plain.phone || normalizePhone(lead.phone) || null, email: plain.email || normalizeEmail(lead.email) || null });
    }
    return link;
  }

  async linkEntityToConversation({ tenantId, entityId, conversationId }) {
    return this.linkEntity({ tenantId, entityId, sourceType: 'conversation', sourceId: conversationId, confidence: 1 });
  }

  async linkEntityToTicket({ tenantId, entityId, ticketId }) {
    return this.linkEntity({ tenantId, entityId, sourceType: 'ticket', sourceId: ticketId, confidence: 1 });
  }
}

module.exports = WorkspaceEntityService;
