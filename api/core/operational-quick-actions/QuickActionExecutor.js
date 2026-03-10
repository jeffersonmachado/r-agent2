'use strict';

const logger = require('../../utils/logger');
const OperationalEventWriter = require('../crm/OperationalEventWriter');
const { operationalEventBus } = require('../operational-agent/OperationalEventBus');
const { quickActionRegistry } = require('./OperationalQuickActionRegistry');
const { OutcomeTrackingService } = require('../operational-recommendations/OutcomeTrackingService');

function safeString(value) {
  const s = value == null ? '' : String(value).trim();
  return s || null;
}

function normalizeResponse(ok, actionId, sourceType, sourceId, result = null, error = null) {
  const base = {
    ok,
    actionId,
    sourceType,
    sourceId,
  };

  if (ok && result) {
    return { ...base, result };
  }

  if (!ok && error) {
    return { ...base, error };
  }

  return base;
}

class QuickActionExecutor {
  constructor() {
    // Lazy load services to avoid circular dependencies
    this.playbookStepExecutor = null;
    this.operationalEventWriter = null;
    this.outcomeTrackingService = new OutcomeTrackingService();
  }

  normalizeResponse(response, actionId, sourceType, sourceId) {
    if (response && response.ok) {
      return normalizeResponse(true, actionId, sourceType, sourceId, response.result || null, null);
    }
    return normalizeResponse(false, actionId, sourceType, sourceId, null, response?.error || null);
  }

  getPlaybookStepExecutor() {
    if (!this.playbookStepExecutor) {
      const directModule = require('../operational-playbooks/PlaybookStepExecutor');
      if (directModule && typeof directModule.executeStep === 'function') {
        this.playbookStepExecutor = directModule;
      } else if (typeof directModule?.PlaybookStepExecutor === 'function') {
        this.playbookStepExecutor = new directModule.PlaybookStepExecutor();
      } else {
        const playbookModule = require('../operational-playbooks');
        if (playbookModule?.playbookStepExecutor && typeof playbookModule.playbookStepExecutor.executeStep === 'function') {
          this.playbookStepExecutor = playbookModule.playbookStepExecutor;
        } else if (typeof playbookModule?.PlaybookStepExecutor === 'function') {
          this.playbookStepExecutor = new playbookModule.PlaybookStepExecutor();
        } else {
          throw new Error('PlaybookStepExecutor indisponível');
        }
      }
    }
    return this.playbookStepExecutor;
  }

  async resolveService(serviceName, methodName) {
    // Lazy require to avoid circular deps
    try {
      if (serviceName === 'ccCampaignsService') {
        const srv = require('../../services/cc/ccCampaignsService');
        if (srv[methodName]) return srv;
        if (methodName === 'createCampaign' && typeof srv.upsertCampaign === 'function') {
          return {
            createCampaign: async (payload = {}) => srv.upsertCampaign({
              tenantKey: String(payload.tenantId || ''),
              payload,
              actorUserId: payload.actorId || null,
            }),
          };
        }
        return null;
      }
      if (serviceName === 'ccScheduledCallbacksService') {
        const srv = require('../../services/cc/ccScheduledCallbacksService');
        if (srv[methodName]) return srv;
        if (methodName === 'scheduleCallback' && typeof srv.upsertScheduledCallback === 'function') {
          return {
            scheduleCallback: async (payload = {}) => srv.upsertScheduledCallback({
              tenantKey: String(payload.tenantId || ''),
              payload: {
                scheduledAt: payload.scheduledFor || payload.scheduledAt,
                phone: payload.phone,
                ddd: payload.ddd,
                description: payload.description,
                status: payload.status || 'pending',
                settings: payload.settings || {},
              },
              actorUserId: payload.actorId || null,
            }),
          };
        }
        return null;
      }
      if (serviceName === 'crmService') {
        const srv = require('../../services/crm/crmService');
        if (srv[methodName]) return srv;
        if (methodName === 'createOpportunity' && typeof srv.upsertOpportunity === 'function') {
          return {
            createOpportunity: async (payload = {}) => srv.upsertOpportunity({
              tenantId: payload.tenantId,
              pipelineId: payload.pipelineId || 'qualificacao',
              stageId: payload.stageId || 'qualificacao',
              title: payload.title || 'Oportunidade via quick action',
              accountId: payload.accountId || null,
              contactId: payload.contactId || null,
              ownerUserId: payload.actorId || null,
              status: payload.status || 'open',
              actorId: payload.actorId || null,
            }),
          };
        }
        return null;
      }
      if (serviceName === 'assignmentService') {
        if (methodName === 'assignToTeam') {
          return {
            assignToTeam: async (payload = {}) => ({
              ok: true,
              kind: 'assignment_requested',
              teamId: payload.teamId || null,
              ticketId: payload.ticketId || null,
              message: 'Solicitação de atribuição registrada',
            }),
          };
        }
        const srv = require('../../services/assignmentService');
        return srv[methodName] ? srv : null;
      }
      if (serviceName === 'channelHealthService') {
        const srv = require('../../services/channelHealthService');
        if (srv[methodName]) return srv;
        if (methodName === 'computeStatus' && typeof srv.getChannelHealth === 'function') {
          return {
            computeStatus: async (payload = {}) => srv.getChannelHealth({
              tenantId: payload.tenantId,
              windowMinutes: payload.windowMinutes || 10,
            }),
          };
        }
        return null;
      }
    } catch (err) {
      logger.warn('[QuickActionExecutor] Falha ao resolver serviço', {
        serviceName,
        methodName,
        error: err.message,
      });
      return null;
    }
    return null;
  }

