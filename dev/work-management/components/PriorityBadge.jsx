import React from 'react';
import { PRIORITY_LABELS } from '../types/models.js';

export function PriorityBadge({ priority }) {
  const safePriority = String(priority || 'medium').toLowerCase();
  return (
    <span className="wm-badge wm-badge-priority" data-priority={safePriority}>
      {PRIORITY_LABELS[safePriority] || safePriority}
    </span>
  );
}

export default PriorityBadge;