const CREDENTIAL_TYPES = ['biometric', 'qrcode', 'rfid', 'pin', 'mobile'];
const DEVICE_TYPES = ['turnstile', 'door', 'gate', 'reader', 'totem'];
const BILLING_STATUSES = ['active', 'grace_period', 'delinquent', 'blocked', 'cancelled', 'trial', 'visitor'];
const ANTI_PASSBACK_MODES = ['none', 'soft', 'strict'];
const EVENT_TYPES = ['decision_issued', 'entry', 'exit', 'deny', 'credential_resolved', 'visitor_qr_issued', 'device_callback'];

const REASON_CODES = {
  ALLOWED_ACTIVE: 'allowed_active',
  ALLOWED_GRACE_PERIOD: 'allowed_grace_period',
  ALLOWED_TRIAL: 'allowed_trial',
  ALLOWED_VISITOR: 'allowed_visitor',
  DENY_CREDENTIAL_NOT_FOUND: 'deny_credential_not_found',
  DENY_CREDENTIAL_INACTIVE: 'deny_credential_inactive',
  DENY_CREDENTIAL_EXPIRED: 'deny_credential_expired',
  DENY_SUBJECT_NOT_FOUND: 'deny_subject_not_found',
  DENY_SUBJECT_INACTIVE: 'deny_subject_inactive',
  DENY_MEMBERSHIP_NOT_FOUND: 'deny_membership_not_found',
  DENY_MEMBERSHIP_INACTIVE: 'deny_membership_inactive',
  DENY_BILLING_DELINQUENT: 'deny_billing_delinquent',
  DENY_BILLING_BLOCKED: 'deny_billing_blocked',
  DENY_BILLING_CANCELLED: 'deny_billing_cancelled',
  DENY_POLICY_NOT_FOUND: 'deny_policy_not_found',
  DENY_SCHEDULE_NOT_FOUND: 'deny_schedule_not_found',
  DENY_OUTSIDE_SCHEDULE_WINDOW: 'deny_outside_schedule_window',
  DENY_OUTSIDE_ALLOWED_HOURS: 'deny_outside_allowed_hours',
  DENY_WRONG_UNIT: 'deny_wrong_unit',
  DENY_ANTI_PASSBACK: 'deny_anti_passback',
  DENY_USAGE_LIMIT: 'deny_usage_limit',
  DENY_DEVICE_INACTIVE: 'deny_device_inactive',
  DENY_INVALID_DECISION: 'deny_invalid_decision',
};

module.exports = {
  CREDENTIAL_TYPES,
  DEVICE_TYPES,
  BILLING_STATUSES,
  ANTI_PASSBACK_MODES,
  EVENT_TYPES,
  REASON_CODES,
};