  /**
   * Execute a quick action from a signal
   */
  async executeForSignal({
    tenantId,
    signalId,
    actionId,
    contactId = null,
    actorType = 'operator',
    actorId = null,
    input = {},
  }) {
    return this._execute({
      tenantId,
      sourceType: 'signal',
      sourceId: signalId,
      actionId,
      contactId,
      actorType,
      actorId,
      input,
    });
  }

  /**
   * Execute a quick action from a recommendation
   */
  async executeForRecommendation({
    tenantId,
    recommendationId,
    actionId,
    contactId = null,
    actorType = 'operator',
    actorId = null,
    input = {},
  }) {
    return this._execute({
      tenantId,
      sourceType: 'recommendation',
      sourceId: recommendationId,
      actionId,
      contactId,
      actorType,
      actorId,
      input,
    });
  }

  /**
   * Internal execution logic
   */
  async _execute({
    tenantId,
    sourceType,
    sourceId,
    actionId,
    contactId,
    actorType,
    actorId,
    input,
  }) {
    const tenantKey = safeString(tenantId);
    const sourceKey = safeString(sourceId);
    const actionKey = safeString(actionId);
    const actorTypeKey = safeString(actorType) || 'system';
    const actorIdKey = safeString(actorId) || 'unknown';

    // Validation
    if (!tenantKey) {
      return normalizeResponse(
        false,
        actionKey,
        sourceType,
        sourceKey,
        null,
        { code: 'TENANT_REQUIRED', message: 'Tenant ID é obrigatório' }
      );
    }

    if (!actionKey) {
      return normalizeResponse(
        false,
        actionKey,
        sourceType,
        sourceKey,
        null,
        { code: 'ACTION_REQUIRED', message: 'Action ID é obrigatório' }
      );
    }

    if (!sourceKey) {
      return normalizeResponse(
        false,
        actionKey,
        sourceType,
        sourceKey,
        null,
        { code: 'SOURCE_REQUIRED', message: 'Source ID (signal/recommendation) é obrigatório' }
      );
    }

    // Resolve action definition
    const action = quickActionRegistry.getActionById(actionKey);
    if (!action) {
      return normalizeResponse(
        false,
        actionKey,
        sourceType,
        sourceKey,
        null,
        { code: 'ACTION_NOT_FOUND', message: `Quick action "${actionKey}" não encontrada` }
      );
    }

    try {
      let result = null;

      // Route to appropriate executor based on executorType
      if (action.executorType === 'playbook_step') {
        result = await this._executePlaybookStep({
          tenantId: tenantKey,
          action,
          input,
          sourceType,
          sourceId: sourceKey,
        });
      } else if (action.executorType === 'service_call') {
        result = await this._executeServiceCall({
          tenantId: tenantKey,
          action,
          input,
        });
      } else if (action.executorType === 'event_emit') {
        result = await this._executeEventEmit({
          tenantId: tenantKey,
          action,
          input,
          sourceType,
          sourceId: sourceKey,
          contactId,
        });
      } else if (action.executorType === 'navigation') {
        result = await this._executeNavigation({
          tenantId: tenantKey,
          action,
          input,
        });
      } else {
        throw new Error(`Executor type desconhecido: ${action.executorType}`);
      }

      await this._recordOperationalOutcome({
        tenantId: tenantKey,
        contactId,
        sourceType,
        sourceId: sourceKey,
        actionId: actionKey,
        actorType: actorTypeKey,
        actorId: actorIdKey,
        input,
        success: true,
        result,
      });

      // Log success event
      this._logOperationalEvent({
        tenantId: tenantKey,
        actionId: actionKey,
        actionLabel: action.label,
        sourceType,
        sourceId: sourceKey,
        actorType: actorTypeKey,
        actorId: actorIdKey,
        success: true,
        result,
      });

      const normalizedResult = result && typeof result === 'object' ? result : {};

      return normalizeResponse(
        true,
        actionKey,
        sourceType,
        sourceKey,
        {
          kind: normalizedResult.kind || action.id,
          id: normalizedResult.id || null,
          message: normalizedResult.message || 'Ação executada com sucesso',
          ...normalizedResult,
        }
      );
    } catch (err) {
      logger.error('[QuickActionExecutor] Erro ao executar quick action', {
        actionId: actionKey,
        sourceType,
        sourceId: sourceKey,
        error: err.message,
      });

      await this._recordOperationalOutcome({
        tenantId: tenantKey,
        contactId,
        sourceType,
        sourceId: sourceKey,
        actionId: actionKey,
        actorType: actorTypeKey,
        actorId: actorIdKey,
        input,
        success: false,
        error: err.message,
      });

      // Log failure event
      this._logOperationalEvent({
        tenantId: tenantKey,
        actionId: actionKey,
        actionLabel: action.label,
        sourceType,
        sourceId: sourceKey,
        actorType: actorTypeKey,
        actorId: actorIdKey,
        success: false,
        error: err.message,
      });

      return normalizeResponse(
        false,
        actionKey,
        sourceType,
        sourceKey,
        null,
        { code: 'EXECUTION_ERROR', message: err.message }
      );
    }
  }

