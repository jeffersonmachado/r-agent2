const colorByStatus = {
  active: 'status status-active',
  warning: 'status status-warning',
  running: 'status status-running',
  pending: 'status status-pending',
  executing: 'status status-running',
  success: 'status status-success',
  failure: 'status status-failure'
};

export default function StatusBadge({ status }) {
  return <span className={colorByStatus[status] || 'status'}>{status || 'unknown'}</span>;
}
