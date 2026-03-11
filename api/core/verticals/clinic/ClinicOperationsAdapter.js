'use strict';

const CLINIC_EVENTS = Object.freeze({
  'clinic:appointment.created': { priority: 'high', triggers: ['confirmation_scheduling'] },
  'clinic:appointment.confirmed': { priority: 'high', triggers: ['doctor_sync', 'appointment_reminder'] },
  'clinic:appointment.cancelled': { priority: 'medium', triggers: ['slot_release', 'reschedule_offer'] },
  'clinic:appointment.no_show': { priority: 'high', triggers: ['gap_filling', 'retention_outreach'] },
  'clinic:appointment.checked_in': { priority: 'medium', triggers: ['queue_management'] },
  'clinic:appointment.completed': { priority: 'high', triggers: ['followup_scheduling', 'satisfaction_survey'] },
  'clinic:exam.requested': { priority: 'medium', triggers: ['lab_scheduling'] },
  'clinic:exam.completed': { priority: 'high', triggers: ['doctor_notification', 'patient_notification'] },
  'clinic:patient.followup_due': { priority: 'high', triggers: ['followup_campaign'] },
  'clinic:patient.reactivation_due': { priority: 'medium', triggers: ['reactivation_campaign'] },
  'clinic:appointment.no_show_risk': { priority: 'high', triggers: ['confirmation_call', 'reschedule_offer'] },
});

const CLINIC_DECISION_POLICIES = Object.freeze({
  appointmentRescheduling: {
    rules: [
      { condition: 'slot_available && patient_eligible', decision: 'auto_reschedule' },
      { condition: 'no_show_risk_high', decision: 'send_confirmation_reminder' },
    ],
  },
  gapFilling: {
    rules: [
      { condition: 'available_slot && patient_waiting', decision: 'offer_early_slot' },
      { condition: 'doctor_idle_time', decision: 'administrative_work_suggestion' },
    ],
  },
  patientRetention: {
    rules: [
      { condition: 'followup_due && not_scheduled', decision: 'send_followup_reminder' },
      { condition: 'inactivity_60days', decision: 'send_reactivation_campaign' },
    ],
  },
});

const CLINIC_KPI_SET = Object.freeze({
  schedule_fill_rate: { target: 85, alert: { low: 70 }, unit: '%' },
  no_show_rate: { target: 5, alert: { high: 10 }, unit: '%' },
  average_wait_time: { target: 15, alert: { warning: 25, critical: 40 }, unit: 'min' },
  patient_retention: { target: 90, alert: { low: 80 }, unit: '%' },
  followup_compliance: { target: 75, alert: { low: 60 }, unit: '%' },
  revenue_per_doctor: { target: 5000, alert: { low: 4000 }, unit: 'BRL' },
});

class ClinicOperationsAdapter {
  constructor(kernel) {
    this.kernel = kernel;
    this.verticalName = 'clinic';
  }

  async ingestClinicEvent({ type, payload, tenantId }) {
    return this.kernel.ingestEvent({
      type,
      payload: { ...payload, vertical: this.verticalName },
      tenantId,
    });
  }

  async generateClinicDecisions({ tenantId, eventType, eventPayload }) {
    return this.kernel.decisionEngine.decide({
      tenantId,
      context: {
        vertical: this.verticalName,
        eventType,
        eventPayload,
      },
    });
  }

  async getClinicOperationalState({ tenantId }) {
    const occState = await this.kernel.occQueryService.getOccState({ tenantId });
    return {
      schedule: this._projectSchedule(occState),
      patients: this._projectPatientState(occState),
      doctors: this._projectDoctorState(occState),
      kpis: this._calculateKpis(occState),
    };
  }

  _projectSchedule(occState) {
    return { totalSlots: 0, bookedSlots: 0, availableSlots: 0 };
  }

  _projectPatientState(occState) {
    return { active: 0, atRisk: 0, reactivationEligible: 0 };
  }

  _projectDoctorState(occState) {
    return { total: 0, availableNow: 0, totalHours: 0 };
  }

  _calculateKpis(occState) {
    return CLINIC_KPI_SET;
  }
}

module.exports = {
  ClinicOperationsAdapter,
  CLINIC_EVENTS,
  CLINIC_DECISION_POLICIES,
  CLINIC_KPI_SET,
};
