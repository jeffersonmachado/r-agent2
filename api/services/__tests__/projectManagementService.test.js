'use strict';

const mockProjectCount = jest.fn();
const mockProjectFindAll = jest.fn();

jest.mock('../../db/models', () => ({
  Project: () => ({
    count: mockProjectCount,
    findAll: mockProjectFindAll,
  }),
  ProjectMember: () => ({}),
  ProjectList: () => ({}),
  ProjectItem: () => ({}),
  ProjectComment: () => ({}),
  ProjectAttachment: () => ({}),
  ProjectActivity: () => ({}),
  ProjectMilestone: () => ({}),
  ProjectDependency: () => ({}),
  ProjectTemplate: () => ({
    count: jest.fn().mockResolvedValue(1),
  }),
  User: () => ({}),
}));

const { listProjects, createProject } = require('../projectManagement/projectManagementService');

describe('projectManagementService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('computes project KPIs from nested items and members', async () => {
    mockProjectCount.mockResolvedValue(1);
    mockProjectFindAll.mockResolvedValue([
      {
        get: () => ({
          id: 'project-1',
          name: 'Projeto KPIs',
          members: [{ id: 'm1' }, { id: 'm2' }],
          items: [
            { id: 'i1', status: 'done' },
            { id: 'i2', status: 'doing' },
            { id: 'i3', status: 'todo', due_date: '2020-01-01T00:00:00.000Z' },
          ],
        }),
      },
    ]);

    const projects = await listProjects({ tenantId: 'tenant-1', actorUserId: 'user-1', query: {} });

    expect(projects).toHaveLength(1);
    expect(projects[0].kpis).toEqual({
      totalItems: 3,
      doneItems: 1,
      overdueItems: 1,
      memberCount: 2,
    });
  });

  it('rejects project creation without a name', async () => {
    await expect(createProject({
      tenantId: 'tenant-1',
      actorUserId: 'user-1',
      payload: {},
    })).rejects.toMatchObject({ code: 'bad_request' });
  });
});
