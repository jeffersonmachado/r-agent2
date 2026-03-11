'use strict';

/**
 * Clinic Operations Adapter (Expandido)
 * 
 * Especializa o ServiceOperationsKernel para operações de clínica,
 * sem duplicar o core.
 */

const { CLINIC_EVENTS } = require('./ClinicOperationsAdapter');
const { CLINIC_DECISION_POLICIES, CLINIC_KPI_SET } = require('./ClinicOperationsAdapter');

class ClinicOperationsAdapterV2 {
  constructor(kernel) {
    if (!kernel) {
      throw new Error('ClinicOperationsAdapter requires ServiceOperationsKernel instance');
    }
    this.kernel = kernel;
    this.verticalName = 'clinic';
    this.vocabulary = this._buildVocabulary();
  }

  _buildVocabulary() {
    return {
      entities: {
        patient: 'patient',
        appointment: 'appointment',
        doctor: 'doctor',
        room: 'room',
        procedure: 'procedure',
      },
      contexts: {
        reception: 'recepção',
        consultation: 'consulta',
        exam: 'exame',
        followup: 'retorno',
      },
    };
  }

  async ingestClinicEvent({ type, payload, source = 'clinic-system', tenantId, correlationId } = {}) {
    if (!CLINIC_EVENTS[type]) {
      throw new Error(`Unknown clinic event type: ${type}`);
    }

    const normalizedPayload = {
      ...payload,
      vertical: this.verticalName,
    };

    return this.kernel.ingestEvent({
      type,
      payload: normalizedPayload,
      source,
      tenantId,
      correlationId,
    });
  }

  async generateClinicDecisions({ tenantId, eventId, eventType, eventPayload } = {}) {
    const occState = await this.kernel.occQueryService.getOccState({ tenantId });
    const eventCategory = this._classifyEvent(eventType);
    const applicablePolicies = this._selectPolicies(eventCategory, eventPayload, occState);

    const decisions = await Promise.all(
      applicablePolicies.map((policy) =>
        this.kernel.decisionEngine.decide({
          tenantId,
          eventId,
          policyId: policy.id,
          context: {
            vertical: this.verticalName,
            eventType,
            eventPayload,
            occState,
            policy,
          },
        })
      )
    );

    return decisions;
  }

  async executeClinicAction({ tenantId, actionId, actionType, parameters = {} } = {}) {
    return this.kernel.actionsService.execute({
      tenantId,
      actionId,
      actionType,
      parameters: {
        ...parameters,
        vertical: this.verticalName,
      },
    });
  }

  async recordClinicOutcome({ tenantId, eventId, decisionId, actionId, result, metrics = {} } = {}) {
    return this.kernel.outcomesService.recordOutcome({
      tenantId,
      eventId,
      decisionId,
      actionId,
      result,
      metrics: {
        ...metrics,
        vertical: this.verticalName,
      },
    });
  }

  async generateClinicSignals({ tenantId } = {}) {
    const baseSignals = await this.kernel.signalsService.generateForTenant({ tenantId });
    const clinicSignals = baseSignals.filter((signal) => this._isClinicRelevant(signal));

    return {
      baseSignals: baseSignals.length,
      clinicSignals,
      specializations: {
        noShowRiskDetected: this._detectNoShowRisk(baseSignals),
        gapFillOpportunity: this._detectGapFillOpportunity(baseSignals),
        patientChurnRisk: this._detectPatientChurnRisk(baseSignals),
      },
    };
  }

  async getClinicOperationalState({ tenantId } = {}) {
    const occState = await this.kernel.occQueryService.getOccState({ tenantId });

    return {
      schedule: this._projectSchedule(occState),
      patients: this._projectPatientState(occState),
      doctors: this._projectDoctorState(occState),
      rooms: this._projectRoomState(occState),
      kpis: this._calculateClinicKpis(occState),
    };
  }

