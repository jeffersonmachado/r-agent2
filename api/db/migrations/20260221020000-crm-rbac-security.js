'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create CRM Roles table
    await queryInterface.createTable('crm_roles', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      tenant_key: {
        type: Sequelize.STRING(255),
        allowNull: false,
        index: true,
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
      },
      permissions: {
        type: Sequelize.JSONB,
        defaultValue: [],
        comment: 'Array of permission strings: ["crm:accounts:read", "crm:opportunities:write", ...]'
      },
      is_system: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        comment: 'System roles cannot be deleted',
      },
      metadata: {
        type: Sequelize.JSONB,
        defaultValue: {},
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.CURRENT_TIMESTAMP,
      },
      updated_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.CURRENT_TIMESTAMP,
        onUpdate: Sequelize.CURRENT_TIMESTAMP,
      },
    });

    // Create User Roles Join table
    await queryInterface.createTable('crm_user_roles', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      tenant_key: {
        type: Sequelize.STRING(255),
        allowNull: false,
        index: true,
      },
      user_id: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      role_id: {
        type: Sequelize.UUID,
        references: { model: 'crm_roles', key: 'id' },
        onDelete: 'CASCADE',
      },
      assigned_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.CURRENT_TIMESTAMP,
      },
      assigned_by: {
        type: Sequelize.STRING(255),
      },
    });

    // Create CRM Resource Permissions table
    await queryInterface.createTable('crm_resource_permissions', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      tenant_key: {
        type: Sequelize.STRING(255),
        allowNull: false,
        index: true,
      },
      resource_type: {
        type: Sequelize.ENUM('account', 'contact', 'lead', 'pipeline', 'opportunity', 'activity'),
        allowNull: false,
      },
      resource_id: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      user_id: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      permission_level: {
        type: Sequelize.ENUM('view', 'edit', 'delete', 'owner'),
        defaultValue: 'view',
      },
      granted_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.CURRENT_TIMESTAMP,
      },
    });

    // Create CRM Audit Log table
    await queryInterface.createTable('crm_audit_logs', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      tenant_key: {
        type: Sequelize.STRING(255),
        allowNull: false,
        index: true,
      },
      user_id: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      action: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      entity_type: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      entity_id: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      changes: {
        type: Sequelize.JSONB,
        defaultValue: null,
        comment: 'What changed: { before: {}, after: {} }',
      },
      timestamp: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.CURRENT_TIMESTAMP,
        index: true,
      },
    });

    // Add indexes
    await queryInterface.addIndex('crm_roles', ['tenant_key', 'name'], { unique: true });
    await queryInterface.addIndex('crm_user_roles', ['tenant_key', 'user_id']);
    await queryInterface.addIndex('crm_resource_permissions', ['tenant_key', 'resource_type', 'resource_id']);
    await queryInterface.addIndex('crm_resource_permissions', ['tenant_key', 'user_id']);
    await queryInterface.addIndex('crm_audit_logs', ['tenant_key', 'user_id']);
    await queryInterface.addIndex('crm_audit_logs', ['tenant_key', 'entity_type']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('crm_audit_logs');
    await queryInterface.dropTable('crm_resource_permissions');
    await queryInterface.dropTable('crm_user_roles');
    await queryInterface.dropTable('crm_roles');
  },
};
