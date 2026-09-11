const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let AccessMembership = null;

function getAccessMembershipModel() {
  if (!AccessMembership) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    AccessMembership = sequelize.define('AccessMembership', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      subject_id: { type: DataTypes.STRING, allowNull: false },
      customer_id: { type: DataTypes.STRING, allowNull: true },
      vertical: { type: DataTypes.STRING, allowNull: false, defaultValue: 'fitness' },
      plan_name: { type: DataTypes.STRING, allowNull: true },
      billing_status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      unit_scope: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      start_at: { type: DataTypes.DATE, allowNull: true },
      end_at: { type: DataTypes.DATE, allowNull: true },
      // Colunas de billing adicionadas por
      // `api/db/migrations/20260318100000-vertical-beauty-fitness-core.js`.
      // Declaradas aqui porque `fitnessMembershipService` e
      // `billingOrchestrationService` as escrevem (updateMembershipDetails,
      // updateBillingStatus, reactivateMembership, startGracePeriod) e as leem
      // (computeEffectiveBillingStatus usa grace_until). Sem a declaração, o
      // Sequelize descarta a escrita silenciosamente. Contrato versionado em
      // `config/model-field-contracts.json` (gate `validate:model-field-contracts`).
      due_date: { type: DataTypes.DATE, allowNull: true },
      renewal_at: { type: DataTypes.DATE, allowNull: true },
      grace_until: { type: DataTypes.DATE, allowNull: true },
      plan_type: { type: DataTypes.STRING, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'access_memberships',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'subject_id'], name: 'access_memberships_tenant_subject_idx' },
        { fields: ['tenant_key', 'billing_status'], name: 'access_memberships_tenant_billing_idx' },
      ],
    });
  }

  return AccessMembership;
}

module.exports = getAccessMembershipModel;
