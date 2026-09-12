/**
 * Model ExecutionJob - execution_jobs (tenant_key-based)
 *
 * DB-first execution queue for internal jobs (not outbound messaging).
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let ExecutionJob = null;

function getExecutionJobModel() {
  if (!ExecutionJob) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    ExecutionJob = sequelize.define('ExecutionJob', {
      id: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      kind: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
      priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      max_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 },
      next_attempt_at: { type: DataTypes.DATE, allowNull: false },
      processing_at: { type: DataTypes.DATE, allowNull: true },
      processing_by: { type: DataTypes.STRING, allowNull: true },
      last_error: { type: DataTypes.TEXT, allowNull: true },
      idempotency_key: { type: DataTypes.STRING, allowNull: true },
    }, {
      tableName: 'execution_jobs',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'status', 'next_attempt_at'], name: 'execution_jobs_tenant_status_next_attempt_idx' },
        { fields: ['tenant_key', 'kind', 'idempotency_key'], name: 'execution_jobs_tenant_kind_idempotency_uq', unique: true },
        // Índice do claim do worker: a query reivindica o próximo job pendente
        // SEM filtro por tenant, então o índice composto acima (tenant_key à
        // frente) não era utilizável e o plano caía em varredura completa de
        // `execution_jobs` (milissegundos → segundos por claim). Parcial em
        // `status = 'pending'` mantém o índice pequeno mesmo com histórico
        // grande de jobs finalizados.
        {
          fields: [{ name: 'priority', order: 'DESC' }, { name: 'next_attempt_at', order: 'ASC' }],
          where: { status: 'pending' },
          name: 'execution_jobs_claim_idx',
        },
        // Contagem de concorrência por tenant avaliada no claim (subquery
        // correlacionada por tenant_key/processing_at com status='processing').
        {
          fields: ['tenant_key', 'processing_at'],
          where: { status: 'processing' },
          name: 'execution_jobs_processing_tenant_idx',
        },
      ],
    });
  }

  return ExecutionJob;
}

module.exports = getExecutionJobModel;

