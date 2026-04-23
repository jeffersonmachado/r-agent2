import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ProjectsPage } from './ProjectsPage';
import { listProjects, listProjectTemplates } from '../../api/projects';

const navigate = vi.fn();
const showToast = vi.fn();

vi.mock('../../context/authContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    loading: false,
  }),
}));

vi.mock('../../hooks/useRouter', () => ({
  useRouter: () => ({
    navigate,
  }),
}));

vi.mock('../../components/Toast', () => ({
  useToast: () => ({
    showToast,
    ToastContainer: () => <div data-testid="toast-container" />,
  }),
}));

vi.mock('../../api/projects', () => ({
  listProjects: vi.fn().mockResolvedValue({
    projects: [
      {
        id: 'project-1',
        code: 'RAP-001',
        name: 'Projeto Demo RAP',
        status: 'active',
        health: 'on_track',
        description: 'Projeto de teste',
        kpis: { totalItems: 4, doneItems: 2, overdueItems: 1 },
      },
    ],
  }),
  listProjectTemplates: vi.fn().mockResolvedValue({ templates: [] }),
  createProject: vi.fn(),
  createProjectFromTemplate: vi.fn(),
}));

describe('ProjectsPage', () => {
  beforeEach(() => {
    navigate.mockReset();
    showToast.mockReset();
    listProjects.mockResolvedValue({
      projects: [
        {
          id: 'project-1',
          code: 'RAP-001',
          name: 'Projeto Demo RAP',
          status: 'active',
          health: 'on_track',
          description: 'Projeto de teste',
          kpis: { totalItems: 4, doneItems: 2, overdueItems: 1 },
        },
      ],
    });
    listProjectTemplates.mockResolvedValue({ templates: [] });
  });

  it('renders projects and navigates to board on click', async () => {
    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByText('Projeto Demo RAP')).toBeTruthy();
    });

    await userEvent.click(screen.getByText('Projeto Demo RAP'));
    expect(navigate).toHaveBeenCalledWith('/projects/project-1');
  });
});
