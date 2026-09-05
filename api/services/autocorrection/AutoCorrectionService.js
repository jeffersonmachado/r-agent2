'use strict';

const {
  AutoCorrectionRun,
  AutoCorrectionAction,
  Evidence,
  WorkspaceInsight,
  WorkspaceAction,
  WorkspaceEntityLink,
} = require('../../db/models');
const FailureDiagnosisService = require('./FailureDiagnosisService');
const PatchProposalService = require('./PatchProposalService');
const CorrectionValidationService = require('./CorrectionValidationService');
const { toPlain, safeString } = require('../workspace/workspaceUtils');

const ACCEPTED_FAILURE_SOURCES = new Set(['evidence', 'rpa_insight', 'smoke_test_failed', 'wave_failed', 'api_error_recurrent', 'qa_mesh_governance']);

class AutoCorrectionService {
  constructor(deps = {}) {
    this.AutoCorrectionRun = deps.AutoCorrectionRun || AutoCorrectionRun;
    this.AutoCorrectionAction = deps.AutoCorrectionAction || AutoCorrectionAction;
    this.Evidence = deps.Evidence || Evidence;
    this.WorkspaceInsight = deps.WorkspaceInsight || WorkspaceInsight;
    this.WorkspaceAction = deps.WorkspaceAction || WorkspaceAction;
    this.WorkspaceEntityLink = deps.WorkspaceEntityLink || WorkspaceEntityLink;
    this.timelineService = deps.timelineService;
    this.failureDiagnosisService = deps.failureDiagnosisService || new FailureDiagnosisService(deps);
    this.patchProposalService = deps.patchProposalService || new PatchProposalService(deps);
    this.correctionValidationService = deps.correctionValidationService || new CorrectionValidationService(deps);
    this.logger = deps.logger || console;
  }

  normalizeSourceType(value, event = {}) {
    const raw = safeString(value || event?.payload?.autocorrectionSource || event?.type).trim().toLowerCase();
    if (raw === 'evidence') return 'evidence';
    if (raw === 'qa_mesh_governance') return 'qa_mesh_governance';
    if (/wave/.test(raw)) return 'wave_failed';
    if (/smoke/.test(raw)) return 'smoke_test_failed';
    if (/api/.test(raw)) return 'api_error_recurrent';
    if (/rpa|qa/.test(raw)) return 'rpa_insight';
    return raw;
  }

  isFailureEvent(event = {}) {
    const text = `${event.summary || ''} ${JSON.stringify(event.payload || {})}`.toLowerCase();
    return /falha|erro|failed|failure|error|bug|regression/.test(text);
  }

  async loadEvidence(tenantId, sourceId) {
    if (!tenantId || !sourceId) return null;
    const row = await this.Evidence().findOne({ where: { tenant_key: tenantId, id: sourceId } }).catch(() => null);
    return toPlain(row);
  }

  async findExistingRun({ tenantId, sourceType, sourceId }) {
    const row = await this.AutoCorrectionRun().findOne({
      where: { tenant_id: tenantId, source_type: sourceType, source_id: sourceId },
      order: [['created_at', 'DESC']],
    });
    return toPlain(row);
  }

  async persistWorkspaceArtifacts({ tenantId, entityId, run, diagnosis, proposal, validation }) {
    const insightDescription = `Falha QA/RPA detectada com correção técnica sugerida: ${diagnosis.rootCause}`;

    const existingInsight = await this.WorkspaceInsight().findOne({
      where: { tenant_id: tenantId, entity_id: entityId, type: 'autocorrection_failure', description: insightDescription, source: 'AUTO_CORRECTION' },
    });
    if (!existingInsight) {
      await this.WorkspaceInsight().create({
        tenant_id: tenantId,
        entity_id: entityId,
        type: 'autocorrection_failure',
        description: insightDescription,
        confidence: diagnosis.confidence || 0.8,
        source: 'AUTO_CORRECTION',
      });
    }

    const existingAction = await this.WorkspaceAction().findOne({
      where: { tenant_id: tenantId, entity_id: entityId, type: 'autocorrection_review', status: 'pending' },
      order: [['created_at', 'DESC']],
    });
    if (!existingAction) {
      await this.WorkspaceAction().create({
        tenant_id: tenantId,
        entity_id: entityId,
        type: 'autocorrection_review',
        status: 'pending',
        payload: {
          title: 'Correção técnica sugerida',
          runId: run.id,
          diagnosis,
          proposedPatch: proposal,
          validation,
          approvalRequired: true,
        },
      });
    }

    await this.WorkspaceEntityLink().findOrCreate({
      where: { tenant_id: tenantId, source_type: 'autocorrection_run', source_id: run.id },
      defaults: { tenant_id: tenantId, entity_id: entityId, source_type: 'autocorrection_run', source_id: run.id, confidence: diagnosis.confidence || 0.8 },
    });
  }

