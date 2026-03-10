'use strict';

const { OperationalContextAssembler } = require('../operational-agent/OperationalContextAssembler');
const defaultConversationContextService = require('../../services/conversationContextService');
const { createOperationalContext } = require('../operational-contracts');

class OperationalContextService {
  constructor({ assembler, conversationContextService } = {}) {
    this.assembler = assembler || new OperationalContextAssembler();
    this.conversationContextService = conversationContextService || defaultConversationContextService;
  }

  async assembleTenantContext({ tenantId } = {}) {
    const out = await this.assembler.assembleTenantContext({ tenantId });
    if (!out?.ok) return out;
    return {
      ...out,
      context: createOperationalContext({
        tenantId,
        scheduling: out.scheduling,
        crm: { summary: out.crmSummary },
        team: {
          support: out.support,
          campaigns: out.campaigns,
          callbacks: out.callbacks,
          tasks: out.tasks,
        },
        knowledge: out.rag,
        history: {
          revenue: out.revenue,
        },
        metadata: {
          scope: 'tenant',
        },
      }),
    };
  }

  async assembleContactContext({ tenantId, contactId, ticket = null, messages = [], userPrompt = '' } = {}) {
    const [operationalOut, conversationOut] = await Promise.all([
      this.assembler.assembleContactContext({ tenantId, contactId }),
      ticket ? this.conversationContextService.buildConversationContext({ tenantId, ticket, messages, userPrompt }) : Promise.resolve(null),
    ]);

    if (!operationalOut?.ok) return operationalOut;

    return {
      ...operationalOut,
      context: createOperationalContext({
        tenantId,
        contactId,
        customer: operationalOut.profile?.contact || {},
        conversation: conversationOut?.context || {},
        ticket: ticket || {},
        scheduling: {
          schedules: operationalOut.schedules,
          stats: operationalOut.scheduleStats,
        },
        crm: {
          summary: operationalOut.summary,
          profile: operationalOut.profile,
          revenue: operationalOut.revenue,
        },
        knowledge: {
          rag: operationalOut.rag,
        },
        history: {
          callbacks: operationalOut.callbacks,
        },
        metadata: {
          scope: 'contact',
          flags: operationalOut.flags || {},
        },
      }),
    };
  }
}

module.exports = {
  OperationalContextService,
};
