'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let OperationalEvent = null;

const DEFAULT_OPERATIONAL_EVENTS_TABLE = 'crm_events';
const OPERATIONAL_EVENTS_TABLE = String(
	process.env.OPERATIONAL_EVENTS_TABLE
	|| process.env.OPERATIONAL_EVENT_TABLE
	|| DEFAULT_OPERATIONAL_EVENTS_TABLE,
).trim() || DEFAULT_OPERATIONAL_EVENTS_TABLE;

function getOperationalEventModel() {
	if (!OperationalEvent) {
		const sequelize = getSequelize();
		if (!sequelize) {
			return new Proxy({}, {
				get: () => {
					throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
				},
			});
		}

		OperationalEvent = sequelize.define('OperationalEvent', {
			id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
			tenant_key: { type: DataTypes.STRING, allowNull: false },
			tenantId: { type: DataTypes.STRING, allowNull: true, field: 'tenant_id' },
			source_event_id: { type: DataTypes.STRING, allowNull: true },
			event_type: { type: DataTypes.STRING, allowNull: false },
			correlation_id: { type: DataTypes.STRING, allowNull: true },
			subject_type: { type: DataTypes.STRING, allowNull: true },
			subject_id: { type: DataTypes.STRING, allowNull: true },
			payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
			occurred_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
		}, {
			tableName: OPERATIONAL_EVENTS_TABLE,
			timestamps: true,
			underscored: true,
			indexes: [
				{ fields: ['tenant_key', 'event_type', 'occurred_at'], name: `${OPERATIONAL_EVENTS_TABLE}_tenant_type_occurred_idx` },
				{ fields: ['tenant_key', 'correlation_id', 'occurred_at'], name: `${OPERATIONAL_EVENTS_TABLE}_tenant_correlation_occurred_idx` },
				{ fields: ['tenant_key', 'subject_type', 'subject_id', 'occurred_at'], name: `${OPERATIONAL_EVENTS_TABLE}_tenant_subject_occurred_idx` },
			],
		});
	}

	return OperationalEvent;
}

module.exports = getOperationalEventModel;
