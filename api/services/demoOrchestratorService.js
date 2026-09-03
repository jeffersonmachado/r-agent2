'use strict';

const fs = require('fs');
const path = require('path');

const logger = require('../utils/logger');
const { listJourneys, listJourneyStatus, listStepStatus } = require('./qaWavesService');
const { listLatestScenarios } = require('./qaWavesScenarioService');
const { listReplayFiles, getReplayFile, createExecution } = require('./testExecutionService');
const { listAllTickets, getMetrics } = require('./queueService');
const { createWorkspaceService } = require('../modules/workspace/workspace.service');
const { normalizeTenantKey } = require('../../lib/rpaSecurity');

const ROOT_DIR = path.join(__dirname, '..', '..');
const DEMO_SEEDS_DIR = path.join(ROOT_DIR, 'qa', 'demo-seeds');
const SUPPORTED_VERTICALS = new Set(['fitness', 'beauty', 'bakery']);

const DEMO_SEED_BY_VERTICAL = {
  fitness: 'fitness-aula-experimental.json',
  beauty: 'beauty-agendamento-servico.json',
  bakery: 'bakery-balcao-retirada.json',
};

function normalizeVertical(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SUPPORTED_VERTICALS.has(normalized) ? normalized : 'fitness';
}

function readJsonFileIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function loadDemoSeed(vertical) {
  const fileName = DEMO_SEED_BY_VERTICAL[vertical] || DEMO_SEED_BY_VERTICAL.fitness;
  return readJsonFileIfExists(path.join(DEMO_SEEDS_DIR, fileName));
}

async function loadCrmSnapshot(tenantId, limit = 5) {
  try {
    const getModel = require('../db/models/MarketingLead');
    const Model = typeof getModel === 'function' ? getModel() : getModel;
    if (!Model || !Model.findAll) {
      return { leads: [], leadCount: 0 };
    }

    const rows = await Model.findAll({
      where: { tenant_key: String(tenantId || 'system') },
      order: [['updated_at', 'DESC']],
      limit,
    });

    const leads = (rows || []).map((row) => {
      const data = row.toJSON ? row.toJSON() : row;
      return {
        id: data.id,
        name: data.name || null,
        email: data.email || null,
        phone: data.phone || null,
        stage: data.stage || 'new',
        score: Number(data.score || 0),
        updatedAt: data.updated_at || null,
      };
    });

    return {
      leads,
      leadCount: leads.length,
    };
  } catch (error) {
    logger.warn('[DemoOrchestrator] CRM snapshot fallback', { error: error.message });
    return { leads: [], leadCount: 0 };
  }
}

async function loadWorkspaceSnapshot(tenantId, workspaceEntityIdHint = null) {
  try {
    const workspaceService = createWorkspaceService();
    const entitiesPayload = await workspaceService.listEntities(String(tenantId || 'system'), {
      limit: 10,
      offset: 0,
    });

    const entities = Array.isArray(entitiesPayload?.items) ? entitiesPayload.items : [];
    const selectedEntity = workspaceEntityIdHint
      ? entities.find((item) => String(item.id) === String(workspaceEntityIdHint)) || entities[0]
      : entities[0];

    if (!selectedEntity) {
      return {
        entity: null,
        timeline: { items: [], total: 0, hasMore: false },
        insights: { items: [], persisted: [] },
      };
    }

    const [timeline, insights] = await Promise.all([
      workspaceService.getTimeline(String(tenantId || 'system'), selectedEntity.id, { limit: 20, offset: 0 }),
      workspaceService.getInsights(String(tenantId || 'system'), selectedEntity.id),
    ]);

    return {
      entity: selectedEntity,
      timeline: timeline || { items: [], total: 0, hasMore: false },
      insights: insights || { items: [], persisted: [] },
    };
  } catch (error) {
    logger.warn('[DemoOrchestrator] Workspace snapshot fallback', { error: error.message });
    return {
      entity: null,
      timeline: { items: [], total: 0, hasMore: false },
      insights: { items: [], persisted: [] },
    };
  }
}

function resolveJourneyDomain(journeysPayload, vertical) {
  const domains = Array.isArray(journeysPayload?.domains)
    ? journeysPayload.domains
    : (Array.isArray(journeysPayload) ? journeysPayload : []);
  return domains.find((domain) => String(domain?.id || '').toLowerCase() === vertical) || domains[0] || null;
}

function pickJourney(domain, preferredJourneyId = null) {
  const journeys = Array.isArray(domain?.journeys) ? domain.journeys : [];
  if (preferredJourneyId) {
    const byId = journeys.find((journey) => String(journey?.journeyId || '') === String(preferredJourneyId));
    if (byId) return byId;
  }
  return journeys[0] || null;
}

