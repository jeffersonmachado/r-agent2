import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LroOperationsPanel } from './LroOperationsPanel';
import { fetchJson } from '../../api/client';

vi.mock('../../api/client', () => ({ fetchJson: vi.fn() }));

const bloco = (seq, tipo, extra = {}) => `id: ${seq}\nevent: ${tipo}\ndata: ${JSON.stringify({ seq, type: tipo, ...extra })}\n\n`;

function streamDe(blocos) {
  const codificador = new TextEncoder();
  let i = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (i < blocos.length) { const v = codificador.encode(blocos[i]); i += 1; return { value: v, done: false }; }
        return new Promise(() => {}); // mantém aberto (stream ao vivo)
      },
    }),
  };
}

describe('LroOperationsPanel', () => {
  const fetchOriginal = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  it('lista operações e mostra desfecho ao lado de COMPLETED (concluir não é aprovar)', async () => {
    fetchJson.mockResolvedValue({
      items: [
        { id: 'op-1', operationType: 'qa_waves', status: 'RUNNING', progressCurrent: 2, progressTotal: 5, progressUnit: 'scenario' },
        { id: 'op-2', operationType: 'qa_waves', status: 'COMPLETED', outcome: 'NO_GO', progressCurrent: null, progressTotal: null },
      ],
    });

    render(<LroOperationsPanel />);

    expect(await screen.findByText('2/5 scenario')).toBeInTheDocument();
    expect(screen.getByText(/Concluída \(NO_GO\)/)).toBeInTheDocument();
    // Total desconhecido não vira 100%
    expect(screen.queryByText('100%')).toBeNull();
  });

  it('falha da LISTA é anunciada e não derruba a tela', async () => {
    fetchJson.mockRejectedValue(new Error('Erro HTTP 500 ao chamar /api/lro'));
    render(<LroOperationsPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Erro HTTP 500');
  });

  it('sem operações mostra vazio explícito', async () => {
    fetchJson.mockResolvedValue({ items: [] });
    render(<LroOperationsPanel />);
    expect(await screen.findByText('Nenhuma operação registrada.')).toBeInTheDocument();
  });

  it('selecionar operação abre detalhe com estado de conexão e eventos ao vivo', async () => {
    fetchJson.mockResolvedValue({
      items: [{ id: 'op-9', operationType: 'qa_waves', status: 'RUNNING', progressCurrent: 1, progressTotal: 3, progressUnit: 'scenario' }],
    });
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: streamDe([bloco(1, 'CREATED'), bloco(2, 'PROGRESS', { payload: { current: 1 } })]),
    }));

    const user = userEvent.setup();
    render(<LroOperationsPanel />);

    await user.click(await screen.findByRole('button', { name: 'qa_waves' }));

    await waitFor(() => expect(screen.getByText(/conexão: ao vivo/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('PROGRESS')).toBeInTheDocument());
    expect(screen.getByText('CREATED')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/lro/op-9/events'),
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'text/event-stream' }) }),
    );
  });
});
