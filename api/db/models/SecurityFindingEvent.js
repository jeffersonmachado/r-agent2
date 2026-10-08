'use strict';

/**
 * Model SecurityFindingEvent — histórico append-only de um achado.
 *
 * Cada transição (DETECTED, STATUS_CHANGED, WAIVED, RESOLVED, RESCAN) é um
 * evento. Sem isso não há como responder "quando este risco apareceu, quem
 * aceitou e por quê" — que é a pergunta que uma auditoria faz.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let SecurityFindingEvent = null;

function getSecurityFindingEventModel() {
  if (!SecurityFindingEvent) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    SecurityFindingEvent = sequelize.define('SecurityFindingEvent', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_key: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      finding_key: { type: DataTypes.STRING, allowNull: false },
      advisory_id: { type: DataTypes.STRING, allowNull: true },
      event: { type: DataTypes.STRING, allowNull: false },
      from_status: { type: DataTypes.STRING, allowNull: true },
      to_status: { type: DataTypes.STRING, allowNull: true },
      from_severity: { type: DataTypes.STRING, allowNull: true },
      to_severity: { type: DataTypes.STRING, allowNull: true },
      detail: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      actor: { type: DataTypes.STRING, allowNull: true },
      scan_run_id: { type: DataTypes.UUID, allowNull: true },
    }, {
      tableName: 'security_finding_events',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['finding_key', 'created_at'], name: 'security_finding_events_finding_idx' },
      ],
    });
  }
  return SecurityFindingEvent;
}

module.exports = getSecurityFindingEventModel;