  async createRunForFailure({ tenantId, entityId, event, sourceType, sourceId, timeline = [] }) {
    const normalizedSourceType = this.normalizeSourceType(sourceType, event);
    if (!ACCEPTED_FAILURE_SOURCES.has(normalizedSourceType) && normalizedSourceType !== 'evidence') return null;

    const existing = await this.findExistingRun({ tenantId, sourceType: normalizedSourceType, sourceId });
    if (existing) return existing;

    const evidence = normalizedSourceType === 'evidence' ? await this.loadEvidence(tenantId, sourceId) : null;
    const diagnosis = await this.failureDiagnosisService.analyzeFailure({ tenantId, sourceType: normalizedSourceType, sourceId, event, evidence, timeline });
    const proposedPatch = await this.patchProposalService.proposePatch({ diagnosis, sourceType: normalizedSourceType, sourceId, event, evidence });
    const validationResult = await this.correctionValidationService.validateProposal({ proposal: proposedPatch, diagnosis, sourceType: normalizedSourceType, sourceId });

    const run = toPlain(await this.AutoCorrectionRun().create({
      tenant_id: tenantId,
      source_type: normalizedSourceType,
      source_id: sourceId,
      status: 'awaiting_human_approval',
      diagnosis,
      proposed_patch: proposedPatch,
      validation_result: validationResult,
    }));

    await this.AutoCorrectionAction().create({
      run_id: run.id,
      type: 'human_review',
      status: 'pending',
      payload: {
        label: 'Correção técnica sugerida',
        approvalRequired: true,
        sourceType: normalizedSourceType,
        sourceId,
      },
    });

    await this.persistWorkspaceArtifacts({ tenantId, entityId, run, diagnosis, proposal: proposedPatch, validation: validationResult });
    return run;
  }

  async ensureForEntityFailures({ tenantId, entityId, timeline = null }) {
    const resolvedTimeline = timeline || (await this.timelineService.getEntityTimeline({ tenantId, entityId, limit: 100, offset: 0, internal: true }));
    const items = resolvedTimeline?.items || [];
    const failedEvents = items.filter((event) => event.type === 'evidence' && this.isFailureEvent(event));

    const runs = [];
    for (const event of failedEvents) {
      const run = await this.createRunForFailure({
        tenantId,
        entityId,
        event,
        sourceType: 'evidence',
        sourceId: event.refId,
        timeline: items,
      });
      if (run) runs.push(run);
    }
    return runs;
  }

  async listRunsForEntity({ tenantId, entityId, limit = 20 }) {
    const links = await this.WorkspaceEntityLink().findAll({
      where: { tenant_id: tenantId, entity_id: entityId, source_type: 'autocorrection_run' },
      order: [['created_at', 'DESC']],
      limit: 200,
    });
    const ids = links.map((item) => item.source_id).filter(Boolean);
    if (!ids.length) return { items: [], total: 0 };

    const runs = await this.AutoCorrectionRun().findAll({
      where: { tenant_id: tenantId, id: ids },
      order: [['created_at', 'DESC']],
      limit,
    });
    const actions = await this.AutoCorrectionAction().findAll({ where: { run_id: ids }, order: [['created_at', 'DESC']] });
    const grouped = actions.reduce((acc, item) => {
      const plain = toPlain(item);
      if (!acc[plain.run_id]) acc[plain.run_id] = [];
      acc[plain.run_id].push(plain);
      return acc;
    }, {});

    const items = runs.map(toPlain).map((run) => ({ ...run, actions: grouped[run.id] || [] }));
    return { items, total: items.length };
  }
}

module.exports = AutoCorrectionService;