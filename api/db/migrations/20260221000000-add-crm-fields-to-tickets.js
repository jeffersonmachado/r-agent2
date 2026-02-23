'use strict';

/**
 * Migration: Adiciona campos CRM ao modelo Ticket
 * Permite vincular tickets de atendimento com contatos, contas e oportunidades do CRM
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    // Adiciona campos de referência ao CRM
    // OBS: As constraints de FK podem falhar se as tabelas CRM não existem
    // Neste caso, adicionamos apenas as colunas sem referencias
    
    try {
      // Tenta com referência completa (caso tabelas CRM existam)
      await queryInterface.addColumn('tickets', 'crm_contact_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'crm_contacts',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Referência ao contato CRM associado ao ticket'
      });
    } catch (err) {
      // Se falhar, adiciona apenas a coluna sem FK
      if (!err.message.includes('already exists')) {
        await queryInterface.addColumn('tickets', 'crm_contact_id', {
          type: Sequelize.INTEGER,
          allowNull: true,
          comment: 'Referência ao contato CRM associado ao ticket'
        });
      }
    }

    try {
      await queryInterface.addColumn('tickets', 'crm_account_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'crm_accounts',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Referência à conta CRM associada ao ticket'
      });
    } catch (err) {
      // Se falhar, adiciona apenas a coluna sem FK
      if (!err.message.includes('already exists')) {
        await queryInterface.addColumn('tickets', 'crm_account_id', {
          type: Sequelize.INTEGER,
          allowNull: true,
          comment: 'Referência à conta CRM associada ao ticket'
        });
      }
    }

    try {
      await queryInterface.addColumn('tickets', 'crm_opportunity_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'crm_opportunities',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'Referência à oportunidade CRM gerada a partir do ticket'
      });
    } catch (err) {
      // Se falhar, adiciona apenas a coluna sem FK
      if (!err.message.includes('already exists')) {
        await queryInterface.addColumn('tickets', 'crm_opportunity_id', {
          type: Sequelize.INTEGER,
          allowNull: true,
          comment: 'Referência à oportunidade CRM gerada a partir do ticket'
        });
      }
    }

    // Adiciona índices para performance
    // OBS: Wraps em try-catch para evitar erros se colunas não foram criadas
    try {
      await queryInterface.addIndex('tickets', ['crm_contact_id'], {
        name: 'tickets_crm_contact_id_idx'
      });
    } catch (err) {
      // Silenciosamente ignora se índice já existe
    }

    try {
      await queryInterface.addIndex('tickets', ['crm_account_id'], {
        name: 'tickets_crm_account_id_idx'
      });
    } catch (err) {
      // Silenciosamente ignora se índice já existe
    }

    try {
      await queryInterface.addIndex('tickets', ['crm_opportunity_id'], {
        name: 'tickets_crm_opportunity_id_idx'
      });
    } catch (err) {
      // Silenciosamente ignora se índice já existe
    }

    // Índice composto para buscar tickets por tenant e contato
    try {
      await queryInterface.addIndex('tickets', ['tenant_key', 'crm_contact_id'], {
        name: 'tickets_tenant_key_crm_contact_id_idx'
      });
    } catch (err) {
      // Silenciosamente ignora se índice já existe
    }
  },

  async down(queryInterface, Sequelize) {
    // Remove índices (ignora erros se não existem)
    try {
      await queryInterface.removeIndex('tickets', 'tickets_tenant_key_crm_contact_id_idx');
    } catch (err) {
      // Silenciosamente ignora
    }

    try {
      await queryInterface.removeIndex('tickets', 'tickets_crm_opportunity_id_idx');
    } catch (err) {
      // Silenciosamente ignora
    }

    try {
      await queryInterface.removeIndex('tickets', 'tickets_crm_account_id_idx');
    } catch (err) {
      // Silenciosamente ignora
    }

    try {
      await queryInterface.removeIndex('tickets', 'tickets_crm_contact_id_idx');
    } catch (err) {
      // Silenciosamente ignora
    }

    // Remove colunas (ignora erros se não existem)
    try {
      await queryInterface.removeColumn('tickets', 'crm_opportunity_id');
    } catch (err) {
      // Silenciosamente ignora
    }

    try {
      await queryInterface.removeColumn('tickets', 'crm_account_id');
    } catch (err) {
      // Silenciosamente ignora
    }

    try {
      await queryInterface.removeColumn('tickets', 'crm_contact_id');
    } catch (err) {
      // Silenciosamente ignora
    }
  }
};
