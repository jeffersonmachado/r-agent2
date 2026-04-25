export const WORK_MANAGEMENT_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'projects', label: 'Projects' },
  { id: 'board', label: 'Board' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'deliverables', label: 'Deliverables' },
  { id: 'operations', label: 'Operations' },
  { id: 'qa-validation', label: 'QA & Validation' },
  { id: 'documents', label: 'Documents' },
  { id: 'team', label: 'Team' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'ai-suggestions', label: 'AI Suggestions' },
];

export const WORK_ITEM_STATUS_LABELS = {
  backlog: 'Backlog',
  planned: 'Planned',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  review: 'In Review',
  validated: 'Validated',
  done: 'Done',
};

export const PRIORITY_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const EXECUTION_STATUS_LABELS = {
  passed: 'Passed',
  failed: 'Failed',
  warning: 'Warning',
  running: 'Running',
};

export const HEALTH_STATUS_LABELS = {
  healthy: 'Healthy',
  warning: 'Warning',
  degraded: 'Degraded',
  critical: 'Critical',
};

export const PROJECT_STATUS_LABELS = {
  active: 'Active',
  attention: 'Needs Attention',
  on_track: 'On Track',
  rollout: 'Rollout',
};

export const FILTER_PERIODS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];

export const BOARD_COLUMNS = ['backlog', 'planned', 'in_progress', 'blocked', 'review', 'validated', 'done'];

export const DEFAULT_FILTERS = {
  period: '30d',
  project: 'all',
  tenant: 'all',
  environment: 'all',
  channel: 'all',
  status: 'all',
};

export function labelForStatus(status) {
  return WORK_ITEM_STATUS_LABELS[status] || status || '-';
}

export function labelForPriority(priority) {
  return PRIORITY_LABELS[priority] || priority || '-';
}

export function labelForExecutionStatus(status) {
  return EXECUTION_STATUS_LABELS[status] || status || '-';
}