function buildCommercialTimeline({ seed, qa, ticket, crmLead, replayId }) {
  const baseDate = new Date().toISOString();
  const items = [];
  let order = 0;

  function push(type, source, summary, createdAt = baseDate, extra = {}) {
    order += 1;
    items.push({
      id: `demo-event-${order}`,
      type,
      source,
      summary,
      createdAt,
      ...extra,
    });
  }

  push('message', 'customer', `Entrada do cliente: ${seed?.initialIntent || 'contato inicial'}`);
  push('conversation', 'ai', `Intencao detectada: ${seed?.expectedOutcome?.intent || seed?.initialIntent || 'n/a'}`);
  push('task', 'ai', `Decisao da IA: ${seed?.expectedOutcome?.nextBestAction || 'rotear para atendimento'}`);

  if (ticket?.id) {
    push('ticket', 'support', `Ticket criado: ${ticket.id}`);
  }

  if (crmLead?.id) {
    push('lead', 'crm', `Lead criado/atualizado: ${crmLead.name || crmLead.id}`);
  }

  push('schedule', 'automation', `Agendamento: ${seed?.expectedOutcome?.appointmentStatus || 'confirmado'}`);
  push('project', 'automation', `Automacao executada: ${seed?.expectedOutcome?.automation || 'workflow_operacional'}`);
  push('evidence', 'qa', `QA validado: ${qa?.goNoGo || 'NO_GO'}`);

  if (replayId) {
    push('evidence', 'replay', `Replay gerado: ${replayId}`);
  }

  return {
    items,
    total: items.length,
    hasMore: false,
  };
}

function mapStepStatuses(stepStatusPayload, journeyId) {
  const allItems = Array.isArray(stepStatusPayload?.items)
    ? stepStatusPayload.items
    : (Array.isArray(stepStatusPayload) ? stepStatusPayload : []);
  return allItems.filter((step) => String(step?.journeyId || '') === String(journeyId || ''));
}

function pickQaScenario(scenariosPayload, seed) {
  const scenarios = Array.isArray(scenariosPayload?.items)
    ? scenariosPayload.items
    : (Array.isArray(scenariosPayload) ? scenariosPayload : []);

  if (seed?.journey?.scenarioId) {
    const bySeedScenarioId = scenarios.find((scenario) => String(scenario?.id || '') === String(seed.journey.scenarioId));
    if (bySeedScenarioId) return bySeedScenarioId;
  }

  return scenarios[0] || null;
}

function pickReplayForScenario(replayList, scenario) {
  const files = Array.isArray(replayList?.files) ? replayList.files : [];
  if (!scenario) return files[0] || null;
  const scenarioId = String(scenario.id || '');
  const candidate = files.find((item) => String(item?.scenarioId || '') === scenarioId);
  return candidate || files[0] || null;
}

function buildDemoIndicators({ crm, tickets, qa, seed, replay }) {
  const totalTickets = Number(tickets?.total || tickets?.tickets?.length || 0);
  const leads = Number(crm?.leadCount || crm?.leads?.length || 0);
  const confidence = Number(seed?.expectedOutcome?.confidence || 0.91);
  const coverage = Number(qa?.coverage || 0);

  return {
    leadsGenerated: leads,
    ticketsCreated: totalTickets,
    sla: seed?.expectedOutcome?.sla || '92%',
    iaConfidence: `${Math.round(confidence * 100)}%`,
    qaHealth: qa?.goNoGo || 'NO_GO',
    replayStatus: replay?.replayId ? 'ready' : 'pending',
    conversion: seed?.expectedOutcome?.conversion || '37%',
    automationsExecuted: seed?.expectedOutcome?.automationsExecuted || 3,
    roiEstimated: seed?.expectedOutcome?.roiEstimated || 'R$ 18.400/m',
    coverage,
  };
}