  /**
   * Execute through PlaybookStepExecutor (reuse existing logic)
   */
  async _executePlaybookStep({ tenantId, action, input, sourceType, sourceId }) {
    const stepExecutor = this.getPlaybookStepExecutor();

    // Merge action payload template with user input
    const step = {
      ...action.payloadTemplate,
      ...input,
      type: action.payloadTemplate.type,
    };

    const context = {
      tenantId,
      [sourceType === 'signal' ? 'signalId' : 'recommendationId']: sourceId,
      ...input, // Include any additional context from input
    };

    const result = await stepExecutor.executeStep(step, context);
    return result;
  }

  /**
   * Execute service call (delegate to domain service)
   */
  async _executeServiceCall({ tenantId, action, input }) {
    const { serviceName, serviceMethod } = action;

    if (!serviceName || !serviceMethod) {
      throw new Error(`Serviço ${serviceName} método ${serviceMethod} não configurado`);
    }

    const service = await this.resolveService(serviceName, serviceMethod);
    if (!service) {
      throw new Error(`Serviço ${serviceName} não encontrado`);
    }

    const method = service[serviceMethod];
    if (typeof method !== 'function') {
      throw new Error(`Método ${serviceMethod} não é uma função`);
    }

    // Call service method with merged payload
    const payload = {
      tenantId,
      ...action.payloadTemplate,
      ...input,
    };

    const result = await method(payload);
    return result || { kind: 'service_executed', message: 'Serviço executado' };
  }