  async listClinicQuickActions({ tenantId, context = {} } = {}) {
    const occState = await this.getClinicOperationalState({ tenantId });
    const recommendedActions = this._selectQuickActions(occState, context);

    return recommendedActions.map((action) => ({
      id: action.id,
      name: action.name,
      description: action.description,
      trigger: action.trigger,
    }));
  }

  async listClinicPlaybooks({ tenantId, scenario } = {}) {
    if (!scenario) throw new Error('Scenario required');
    return this._selectPlaybooks(scenario);
  }

  // ========== HELPERS ==========

  _classifyEvent(eventType) {
    if (eventType.includes('appointment')) return 'appointment_management';
    if (eventType.includes('no_show')) return 'no_show_management';
    if (eventType.includes('patient')) return 'patient_lifecycle';
    if (eventType.includes('followup')) return 'followup_management';
    return 'unknown';
  }

  _selectPolicies(category, payload, occState) {
    const policies = [];

    if (category === 'no_show_management' && CLINIC_DECISION_POLICIES.appointmentRescheduling) {
      policies.push(...CLINIC_DECISION_POLICIES.appointmentRescheduling.rules.map((r, i) => ({
        id: `appt_reschedule_${i}`,
        ...r,
      })));
    }

    if (category === 'appointment_management' && CLINIC_DECISION_POLICIES.gapFilling) {
      policies.push(...CLINIC_DECISION_POLICIES.gapFilling.rules.map((r, i) => ({
        id: `gap_fill_${i}`,
        ...r,
      })));
    }

    return policies;
  }

  _isClinicRelevant(signal) {
    return signal.contexts?.some((c) => Object.values(this.vocabulary.contexts).includes(c));
  }

  _detectNoShowRisk(_signals) {
    return { detected: false, confidence: 0, affectedAppointments: 0 };
  }

  _detectGapFillOpportunity(_signals) {
    return { detected: false, confidence: 0, availableSlots: 0 };
  }

  _detectPatientChurnRisk(_signals) {
    return { detected: false, confidence: 0, affectedPatients: 0 };
  }

  _projectSchedule(occState) {
    return { totalSlots: 0, bookedSlots: 0, availableSlots: 0, fillRate: 0 };
  }

  _projectPatientState(occState) {
    return { active: 0, atRisk: 0, reactivationEligible: 0, noShowRisk: 0 };
  }

  _projectDoctorState(occState) {
    return { total: 0, availableNow: 0, totalHours: 0, utilization: 0 };
  }

  _projectRoomState(occState) {
    return { total: 0, available: 0, inUse: 0 };
  }

  _calculateClinicKpis(occState) {
    return {
      scheduleFillRate: 0,
      noShowRate: 0,
      avgWaitTime: 0,
      patientRetention: 0,
      revenuePerDoctor: 0,
    };
  }

  _selectQuickActions(occState, context) {
    const actions = [];

    if (occState.schedule?.availableSlots > 5) {
      actions.push({
        id: 'gap_fill_campaign',
        name: 'Campanha de Preenchimento de Gaps',
        description: 'Slots disponíveis para preencher',
        trigger: 'gap_opportunity',
      });
    }

    if (occState.patients?.noShowRisk > 10) {
      actions.push({
        id: 'confirmation_calls',
        name: 'Chamadas de Confirmação',
        description: 'Confirmar agendamentos em risco',
      });
    }

    return actions;
  }

  _selectPlaybooks(scenario) {
    const playbookMap = {
      no_show_prevention: [
        { id: 'confirmation_reminder', name: 'Lembrete de Confirmação' },
      ],
      gap_filling: [
        { id: 'gap_fill_offer', name: 'Oferta de Preenchimento' },
      ],
      patient_retention: [
        { id: 'followup_scheduling', name: 'Agendamento de Retorno' },
      ],
    };

    return playbookMap[scenario] || [];
  }
}

module.exports = {
  ClinicOperationsAdapterV2,
};
