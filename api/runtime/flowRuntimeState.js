'use strict';

function validateFlowStructure(rawFlow) {
  if (!rawFlow || typeof rawFlow !== 'object') {
    return { valid: false, error: 'Flow deve ser um objeto' };
  }

  if (!Array.isArray(rawFlow.nodes)) {
    return { valid: false, error: 'Flow deve ter um campo "nodes" do tipo array' };
  }

  if (rawFlow.nodes.length === 0) {
    return { valid: false, error: 'Flow deve ter pelo menos um nó' };
  }

  if (rawFlow.nodes.length > 1000) {
    return { valid: false, error: 'Flow excede o limite máximo de 1000 nós' };
  }

  const jsonString = JSON.stringify(rawFlow);
  if (jsonString.length > 10 * 1024 * 1024) {
    return { valid: false, error: 'Flow excede o tamanho máximo de 10MB' };
  }

  return { valid: true, flow: rawFlow };
}

function ensureFlowHasMeta(rawFlow, tenantId = null) {
  const flow = rawFlow && typeof rawFlow === 'object' ? { ...rawFlow } : {};

  if (!flow.tenantId || typeof flow.tenantId !== 'string' || flow.tenantId.trim() === '') {
    flow.tenantId = tenantId || null;
  } else {
    flow.tenantId = flow.tenantId.trim();
    if (flow.tenantId.length > 100) {
      flow.tenantId = flow.tenantId.substring(0, 100);
    }
  }

  if (!flow.id || typeof flow.id !== 'string' || flow.id.trim() === '') {
    const baseName = flow.name && typeof flow.name === 'string' ? flow.name : 'flow';
    flow.id = `${baseName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}-${Date.now()}`;
  } else {
    flow.id = flow.id.trim();
    if (flow.id.length > 200) {
      flow.id = flow.id.substring(0, 200);
    }
  }

  if (!flow.name || typeof flow.name !== 'string' || flow.name.trim() === '') {
    flow.name = 'Fluxo sem nome';
  } else {
    flow.name = flow.name.trim();
    if (flow.name.length > 500) {
      flow.name = flow.name.substring(0, 500);
    }
  }

  if (
    typeof flow.version !== 'number' ||
    Number.isNaN(flow.version) ||
    flow.version < 1 ||
    !Number.isInteger(flow.version)
  ) {
    flow.version = 1;
  } else if (flow.version > 999999) {
    flow.version = 999999;
  }

  return flow;
}

function createFlowRuntimeState({ logger }) {
  const flows = new Map();
  const sessionEvents = new Map();
  // Carimbo de tenant por sessão de replay: sessionId → tenantId.
  // Readers (/replay/:sessionId, /conversations/:sessionId) só respondem
  // quando o tenant carimbado casa com req.tenantId (fail-closed).
  const sessionTenants = new Map();
  const SESSION_CLEANUP_INTERVAL = 60 * 60 * 1000;
  const SESSION_MAX_AGE = 24 * 60 * 60 * 1000;

  function setSessionTenant(sessionId, tenantId) {
    if (!sessionId || typeof sessionId !== 'string') return;
    if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') return;
    sessionTenants.set(sessionId, tenantId.trim());
  }

  function getSessionTenant(sessionId) {
    return sessionTenants.get(sessionId) || null;
  }

  function saveSessionEventsToFile() {
    logger.debug('[Conversations] saveSessionEventsToFile chamado mas ignorado (dados estão no banco de dados)');
  }

  function saveSessionEventsToFileImmediate() {
    logger.debug('[Conversations] saveSessionEventsToFileImmediate chamado mas ignorado (dados estão no banco de dados)');
  }

  function cleanupOldSessions() {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, events] of sessionEvents.entries()) {
      if (!Array.isArray(events) || events.length === 0) {
        continue;
      }

      const firstEvent = events[0];
      if (!firstEvent || !firstEvent.timestamp) {
        continue;
      }

      const eventTimestamp = new Date(firstEvent.timestamp).getTime();
      if (Number.isNaN(eventTimestamp)) {
        continue;
      }

      if (now - eventTimestamp > SESSION_MAX_AGE) {
        sessionEvents.delete(sessionId);
        sessionTenants.delete(sessionId);
        cleaned += 1;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Limpeza de sessões: ${cleaned} sessão(ões) antiga(s) removida(s)`);
      saveSessionEventsToFileImmediate();
    }
  }

  const cleanupTimer = setInterval(cleanupOldSessions, SESSION_CLEANUP_INTERVAL);
  if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }

  async function loadFlowsFromDb() {
    try {
      const { getSequelize } = require('../db/sequelize');
      const sequelize = getSequelize();
      if (!sequelize) return;

      const { Flow } = require('../db/models');
      const FlowModel = Flow();
      const rows = await FlowModel.findAll();

      flows.clear();
      for (const row of rows) {
        const data = row.data && typeof row.data === 'object' ? row.data : {};
        const flowObj = { ...data, id: row.id };
        if (row.tenant_key && !flowObj.tenantId) flowObj.tenantId = row.tenant_key;
        if (row.name && !flowObj.name) flowObj.name = row.name;
        flows.set(row.id, flowObj);
      }

      logger.info('[Flows] Cache inicializado do PostgreSQL', { count: flows.size });
    } catch (err) {
      logger.warn('[Flows] Falha ao carregar fluxos do PostgreSQL', { error: err.message });
    }
  }

  function persistFlowBestEffort(flow) {
    try {
      const { getSequelize } = require('../db/sequelize');
      const sequelize = getSequelize();
      if (!sequelize) return;

      const { Flow } = require('../db/models');
      const FlowModel = Flow();

      setImmediate(() => {
        const now = new Date();
        FlowModel.findByPk(flow.id)
          .then((existing) => {
            if (!flow.tenantId || typeof flow.tenantId !== 'string' || flow.tenantId.trim() === '') {
              logger.warn('[Flows] Ignorando persistência: flow sem tenantId', { flowId: flow.id });
              return null;
            }

            const payload = {
              id: flow.id,
              tenant_key: flow.tenantId,
              name: flow.name || null,
              data: flow,
              updated_at: now,
            };

            if (existing) {
              return existing.update(payload);
            }

            return FlowModel.create({ ...payload, created_at: now });
          })
          .catch((err) => {
            logger.warn('[Flows] Falha ao persistir flow no PostgreSQL', {
              flowId: flow.id,
              error: err.message,
            });
          });
      });
    } catch (_) {
      // Best-effort only.
    }
  }

  async function deleteFlowBestEffort(flowId) {
    try {
      const { getSequelize } = require('../db/sequelize');
      const sequelize = getSequelize();
      if (!sequelize) return;

      const { Flow } = require('../db/models');
      const FlowModel = Flow();
      await FlowModel.destroy({ where: { id: flowId } });
    } catch (err) {
      logger.warn('[Flows] Falha ao remover flow no PostgreSQL', { flowId, error: err.message });
    }
  }

  return {
    flows,
    sessionEvents,
    sessionTenants,
    setSessionTenant,
    getSessionTenant,
    saveSessionEventsToFile,
    saveSessionEventsToFileImmediate,
    loadFlowsFromDb,
    persistFlowBestEffort,
    deleteFlowBestEffort,
    validateFlowStructure,
    ensureFlowHasMeta,
  };
}

module.exports = {
  createFlowRuntimeState,
  validateFlowStructure,
  ensureFlowHasMeta,
};
