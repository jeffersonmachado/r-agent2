import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduleModal } from '../components/ScheduleModal';
import { createSchedule, getScheduleAvailability } from '../api/scheduling';

vi.mock('../api/scheduling', () => ({
  createSchedule: vi.fn(),
  getScheduleAvailability: vi.fn(),
}));
vi.mock('../api/scheduleLookups', () => ({
  searchScheduleUsers: vi.fn(async () => []),
  searchScheduleTeams: vi.fn(async () => []),
  listSchedulePurposes: vi.fn(async () => [
    { value: 'retorno', label: 'retorno' },
    { value: 'reunião', label: 'reunião' },
  ]),
}));

describe('ScheduleModal UI/UX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSchedule.mockResolvedValue({ ok: true, schedule: { id: 'sch-1' } });
    getScheduleAvailability.mockResolvedValue({ ok: true, available: true, reasons: [] });
  });

  function renderModal(overrides = {}) {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const view = render(
      <ScheduleModal
        isOpen
        onClose={onClose}
        onCreated={onCreated}
        contextType="ticket"
        contextId="ticket-123"
        defaultTimezone="UTC"
        {...overrides}
      />,
    );
    return { onClose, onCreated, ...view };
  }

  it('mostra campos condicionais de team/owner ao ativar agenda da equipe', async () => {
    renderModal();

    expect(screen.queryByLabelText(/^Responsável$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Equipe$/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Usar agenda da equipe/i));

    expect(await screen.findByLabelText(/^Responsável$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Equipe$/i)).toBeInTheDocument();
  });

  it('valida context id obrigatório antes de enviar', async () => {
    const { container } = renderModal({ contextId: '   ' });
    const startInput = container.querySelector('input[type="datetime-local"]');

    fireEvent.change(startInput, { target: { value: '2026-03-05T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Agendar/i }));

    expect(await screen.findByText(/ID do contexto é obrigatório/i)).toBeInTheDocument();
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it('consulta disponibilidade com payload do modo team_based', async () => {
    const { container } = renderModal();
    const startInput = container.querySelector('input[type="datetime-local"]');
    const durationInput = container.querySelector('input[type="number"]');

    fireEvent.change(startInput, { target: { value: '2026-03-05T10:00' } });
    fireEvent.change(durationInput, { target: { value: '45' } });
    fireEvent.change(screen.getByDisplayValue('UTC'), { target: { value: 'America/Sao_Paulo' } });
    fireEvent.click(screen.getByLabelText(/Usar agenda da equipe/i));
    fireEvent.click(screen.getAllByLabelText(/Digitar ID/i)[0]);
    fireEvent.click(screen.getAllByLabelText(/Digitar ID/i)[1]);
    fireEvent.change(await screen.findByPlaceholderText(/agent-uuid/i), { target: { value: 'owner-7' } });
    fireEvent.change(screen.getByPlaceholderText(/team-support/i), { target: { value: 'team-support' } });

    fireEvent.click(screen.getByRole('button', { name: /Validar disponibilidade/i }));

    await waitFor(() => expect(getScheduleAvailability).toHaveBeenCalledTimes(1));

    const sent = getScheduleAvailability.mock.calls[0][0];
    expect(sent.mode).toBe('team_based');
    expect(sent.ownerId).toBe('owner-7');
    expect(sent.teamId).toBe('team-support');
    expect(sent.timezone).toBe('America/Sao_Paulo');
    expect(sent.startAt).toBe(new Date('2026-03-05T10:00').toISOString());
    expect(sent.endAt).toBe(new Date('2026-03-05T10:45').toISOString());
  });

  it('envia payload compatível com metadata de preset', async () => {
    const { onClose, onCreated, container } = renderModal({
      contextType: 'crm',
      contextId: 'opp-99',
      contactId: 'contact-5',
      conversationId: 'conv-8',
      defaultChannel: 'email',
      defaultPurpose: 'reunião',
      defaultNotes: 'nota inicial',
    });

    const startInput = container.querySelector('input[type="datetime-local"]');
    const durationInput = container.querySelector('input[type="number"]');

    fireEvent.change(startInput, { target: { value: '2026-03-05T10:00' } });
    fireEvent.change(durationInput, { target: { value: '30' } });
    fireEvent.click(screen.getByLabelText(/Usar agenda da equipe/i));
    fireEvent.click(screen.getAllByLabelText(/Digitar ID/i)[0]);
    fireEvent.click(screen.getAllByLabelText(/Digitar ID/i)[1]);
    fireEvent.change(await screen.findByPlaceholderText(/team-support/i), { target: { value: 'team-1' } });
    fireEvent.change(screen.getByPlaceholderText(/agent-uuid/i), { target: { value: 'owner-2' } });

    fireEvent.click(screen.getByRole('button', { name: /Agendar/i }));

    await waitFor(() => expect(createSchedule).toHaveBeenCalledTimes(1));

    const payload = createSchedule.mock.calls[0][0];
    expect(payload).toMatchObject({
      contextType: 'crm',
      contextId: 'opp-99',
      contactId: 'contact-5',
      conversationId: 'conv-8',
      channel: 'email',
      mode: 'team_based',
      teamId: 'team-1',
      ownerId: 'owner-2',
      purpose: 'reunião',
      notes: 'nota inicial',
      requiresConfirmation: true,
      timezone: 'UTC',
      metadata: {
        schedulingPresetId: 'com_confirmacao',
        confirmationTimeoutMinutes: 120,
      },
    });
    expect(payload.startAt).toBe(new Date('2026-03-05T10:00').toISOString());
    expect(payload.endAt).toBe(new Date('2026-03-05T10:30').toISOString());
    expect(payload.reminders).toEqual([
      { offsetMinutes: -24 * 60, action: 'request_confirmation' },
      { offsetMinutes: -60, action: 'notify' },
      { offsetMinutes: 10, action: 'mark_no_show' },
    ]);

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('valida teamId ou ownerId no preset humano_agendado', async () => {
    const { container } = renderModal();
    const presetSelect = container.querySelector('select');

    fireEvent.change(presetSelect, { target: { value: 'humano_agendado' } });
    fireEvent.change(container.querySelector('input[type="datetime-local"]'), { target: { value: '2026-03-05T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Agendar/i }));

    expect(await screen.findByText(/Informe ao menos Equipe ou Responsável/i)).toBeInTheDocument();
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it('salva campos novos em metadata no preset inteligente_ia_decide', async () => {
    const { container } = renderModal();
    const presetSelect = container.querySelector('select');

    fireEvent.change(presetSelect, { target: { value: 'inteligente_ia_decide' } });
    const windowInputs = container.querySelectorAll('input[type="datetime-local"]');
    fireEvent.change(windowInputs[0], { target: { value: '2026-03-05T09:00' } });
    fireEvent.change(windowInputs[1], { target: { value: '2026-03-05T11:00' } });
    fireEvent.change(screen.getByDisplayValue('Normal'), { target: { value: 'critical' } });
    fireEvent.click(screen.getByRole('button', { name: /Agendar/i }));

    await waitFor(() => expect(createSchedule).toHaveBeenCalledTimes(1));

    const payload = createSchedule.mock.calls[0][0];
    expect(payload.metadata).toMatchObject({
      schedulingPresetId: 'inteligente_ia_decide',
      priority: 'critical',
      allowAutoReschedule: true,
      window: {
        startAt: new Date('2026-03-05T09:00').toISOString(),
        endAt: new Date('2026-03-05T11:00').toISOString(),
      },
    });
  });

  it('trava referências em modo lockReferences e mantém payload original mesmo com alteração local', async () => {
    const { container } = renderModal({
      lockReferences: true,
      contextType: 'ticket',
      contextId: 'ticket-locked',
      contactId: 'contact-locked',
      conversationId: 'conv-locked',
      defaultChannel: 'whatsapp',
    });

    const [presetSelect, contextTypeSelect, channelSelect] = container.querySelectorAll('select');
    const contextIdInput = screen.getByPlaceholderText(/ticket-123/i);
    const optionalInputs = screen.getAllByPlaceholderText(/opcional/i);
    const contactIdInput = optionalInputs[0];
    const conversationIdInput = optionalInputs[1];
    const startInput = container.querySelector('input[type="datetime-local"]');

    expect(contextTypeSelect).toBeDisabled();
    expect(channelSelect).toBeDisabled();
    expect(contextIdInput).toHaveAttribute('readonly');
    expect(contactIdInput).toHaveAttribute('readonly');
    expect(conversationIdInput).toHaveAttribute('readonly');
    expect(screen.getAllByText(/Campo definido pela conversa de origem/i).length).toBeGreaterThan(0);

    fireEvent.change(contextTypeSelect, { target: { value: 'crm' } });
    fireEvent.change(contextIdInput, { target: { value: '   ' } });
    fireEvent.change(contactIdInput, { target: { value: 'contact-tampered' } });
    fireEvent.change(conversationIdInput, { target: { value: 'conv-tampered' } });
    fireEvent.change(channelSelect, { target: { value: 'email' } });
    fireEvent.change(startInput, { target: { value: '2026-03-05T10:00' } });
    fireEvent.change(presetSelect, { target: { value: 'com_confirmacao' } });
    fireEvent.click(screen.getByRole('button', { name: /Agendar/i }));

    await waitFor(() => expect(createSchedule).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/ID do contexto é obrigatório/i)).not.toBeInTheDocument();
    const payload = createSchedule.mock.calls[0][0];
    expect(payload.contextType).toBe('ticket');
    expect(payload.contextId).toBe('ticket-locked');
    expect(payload.contactId).toBe('contact-locked');
    expect(payload.conversationId).toBe('conv-locked');
    expect(payload.channel).toBe('whatsapp');
  });

  it('exige conversationId quando lockReferences está ativo', async () => {
    const { container } = renderModal({
      lockReferences: true,
      contextType: 'ticket',
      contextId: 'ticket-123',
      conversationId: '',
      defaultChannel: 'whatsapp',
    });

    const startInput = container.querySelector('input[type="datetime-local"]');
    fireEvent.change(startInput, { target: { value: '2026-03-05T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Agendar/i }));

    expect(await screen.findByText(/Agendamento de conversa exige ID da conversa/i)).toBeInTheDocument();
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it('mostra botão Abrir agenda quando ownerId está selecionado', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { container } = renderModal();

    fireEvent.click(screen.getByLabelText(/Usar agenda da equipe/i));
    fireEvent.click(screen.getAllByLabelText(/Digitar ID/i)[0]);
    fireEvent.change(await screen.findByPlaceholderText(/agent-uuid/i), { target: { value: 'owner-123' } });

    const openAgendaButton = screen.getByRole('button', { name: /Abrir agenda/i });
    fireEvent.click(openAgendaButton);

    expect(openSpy).toHaveBeenCalled();
    expect(String(openSpy.mock.calls[0][0] || '')).toContain('/agenda/owner-123');
    openSpy.mockRestore();
  });
});
