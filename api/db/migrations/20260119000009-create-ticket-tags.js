/**
 * Migration: Create ticket_tags table (tenant_key-based)
 *
 * Stores tag actions for auditability (add/remove) without breaking legacy Ticket.tags (JSONB).
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'ticket_tags', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      ticket_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      tag: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      action: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'add | remove',
      },
      actor_user_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface, 'ticket_tags', ['tenant_key', 'ticket_id', 'created_at'], {
      name: 'ticket_tags_tenant_ticket_created_idx',
    });

    await addIndexIfNotExists(queryInterface, 'ticket_tags', ['tenant_key', 'tag'], {
      name: 'ticket_tags_tenant_tag_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ticket_tags');
  },
};

