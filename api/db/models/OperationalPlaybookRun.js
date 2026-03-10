'use strict';

const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('OperationalPlaybookRun', {
	id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
	tenant_key: { type: DataTypes.STRING(100), allowNull: false },
	playbook_id: { type: DataTypes.STRING(120), allowNull: false },
	playbook_name: { type: DataTypes.STRING(191), allowNull: false },
	contact_id: { type: DataTypes.STRING(191), allowNull: true },
	signal_id: { type: DataTypes.STRING(191), allowNull: true },
	recommendation_id: { type: DataTypes.STRING(191), allowNull: true },
	operator_id: { type: DataTypes.STRING(191), allowNull: true },
	status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'in_progress' },
	current_step_index: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
	steps_json: {
		type: DataTypes.TEXT,
		allowNull: true,
		get() { return parseJsonText(this.getDataValue('steps_json'), []); },
		set(value) { this.setDataValue('steps_json', value == null ? null : stringifyJsonText(value, [])); },
	},
	context_json: {
		type: DataTypes.TEXT,
		allowNull: true,
		get() { return parseJsonText(this.getDataValue('context_json'), {}); },
		set(value) { this.setDataValue('context_json', value == null ? null : stringifyJsonText(value, {})); },
	},
	last_error: { type: DataTypes.TEXT, allowNull: true },
	completed_at: { type: DataTypes.DATE, allowNull: true },
	aborted_at: { type: DataTypes.DATE, allowNull: true },
}, {
	tableName: 'operational_playbook_executions',
	timestamps: true,
	underscored: true,
	indexes: [
		{ fields: ['tenant_key', 'status', 'updated_at'], name: 'oper_play_exec_tenant_status_updated_idx' },
		{ fields: ['tenant_key', 'contact_id', 'updated_at'], name: 'oper_play_exec_tenant_contact_updated_idx' },
		{ fields: ['tenant_key', 'playbook_id', 'status'], name: 'oper_play_exec_tenant_playbook_status_idx' },
		{ fields: ['tenant_key', 'signal_id'], name: 'oper_play_exec_tenant_signal_idx' },
		{ fields: ['tenant_key', 'recommendation_id'], name: 'oper_play_exec_tenant_recommendation_idx' },
	],
});