  /**
   * Execute event emit (notification/alert)
   */
  async _executeEventEmit({ tenantId, action, input, sourceType = null, sourceId = null, contactId = null }) {
    const { eventType } = action;

    const payload = {
      tenantId,
      ...action.payloadTemplate,
      ...input,
    };

    const resolvedContactId = safeString(contactId)
      || safeString(input?.contactId)
      || safeString(input?.contact_id)
      || null;

    const out = await operationalEventBus.publishEvent({
      tenantId,
      contactId: resolvedContactId,
      type: eventType || 'operational_notification',
      sourceModule: 'quick_actions',
      referenceType: safeString(sourceType),
      referenceId: safeString(sourceId),
      payload,
      actorType: 'system',
      actorId: 'quick-action-executor',
      correlationId: safeString(sourceId) || null,
      triggerPipeline: true,
    });

    logger.info('[QuickActionExecutor] Event emitted', {
      eventType,
      tenantId,
      sourceType,
      sourceId,
      resolvedContactId,
      pipelineTriggered: out?.pipeline?.triggered === true,
    });

    return {
      kind: 'event_emitted',
      eventType,
      message: 'Notificação enviada',
      pipelineTriggered: out?.pipeline?.triggered === true,
    };
  }

  /**
   * Execute navigation (frontend only, returns navigation target)
   */
  async _executeNavigation({ tenantId, action }) {
    const { navigationTarget } = action;
    return {
      kind: 'navigation',
      target: navigationTarget,
      message: 'Navigate to ' + navigationTarget,
    };
  }

  /**
   * Log operational event (best-effort)
   */
  _logOperationalEvent({
    tenantId,
    actionId,
    actionLabel,
    sourceType,
    sourceId,
    actorType,
    actorId,
    success,
    result,
    error,
  }) {
    // Use OperationalEventWriter for best-effort logging
    try {
      OperationalEventWriter.writeOperationalEventBestEffort({
        tenantId,
        type: success ? 'operational_quick_action_executed' : 'operational_quick_action_failed',
        sourceModule: 'quick_actions',
        referenceType: sourceType,
        referenceId: sourceId,
        actorType,
        actorId,
        payload: {
          actionId,
          actionLabel,
          sourceType,
          sourceId,
          success,
          outcomeTracked: true,
          ...(success && result && { result }),
          ...(error && { error }),
        },
      });
    } catch (err) {
      // Best effort - don't fail execution if logging fails
      logger.warn('[QuickActionExecutor] Falha ao registrar evento operacional', {
        actionId,
        error: err.message,
      });
    }
  }

  async _recordOperationalOutcome({
    tenantId,
    contactId,
    sourceType,
    sourceId,
    actionId,
    actorType,
    actorId,
    input,
    success,
    result = null,
    error = null,
  }) {
    const tenantKey = safeString(tenantId);
    const sourceKey = safeString(sourceId);
    const sourceKind = safeString(sourceType);
    const actionKey = safeString(actionId);
    if (!tenantKey || !sourceKey || !sourceKind || !actionKey) return;

    try {
      const resolvedContactId = safeString(contactId)
        || safeString(input?.contactId)
        || safeString(input?.contact_id)
        || null;

      await this.outcomeTrackingService.recordActionExecution({
        tenantId: tenantKey,
        contactId: resolvedContactId,
        sourceType: sourceKind,
        sourceId: sourceKey,
        actionId: actionKey,
        actorType: safeString(actorType) || 'system',
        actorId: safeString(actorId),
        input: input && typeof input === 'object' ? input : {},
        success,
        result,
        error,
      });
    } catch (err) {
      logger.debug('[QuickActionExecutor] Falha ao persistir OperationalAction/OperationalOutcome (ignorado)', {
        actionId: actionKey,
        sourceType: sourceKind,
        sourceId: sourceKey,
        error: err?.message || String(err || 'unknown_error'),
      });
    }
  }
}

const quickActionExecutor = new QuickActionExecutor();

module.exports = {
  QuickActionExecutor,
  quickActionExecutor,
};
