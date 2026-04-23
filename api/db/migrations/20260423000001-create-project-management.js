'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'projects', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4,
      },
      tenant_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'tenants',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      code: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'active',
      },
      priority: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'medium',
      },
      health: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'on_track',
      },
      visibility: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'private',
      },
      owner_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      start_date: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      target_end_date: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      actual_end_date: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      updated_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface, 'projects', ['tenant_id', 'status'], {
      name: 'projects_tenant_id_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'projects', ['tenant_id', 'code'], {
      unique: true,
      name: 'projects_tenant_id_code_unique',
    });

    await createTableIfNotExists(queryInterface, 'project_members', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4,
      },
      project_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'projects',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      role: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'project_contributor',
      },
      allocation_percent: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 100,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface, 'project_members', ['project_id', 'user_id'], {
      unique: true,
      name: 'project_members_project_id_user_id_unique',
    });

    await createTableIfNotExists(queryInterface, 'project_milestones', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4,
      },
      project_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'projects',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      due_date: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'planned',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface, 'project_milestones', ['project_id', 'due_date'], {
      name: 'project_milestones_project_id_due_date_idx',
    });

    await createTableIfNotExists(queryInterface, 'project_lists', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4,
      },
      project_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'projects',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      slug: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      position: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      color: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      wip_limit: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface, 'project_lists', ['project_id', 'position'], {
      name: 'project_lists_project_id_position_idx',
    });
    await addIndexIfNotExists(queryInterface, 'project_lists', ['project_id', 'slug'], {
      unique: true,
      name: 'project_lists_project_id_slug_unique',
    });

    await createTableIfNotExists(queryInterface, 'project_items', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4,
      },
      project_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'projects',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      parent_item_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'project_items',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      list_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'project_lists',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      milestone_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'project_milestones',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      item_type: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'task',
      },
      title: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'todo',
      },
      priority: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'medium',
      },
      severity: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      assignee_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      reporter_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      story_points: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      effort_estimate_minutes: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      effort_actual_minutes: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      progress_percent: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      start_date: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      due_date: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      completed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      position: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      source_type: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      source_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      origin_context_json: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      created_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      updated_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface, 'project_items', ['project_id', 'list_id', 'position'], {
      name: 'project_items_project_id_list_id_position_idx',
    });
    await addIndexIfNotExists(queryInterface, 'project_items', ['project_id', 'status'], {
      name: 'project_items_project_id_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'project_items', ['project_id', 'assignee_user_id'], {
      name: 'project_items_project_id_assignee_user_id_idx',
    });

    await createTableIfNotExists(queryInterface, 'project_comments', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4,
      },
      item_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'project_items',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      author_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      body: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      is_system: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface, 'project_comments', ['item_id', 'created_at'], {
      name: 'project_comments_item_id_created_at_idx',
    });

    await createTableIfNotExists(queryInterface, 'project_attachments', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4,
      },
      item_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'project_items',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      file_name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      mime_type: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      storage_path: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      uploaded_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface, 'project_attachments', ['item_id'], {
      name: 'project_attachments_item_id_idx',
    });

    await createTableIfNotExists(queryInterface, 'project_activities', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4,
      },
      project_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'projects',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      item_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'project_items',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      actor_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      event_type: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      before_json: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      after_json: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      metadata_json: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface, 'project_activities', ['project_id', 'created_at'], {
      name: 'project_activities_project_id_created_at_idx',
    });
    await addIndexIfNotExists(queryInterface, 'project_activities', ['item_id', 'created_at'], {
      name: 'project_activities_item_id_created_at_idx',
    });

    await createTableIfNotExists(queryInterface, 'project_dependencies', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4,
      },
      predecessor_item_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'project_items',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      successor_item_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'project_items',
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      dependency_type: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'blocks',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface, 'project_dependencies', ['predecessor_item_id', 'successor_item_id'], {
      unique: true,
      name: 'project_dependencies_predecessor_successor_unique',
    });

    await createTableIfNotExists(queryInterface, 'project_templates', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.UUIDV4,
      },
      tenant_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'tenants',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      template_json: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      created_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface, 'project_templates', ['tenant_id', 'name'], {
      name: 'project_templates_tenant_id_name_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('project_templates');
    await queryInterface.dropTable('project_dependencies');
    await queryInterface.dropTable('project_activities');
    await queryInterface.dropTable('project_attachments');
    await queryInterface.dropTable('project_comments');
    await queryInterface.dropTable('project_items');
    await queryInterface.dropTable('project_lists');
    await queryInterface.dropTable('project_milestones');
    await queryInterface.dropTable('project_members');
    await queryInterface.dropTable('projects');
  },
};
