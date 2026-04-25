import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WorkManagementApp from '../../../dev/work-management/App.jsx';

describe('pages/WorkManagementPage', () => {
  it('navega para Board a partir do modulo raiz', async () => {
    const navigateMock = vi.fn();

    render(<WorkManagementApp currentPath="/dev/work-management" navigate={navigateMock} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Work Management' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Board' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Board' }));

    expect(navigateMock).toHaveBeenCalledWith('/dev/work-management/board');
  });

  it('renderiza board com colunas e itens do mock', async () => {
    render(<WorkManagementApp currentPath="/dev/work-management/board" navigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Kanban board')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Backlog' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Done' })).toBeInTheDocument();
    });

    expect(screen.getByText('Atualizar score de recomendacao para baixa cobertura')).toBeInTheDocument();
    expect(screen.getByText('Atualizar playbook de contingencia')).toBeInTheDocument();
  });

  it('abre execution drawer na aba Operations', async () => {
    render(<WorkManagementApp currentPath="/dev/work-management/operations" navigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Autonomous Operations Panel')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Ver execucao' }).length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Ver execucao' })[0]);

    await waitFor(() => {
      expect(screen.getByText('Execution Drawer')).toBeInTheDocument();
      expect(screen.getByText('Timeline de steps')).toBeInTheDocument();
      expect(screen.getByText('Logs tecnicos')).toBeInTheDocument();
    });
  });

  it('renderiza contexto de projeto e navega por abas do projeto', async () => {
    const navigateMock = vi.fn();
    render(<WorkManagementApp currentPath="/dev/work-management/projects/project-whatsapp-module/items" navigate={navigateMock} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'WhatsApp Module' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Work Items' })).toBeInTheDocument();
      expect(screen.getByText('Project context')).toBeInTheDocument();
      expect(screen.getByText('Criar fluxo de onboarding assistido')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Metrics' }));
    expect(navigateMock).toHaveBeenCalledWith('/dev/work-management/projects/project-whatsapp-module/metrics');
  });

  it('move item entre colunas no board com drag and drop', async () => {
    render(<WorkManagementApp currentPath="/dev/work-management/board" navigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Backlog' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Done' })).toBeInTheDocument();
    });

    const itemTitle = 'Atualizar score de recomendacao para baixa cobertura';
    const backlogHeading = screen.getByRole('heading', { name: 'Backlog' });
    const doneHeading = screen.getByRole('heading', { name: 'Done' });

    const backlogSection = backlogHeading.closest('section');
    const doneSection = doneHeading.closest('section');

    expect(backlogSection).not.toBeNull();
    expect(doneSection).not.toBeNull();

    const draggableItem = within(backlogSection).getByText(itemTitle).closest('article');
    expect(draggableItem).not.toBeNull();

    fireEvent.dragStart(draggableItem);
    fireEvent.dragOver(doneSection);
    fireEvent.drop(doneSection);

    await waitFor(() => {
      expect(within(doneSection).getByText(itemTitle)).toBeInTheDocument();
    });
  });

  it('abre replay drawer na aba QA & Validation', async () => {
    render(<WorkManagementApp currentPath="/dev/work-management/qa-validation" navigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'QA & Validation' })).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Replay' }).length).toBeGreaterThan(0);
    });

    const replayButtons = screen.getAllByRole('button', { name: 'Replay' });
    const enabledReplayButton = replayButtons.find((button) => !button.hasAttribute('disabled'));

    expect(enabledReplayButton).toBeDefined();
    fireEvent.click(enabledReplayButton);

    await waitFor(() => {
      expect(screen.getByText('Replay Drawer')).toBeInTheDocument();
      expect(screen.getByText('Fluxo simplificado')).toBeInTheDocument();
      expect(screen.getByText('narrativa operacional')).toBeInTheDocument();
    });
  });

  it('aplica filtro global de tenant em Projects', async () => {
    render(<WorkManagementApp currentPath="/dev/work-management/projects" navigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'WhatsApp Module' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Autonomous Scheduling' })).toBeInTheDocument();
    });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tenant' }), 'Cliente X');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Autonomous Scheduling' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'WhatsApp Module' })).not.toBeInTheDocument();
    });
  });

  it('aplica filtro global de channel em QA & Validation', async () => {
    render(<WorkManagementApp currentPath="/dev/work-management/qa-validation" navigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'QA & Validation' })).toBeInTheDocument();
      expect(screen.getByText('Onboarding smoke')).toBeInTheDocument();
      expect(screen.getByText('ACL staging validation')).toBeInTheDocument();
    });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Canal' }), 'pbx');

    await waitFor(() => {
      expect(screen.getByText('ACL staging validation')).toBeInTheDocument();
      expect(screen.queryByText('Onboarding smoke')).not.toBeInTheDocument();
      expect(screen.queryByText('No-show replay review')).not.toBeInTheDocument();
    });
  });

  it('altera filtro global de period sem quebrar renderizacao', async () => {
    render(<WorkManagementApp currentPath="/dev/work-management/operations" navigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Autonomous Operations Panel')).toBeInTheDocument();
    });

    const periodSelect = screen.getByRole('combobox', { name: 'Periodo' });
    expect(periodSelect).toHaveValue('30d');

    await userEvent.selectOptions(periodSelect, '7d');
    expect(periodSelect).toHaveValue('7d');

    await waitFor(() => {
      expect(screen.getByText('Autonomous Operations Panel')).toBeInTheDocument();
    });
  });

  it('aplica filtro global de environment em Projects', async () => {
    render(<WorkManagementApp currentPath="/dev/work-management/projects" navigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'PBX Voice Integration' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'RAG Engine' })).toBeInTheDocument();
    });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Ambiente' }), 'prod');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'PBX Voice Integration' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'RAG Engine' })).not.toBeInTheDocument();
    });
  });

  it('aplica filtro global de status em Projects', async () => {
    render(<WorkManagementApp currentPath="/dev/work-management/projects" navigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'PBX Voice Integration' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'WhatsApp Module' })).toBeInTheDocument();
    });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'on_track');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'PBX Voice Integration' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'WhatsApp Module' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Autonomous Scheduling' })).not.toBeInTheDocument();
    });
  });
});