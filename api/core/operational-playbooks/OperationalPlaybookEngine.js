'use strict';

const { CRMEventService } = require('../crm');
const { OperationalAgentService } = require('../operational-agent/OperationalAgentService');

function safeString(value) {
  const normalized = value == null ? '' : String(value).trim();
  return normalized || null;
}

class OperationalPlaybookEngine {
  constructor({ registry, runner, operationalAgentService } = {}) {
    this.registry = registry;
    this.runner = runner;
    this.operationalAgentService = operationalAgentService || new OperationalAgentService();
  }

  getPlaybookForSignal(signal) {
    const signalType = safeString(signal?.type || signal?.signalType);
    if (!signalType) return { ok: false, error: 'signal_type_required', playbook: null };
    const playbook = this.registry.getPlaybookForSignal(signalType);
    if (!playbook) return { ok: false, error: 'playbook_not_found', playbook: null };
    return { ok: true, playbook };
  }

  getPlaybookSteps(playbookId) {
    const playbook = this.registry.getPlaybook(playbookId);
    if (!playbook) return { ok: false, error: 'playbook_not_found', items: [] };
    return {
      ok: true,
      playbookId: playbook.id,
      items: Array.isArray(playbook.steps) ? playbook.steps : [],
    };
  }

  listPlaybooks({ signalType = null } = {}) {
    const signalKey = safeString(signalType);
    if (signalKey) {
      const playbook = this.registry.getPlaybookForSignal(signalKey);
      return {
        ok: true,
        items: playbook ? [playbook] : [],
        total: playbook ? 1 : 0,
      };
    }

    const items = this.registry.listPlaybooks();
    return { ok: true, items, total: items.length };
  }

  async listSuggestedPlaybooksForContact({ tenantId, contactId, limit = 12 }) {
    const tenantKey = safeString(tenantId);
    const contactKey = safeString(contactId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };
    if (!contactKey) return { ok: false, error: 'contact_required' };

    await this.operationalAgentService.generateContactRecommendations({
      tenantId: tenantKey,
      contactId: contactKey,
      includeSignalGeneration: true,
    }).catch(() => null);

    const [signalsOut, recommendationsOut] = await Promise.all([
      this.operationalAgentService.listContactSignals({
        tenantId: tenantKey,
        contactId: contactKey,
        activeOnly: true,
        limit: Math.max(1, Number(limit) || 12),
      }),
      this.operationalAgentService.listContactRecommendations({
        tenantId: tenantKey,
        contactId: contactKey,
        limit: Math.max(1, Number(limit) || 12),
      }),
    ]);

    if (!signalsOut?.ok) return { ok: false, error: signalsOut?.error || 'signals_unavailable' };
    if (!recommendationsOut?.ok) return { ok: false, error: recommendationsOut?.error || 'recommendations_unavailable' };

    const recommendations = Array.isArray(recommendationsOut.items) ? recommendationsOut.items : [];
    const bySignalId = new Map();
    for (const recommendation of recommendations) {
      const sourceSignalId = safeString(recommendation?.source_signal_id || recommendation?.sourceSignalId);
      if (sourceSignalId && !bySignalId.has(sourceSignalId)) {
        bySignalId.set(sourceSignalId, recommendation);
      }
    }

    const suggestions = [];
    for (const signal of signalsOut.items || []) {
      const playbook = this.registry.getPlaybookForSignal(signal?.type);
      if (!playbook) continue;

      const recommendation = bySignalId.get(String(signal.id))
        || recommendations.find((item) => String(item?.source_signal_type || item?.sourceSignalType || '') === String(signal?.type || ''))
        || null;

      suggestions.push({
        playbook,
        signal,
        recommendation,
      });
    }

    return {
      ok: true,
      tenantId: tenantKey,
      contactId: contactKey,
      items: suggestions,
      total: suggestions.length,
    };
  }

  async startPlaybookExecution(playbookId, context = {}) {
    const playbook = this.registry.getPlaybook(playbookId);
    if (!playbook) return { ok: false, error: 'playbook_not_found' };

    const tenantId = safeString(context.tenantId);
    const contactId = safeString(context.contactId);
    const operatorId = safeString(context.operatorId);
    if (!tenantId) return { ok: false, error: 'tenant_required' };
    if (!contactId) return { ok: false, error: 'contact_required' };
    if (!operatorId) return { ok: false, error: 'operator_required' };

    const contactOut = await CRMEventService.getContactProfile({
      tenantId,
      contactId,
      timelineLimit: 1,
    });
    if (!contactOut?.ok || !contactOut?.profile?.contact) {
      return { ok: false, error: 'contact_not_found_for_tenant' };
    }

    const normalizedContext = {
      tenantId,
      contactId,
      signalId: safeString(context.signalId),
      recommendationId: safeString(context.recommendationId),
      operatorId,
      accountId: safeString(context.accountId || contactOut?.profile?.contact?.account_id || contactOut?.profile?.contact?.accountId),
      phoneNumber: safeString(context.phoneNumber || contactOut?.profile?.contact?.phone),
      teamId: safeString(context.teamId),
      conversationId: safeString(context.conversationId),
      ticketId: safeString(context.ticketId),
      metadata: context.metadata && typeof context.metadata === 'object' ? context.metadata : {},
    };

    return this.runner.run(playbook, normalizedContext);
  }

  async executePlaybookStep(playbookId, {
    tenantId,
    executionId,
    stepId = null,
    action = 'next',
    context = {},
  } = {}) {
    const playbook = this.registry.getPlaybook(playbookId);
    if (!playbook) return { ok: false, error: 'playbook_not_found' };

    const tenantKey = safeString(tenantId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };

    const executionKey = safeString(executionId);
    if (!executionKey) return { ok: false, error: 'execution_id_required' };

    const contextWithTenant = {
      ...(context && typeof context === 'object' ? context : {}),
      tenantId: tenantKey,
    };

    if (String(action || 'next').toLowerCase() === 'step') {
      const stepKey = safeString(stepId);
      if (!stepKey) return { ok: false, error: 'step_id_required' };
      return this.runner.executeStep(playbook, executionKey, stepKey, contextWithTenant);
    }

    return this.runner.nextStep(playbook, executionKey, contextWithTenant);
  }

  async getExecution({ tenantId, executionId }) {
    return this.runner.getExecution({ tenantId, executionId });
  }
}

module.exports = {
  OperationalPlaybookEngine,
};
