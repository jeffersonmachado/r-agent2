'use strict';
const { getGovernanceModel, uuid, json, DataTypes } = require('./governanceModelFactory');
module.exports = () => getGovernanceModel('GovernanceRun', {
  id: uuid, run_id: { type: DataTypes.STRING, allowNull: false, unique: true },
  source_fingerprint: { type: DataTypes.STRING(64), allowNull: false }, status: { type: DataTypes.STRING, allowNull: false },
  scope_type: { type: DataTypes.STRING, allowNull: false }, tenant_id: { type: DataTypes.STRING, allowNull: true },
  principal_type: { type: DataTypes.STRING, allowNull: false }, principal_id: { type: DataTypes.STRING, allowNull: false },
  policy_id: DataTypes.STRING, policy_version: DataTypes.STRING, policy_fingerprint: DataTypes.STRING(64),
  git_commit: DataTypes.STRING, branch: DataTypes.STRING, started_at: { type: DataTypes.DATE, allowNull: false },
  completed_at: DataTypes.DATE, invalidated_at: DataTypes.DATE, invalidated_reason: DataTypes.TEXT, metadata: json,
}, { tableName: 'governance_runs', indexes: [{ fields: ['status', 'scope_type'], name: 'governance_runs_status_scope_idx' }] });