/**
 * Model AuditReport - Relatórios de auditoria gerados
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let AuditReport = null;

function getAuditReportModel() {
  if (!AuditReport) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        }
      });
    }

    AuditReport = sequelize.define('AuditReport', {
      report_id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      audit_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      generated_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      format: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'json',
      },
      data: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      text: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    }, {
      tableName: 'audit_reports',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['audit_id', 'generated_at'], name: 'audit_reports_audit_id_generated_at_idx' },
        { fields: ['generated_at'], name: 'audit_reports_generated_at_idx' },
      ],
    });
  }

  return AuditReport;
}

module.exports = getAuditReportModel;

