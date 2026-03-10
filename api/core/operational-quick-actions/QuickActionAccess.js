'use strict';

const logger = require('../../utils/logger');
const { OperationalAgentService } = require('../operational-agent/OperationalAgentService');
const { quickActionRegistry } = require('./OperationalQuickActionRegistry');
const { quickActionContextGuard } = require('./QuickActionContextGuard');
const { CrmContact } = require('../../db/models');

const PRIVILEGED_ADMIN_ROLES = new Set(['owner', 'admin', 'manager', 'supervisor']);
const ACTION_ROLE_RESTRICTIONS = {
  assign_team: ['owner', 'admin', 'manager', 'supervisor'],
  review_schedule_policy: ['owner', 'admin', 'manager'],
  notify_supervisor: ['owner', 'admin', 'manager', 'supervisor'],
};

const EXECUTABLE_SIGNAL_STATUSES = new Set(['open', 'acknowledged']);
const EXECUTABLE_RECOMMENDATION_STATUSES = new Set(['open', 'accepted']);

function safeString(value) {
  const s = value == null ? '' : String(value).trim();
  return s || null;
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function buildError(status, code, message) {
  return {
    ok: false,
    status,
    error: {
      code,
      message,
    },
  };
}

function toSafeList(value) {
  return Array.isArray(value) ? value : [];
}

function isActionAllowedByRole({ actionId, role, isSuperAdmin }) {
  if (isSuperAdmin) return true;
  const restrictions = ACTION_ROLE_RESTRICTIONS[String(actionId || '').trim()];
  if (!Array.isArray(restrictions) || restrictions.length === 0) return true;
  return restrictions.includes(normalizeRole(role));
}

function isSourceActionable({ sourceType, source }) {
  const status = normalizeStatus(source?.status);
  if (!status) return true;

  if (sourceType === 'signal') {
    return EXECUTABLE_SIGNAL_STATUSES.has(status);
  }

  if (sourceType === 'recommendation') {
    return EXECUTABLE_RECOMMENDATION_STATUSES.has(status);
  }

  return false;
}

class QuickActionAccess {
  constructor({
    registry = quickActionRegistry,
    contextGuard = quickActionContextGuard,
    createOperationalAgentService = () => new OperationalAgentService(),
    contactModelFactory = CrmContact,
  } = {}) {
    this.registry = registry;
    this.contextGuard = contextGuard;
    this.createOperationalAgentService = createOperationalAgentService;
    this.contactModelFactory = contactModelFactory;
  }

  async contactExists({ tenantId, contactId }) {
    const tenantKey = safeString(tenantId);
    const contactKey = safeString(contactId);
    if (!tenantKey || !contactKey) return false;

    const model = this.contactModelFactory();
    if (!model || typeof model.findOne !== 'function') {
      return false;
    }

    const row = await model.findOne({
      where: {
        tenant_key: tenantKey,
        id: contactKey,
      },
      attributes: ['id'],
    });

    return !!row;
  }

  async resolveScope({
    mode = 'admin',
    operation = 'list',
    actor = {},
    actorTenantId = null,
    routeTenantId = null,
    contactId = null,
    sourceType = null,
    sourceId = null,
    actionId = null,
    supportContext = null,
  } = {}) {
    const scopeMode = String(mode || 'admin').trim().toLowerCase();
    const op = String(operation || 'list').trim().toLowerCase();
    const sourceKind = String(sourceType || '').trim().toLowerCase();
    const sourceKey = safeString(sourceId);
    const actionKey = safeString(actionId);

    const isSuper = !!actor?.isSuperAdmin;
    const role = normalizeRole(actor?.role);
    const actorTenant = safeString(actorTenantId);
    const routeTenant = safeString(routeTenantId);
    const contactKey = safeString(contactId);

    if (!['admin', 'contact'].includes(scopeMode)) {
      return buildError(400, 'invalid_scope_mode', 'Escopo de quick action inválido');
    }

    if (!['list', 'execute'].includes(op)) {
      return buildError(400, 'invalid_operation', 'Operação de quick action inválida');
    }

    if (!['signal', 'recommendation'].includes(sourceKind)) {
      return buildError(400, 'invalid_source_type', 'Tipo de fonte inválido para quick action');
    }

    if (!sourceKey) {
      return buildError(400, 'source_id_required', 'ID da fonte operacional é obrigatório');
    }

    const permissionFlag = op === 'execute' ? !!actor?.canExecute : !!actor?.canRead;

    if (!isSuper && !permissionFlag) {
      return buildError(403, 'forbidden', op === 'execute'
        ? 'Usuário sem permissão para executar quick actions'
        : 'Usuário sem permissão para listar quick actions');
    }

    let tenantId = null;

    if (scopeMode === 'admin') {
      tenantId = routeTenant;
      if (!tenantId) {
        return buildError(400, 'tenant_required', 'Tenant ID é obrigatório no escopo admin');
      }

      if (!isSuper) {
        if (!actorTenant) {
          return buildError(403, 'tenant_required', 'Tenant do usuário não encontrado');
        }

        if (actorTenant !== tenantId) {
          return buildError(403, 'cross_tenant_forbidden', 'Acesso cross-tenant não permitido para este usuário');
        }

        if (!PRIVILEGED_ADMIN_ROLES.has(role)) {
          return buildError(403, 'admin_scope_forbidden', 'Acesso admin de quick actions permitido apenas para perfis privilegiados');
        }
      }
    } else {
      tenantId = actorTenant;
      if (!tenantId) {
        return buildError(403, 'tenant_required', 'Tenant do usuário não encontrado');
      }

      if (!contactKey) {
        return buildError(400, 'contact_required', 'Contact ID é obrigatório no escopo de contato');
      }

      const exists = await this.contactExists({ tenantId, contactId: contactKey });
      if (!exists) {
        return buildError(404, 'contact_not_found', 'Contato não encontrado no escopo informado');
      }
    }

    const loadedSource = await this.#loadSource({
      sourceType: sourceKind,
      tenantId,
      sourceId: sourceKey,
      contactId: scopeMode === 'contact' ? contactKey : null,
    });

    if (!loadedSource.ok) {
      return loadedSource;
    }

    const source = loadedSource.source;

    if (scopeMode === 'contact') {
      const sourceContact = safeString(source?.contact_id || source?.contactId);
      if (!sourceContact || sourceContact !== contactKey) {
        return buildError(404, 'source_not_found', 'Fonte operacional não encontrada no escopo do contato informado');
      }
    }

    const actions = sourceKind === 'signal'
      ? this.registry.getActionsForSignal(source)
      : this.registry.getActionsForRecommendation(source);

    if (actionKey) {
      const actionDefinition = this.registry.getActionById(actionKey);
      if (!actionDefinition) {
        return buildError(422, 'action_not_found', 'Quick action não encontrada');
      }

      const allowedForSource = toSafeList(actions).some((item) => String(item?.id || '') === actionKey);
      if (!allowedForSource) {
        return buildError(422, 'action_not_valid_for_source', 'Quick action inválida para este sinal/recomendação');
      }

      if (!isActionAllowedByRole({ actionId: actionKey, role, isSuperAdmin: isSuper })) {
        return buildError(403, 'action_forbidden_by_role', 'Perfil não autorizado para executar esta quick action');
      }

      if (op === 'execute' && !isSourceActionable({ sourceType: sourceKind, source })) {
        return buildError(422, 'source_not_actionable', 'Fonte operacional não está acionável para execução de quick action');
      }
    }

    let resolvedSupportContext = supportContext;
    if (this.contextGuard && typeof this.contextGuard.validate === 'function') {
      const guardOut = await this.contextGuard.validate({
        mode: scopeMode,
        operation: op,
        actor,
        tenantId,
        contactId: scopeMode === 'contact' ? contactKey : null,
        sourceType: sourceKind,
        source,
        actionId: actionKey,
        supportContext,
      });

      if (!guardOut?.ok) {
        return guardOut;
      }

      resolvedSupportContext = guardOut?.context || resolvedSupportContext;
    }

    return {
      ok: true,
      tenantId,
      contactId: scopeMode === 'contact' ? contactKey : null,
      source,
      actions,
      supportContext: resolvedSupportContext,
    };
  }

  async #loadSource({ sourceType, tenantId, sourceId, contactId = null }) {
    const service = this.createOperationalAgentService();
    const safeLimit = 1000;

    try {
      if (sourceType === 'signal') {
        const out = contactId
          ? await service.listContactSignals({ tenantId, contactId, activeOnly: false, limit: safeLimit })
          : await service.listTenantSignals({ tenantId, activeOnly: false, limit: safeLimit });

        if (!out?.ok) {
          logger.warn('[QuickActionAccess] Falha ao carregar sinais para escopo', {
            tenantId,
            contactId,
            error: out?.error || 'unknown_error',
          });
          return buildError(500, 'source_lookup_failed', 'Não foi possível validar o sinal operacional');
        }

        const item = toSafeList(out.items).find((entry) => String(entry?.id || '') === String(sourceId));
        if (!item) return buildError(404, 'source_not_found', 'Sinal operacional não encontrado no escopo informado');
        return { ok: true, source: item };
      }

      if (sourceType === 'recommendation') {
        const out = contactId
          ? await service.listContactRecommendations({ tenantId, contactId, limit: safeLimit })
          : await service.listTenantRecommendations({ tenantId, limit: safeLimit });

        if (!out?.ok) {
          logger.warn('[QuickActionAccess] Falha ao carregar recomendações para escopo', {
            tenantId,
            contactId,
            error: out?.error || 'unknown_error',
          });
          return buildError(500, 'source_lookup_failed', 'Não foi possível validar a recomendação operacional');
        }

        const item = toSafeList(out.items).find((entry) => String(entry?.id || '') === String(sourceId));
        if (!item) return buildError(404, 'source_not_found', 'Recomendação operacional não encontrada no escopo informado');
        return { ok: true, source: item };
      }

      return buildError(400, 'invalid_source_type', 'Tipo de fonte inválido para quick action');
    } catch (err) {
      logger.error('[QuickActionAccess] Erro ao validar escopo de quick action', {
        sourceType,
        tenantId,
        contactId,
        sourceId,
        error: err.message,
      });
      return buildError(500, 'source_lookup_failed', 'Não foi possível validar a fonte operacional');
    }
  }
}

const quickActionAccess = new QuickActionAccess();

module.exports = {
  QuickActionAccess,
  quickActionAccess,
  PRIVILEGED_ADMIN_ROLES,
  ACTION_ROLE_RESTRICTIONS,
};
