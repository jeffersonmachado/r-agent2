import React from 'react';
import { EXECUTION_STATUS_LABELS, HEALTH_STATUS_LABELS, PROJECT_STATUS_LABELS, WORK_ITEM_STATUS_LABELS } from '../types/models.js';

const LABELS = {
  ...WORK_ITEM_STATUS_LABELS,
  ...EXECUTION_STATUS_LABELS,
  ...HEALTH_STATUS_LABELS,
  ...PROJECT_STATUS_LABELS,
  open: 'Open',
  reviewing: 'Reviewing',
};

export function StatusBadge({ status, tone = null }) {
  const safeStatus = String(status || 'unknown').toLowerCase();
  return (
    <span className={`wm-badge wm-badge-status ${tone ? `is-${tone}` : ''}`} data-status={safeStatus}>
      {LABELS[safeStatus] || safeStatus.replace(/_/g, ' ')}
    </span>
  );
}

export default StatusBadge;