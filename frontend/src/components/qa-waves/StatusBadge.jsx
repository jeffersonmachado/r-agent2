import React from 'react';

export function StatusBadge({ status }) {
  const normalized = String(status || 'pending').toLowerCase();
  const safeStatus = ['success', 'failure', 'executing', 'pending'].includes(normalized)
    ? normalized
    : 'pending';

  return (
    <span className="qa-status-badge" data-status={safeStatus}>
      {safeStatus}
    </span>
  );
}

export default StatusBadge;
