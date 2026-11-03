import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LroFeedbackDecision } from './LroFeedbackDecision';
import { fetchJson } from '../../api/client';

vi.mock('../../api/client', () => ({ fetchJson: vi.fn() }));

const erroCom = (code, message) => Object.assign(new Error(message || code), { code });

describe('LroFeedbackDecision — decisão humana', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('aprovar registra a decisão com idempotencyKey estável e mostra o estado da operação', async () => {
    fetchJson.mockResolvedValue({ replayed: false, operation: { status: 'RUNNING' } });
    const user = userEvent.setup();
    const onDecided = vi.fn();

    render(<LroFeedbackDecision requestId="req-1" onDecided={onDecided} />);
    await user.click(screen.getByRole('button', { name: /aprovar/i }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('operação RUNNING'));
    const [url, init] = fetchJson.mock.calls[0];
    expect(url).toBe('/api/lro/feedback/req-1/respond');
    expect(init.method).toBe('POST');
    const corpo = JSON.parse(init.body);
    expect(corpo).toEqual({ decision: 'approve', idempotencyKey: 'ui:req-1:approve' });
    expect(onDecided).toHaveBeenCalled();
  });

  it('duplo clique reenvia a MESMA chave (não cria efeito novo)', async () => {
    let resolver;
    fetchJson.mockImplementation(() => new Promise((resolve) => { resolver = resolve; }));
    const user = userEvent.setup();

    render(<LroFeedbackDecision requestId="req-2" />);
    const botao = screen.getByRole('button', { name: /aprovar/i });
    await user.click(botao);
    await user.click(botao); // segundo clique enquanto o primeiro está em voo

    expect(fetchJson).toHaveBeenCalledTimes(1); // bloqueado durante o envio
    resolver({ replayed: false, operation: { status: 'RUNNING' } });
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  });

  it('prazo vencido: mostra o código e DESARMA os botões (não insiste)', async () => {
    fetchJson.mockRejectedValue(erroCom('FEEDBACK_EXPIRADO', 'prazo vencido'));
    const user = userEvent.setup();

    render(<LroFeedbackDecision requestId="req-3" />);
    await user.click(screen.getByRole('button', { name: /rejeitar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('FEEDBACK_EXPIRADO');
    expect(screen.getByRole('button', { name: /aprovar/i })).toBeDisabled();
  });

  it('sem permissão (403) é anunciado e permite nova tentativa', async () => {
    fetchJson.mockRejectedValue(erroCom('classification_forbidden', 'não autorizado'));
    const user = userEvent.setup();

    render(<LroFeedbackDecision requestId="req-4" />);
    await user.click(screen.getByRole('button', { name: /aprovar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('classification_forbidden');
    expect(screen.getByRole('button', { name: /aprovar/i })).not.toBeDisabled();
  });

  it('reenvio idempotente do servidor é sinalizado ao usuário', async () => {
    fetchJson.mockResolvedValue({ replayed: true, operation: { status: 'RUNNING' } });
    const user = userEvent.setup();

    render(<LroFeedbackDecision requestId="req-5" />);
    await user.click(screen.getByRole('button', { name: /aprovar/i }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('reenvio idempotente'));
  });

  it('sem requestId não renderiza nada', () => {
    const { container } = render(<LroFeedbackDecision requestId={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