function createDemoOrchestratorService() {
  return {
    async getState({ vertical, auth, tenantId: requestedTenantId }) {
      const selectedVertical = normalizeVertical(vertical);
      const tenantId = normalizeTenantKey(requestedTenantId || auth?.agent?.tenantId || auth?.agent?.tenant_id);
      const seed = loadDemoSeed(selectedVertical);

      const [journeysPayload, journeyStatusPayload, scenariosPayload, replayList, ticketsPayload, queueMetrics, crmSnapshot, workspaceSnapshot] = await Promise.all([
        Promise.resolve(listJourneys(tenantId)),
        Promise.resolve(listJourneyStatus(tenantId)),
        Promise.resolve(listLatestScenarios({ vertical: selectedVertical, tenantId })),
        Promise.resolve(listReplayFiles({ limit: 80, offset: 0, source: 'qa_waves', tenantId })),
        Promise.resolve(listAllTickets({ tenantId, limit: 200, offset: 0 })),
        Promise.resolve(getMetrics({ tenantId })),
        loadCrmSnapshot(tenantId, 5),
        loadWorkspaceSnapshot(tenantId, seed?.workspace?.entityId || null),
      ]);

      const domain = resolveJourneyDomain(journeysPayload, selectedVertical);
      const selectedJourney = pickJourney(domain, seed?.journey?.id || null);
      const stepStatusPayload = selectedJourney
        ? await Promise.resolve(listStepStatus({ journeyId: selectedJourney.journeyId, tenantId }))
        : { items: [] };
      const stepStatuses = mapStepStatuses(stepStatusPayload, selectedJourney?.journeyId || null);

      const selectedScenario = pickQaScenario(scenariosPayload, seed);
      const replaySummary = pickReplayForScenario(replayList, selectedScenario);
      const replayId = replaySummary?.replayId || null;
      const replayDetails = replayId ? getReplayFile(`${replayId}.json`, tenantId) : null;
      const firstTicket = Array.isArray(ticketsPayload?.tickets) ? ticketsPayload.tickets[0] : null;
      const firstLead = Array.isArray(crmSnapshot?.leads) ? crmSnapshot.leads[0] : null;

      const journeyStatuses = Array.isArray(journeyStatusPayload?.items)
        ? journeyStatusPayload.items
        : (Array.isArray(journeyStatusPayload) ? journeyStatusPayload : []);
      const selectedJourneyStatus = selectedJourney
        ? journeyStatuses.find((item) => String(item?.journeyId || '') === String(selectedJourney.journeyId)) || selectedJourney
        : null;

      const qaCoverage = Number(selectedJourneyStatus?.executedRate || selectedJourneyStatus?.successRate || 0);
      const qaGoNoGo = String(selectedJourneyStatus?.status || 'WARNING').toUpperCase() === 'GO' ? 'GO' : 'NO_GO';

      const qaSnapshot = {
        journey: selectedJourney || null,
        journeyStatus: selectedJourneyStatus || null,
        stepStatuses,
        wave: selectedScenario?.waveId || seed?.journey?.waveId || 'n/a',
        stage: selectedJourney?.journeyName || selectedJourney?.journeyId || 'n/a',
        coverage: qaCoverage,
        gaps: Math.max(0, stepStatuses.filter((step) => Number(step?.riskScore || 0) >= 50).length),
        goNoGo: qaGoNoGo,
        replayLinked: replayId,
        evidenceCount: Array.isArray(replayDetails?.typedEntries) ? replayDetails.typedEntries.length : 0,
      };

      const timeline = buildCommercialTimeline({
        seed,
        qa: qaSnapshot,
        ticket: firstTicket,
        crmLead: firstLead,
        replayId,
      });

      const indicators = buildDemoIndicators({
        crm: crmSnapshot,
        tickets: ticketsPayload,
        qa: qaSnapshot,
        seed,
        replay: replaySummary,
      });

      return {
        demo: {
          flag: true,
          vertical: selectedVertical,
          tenantId: seed?.tenant?.id || tenantId,
          tenantName: seed?.tenant?.name || 'Tenant Demo',
          generatedAt: new Date().toISOString(),
        },
        executiveSummary: {
          title: seed?.headline || 'RAP Commercial Demo',
          subtitle: seed?.summary || 'Cliente -> IA -> Operacao -> Automacao -> Resultado -> QA -> Replay',
        },
        journey: {
          active: selectedJourney,
          qaJourneyStatus: selectedJourneyStatus,
          qaStepStatuses: stepStatuses,
          scenario: selectedScenario,
        },
        timeline,
        ai: {
          intent: seed?.initialIntent || firstTicket?.intent || 'solicitacao_comercial',
          confidence: indicators.iaConfidence,
          nextBestAction: seed?.expectedOutcome?.nextBestAction || 'encaminhar para atendimento especializado',
        },
        support: {
          metrics: queueMetrics || null,
          ticket: firstTicket || null,
        },
        crm: {
          leadCount: crmSnapshot?.leadCount || 0,
          leads: crmSnapshot?.leads || [],
        },
        automation: {
          mode: seed?.expectedOutcome?.automationMode || 'autonomous',
          automationsExecuted: indicators.automationsExecuted,
          outcome: seed?.expectedOutcome?.automation || 'workflow_operacional',
        },
        qaWaves: qaSnapshot,
        replay: {
          replayId,
          summary: replaySummary || null,
          details: replayDetails || null,
        },
        workspace: workspaceSnapshot,
        indicators,
        seed: seed || null,
      };
    },

    async runDemo({ vertical, auth, tenantId: requestedTenantId }) {
      const selectedVertical = normalizeVertical(vertical);
      const tenantId = normalizeTenantKey(requestedTenantId || auth?.agent?.tenantId || auth?.agent?.tenant_id);
      const state = await this.getState({ vertical: selectedVertical, auth, tenantId });

      const scenarioId = state?.journey?.scenario?.id;
      if (!scenarioId) {
        const err = new Error('No scenario available for selected demo vertical');
        err.code = 'NOT_FOUND';
        throw err;
      }

      const seedId = state?.seed?.qaAssertions?.seedId || null;
      const execution = await createExecution(
        {
          source: 'qa_waves',
          scenarioIds: [scenarioId],
          seedIds: seedId ? [seedId] : [],
          mode: 'real',
          replay: true,
          demo: {
            enabled: true,
            vertical: selectedVertical,
          },
        },
        {
          authToken: auth?.token || null,
          tenantId,
          agentId: auth?.agent?.id || null,
        }
      );

      return {
        status: 'queued',
        vertical: selectedVertical,
        scenarioId,
        seedId,
        execution,
      };
    },
  };
}

module.exports = {
  createDemoOrchestratorService,
  normalizeVertical,
};
