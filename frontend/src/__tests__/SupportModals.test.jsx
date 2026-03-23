import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SupportCloseTicketModal } from '../pages/support/SupportCloseTicketModal';
import { SupportDeliveryFailuresModal } from '../pages/support/SupportDeliveryFailuresModal';

vi.mock('../api/tickets', () => ({
  sendTicketMessage: vi.fn(async () => ({ ok: true })),
}));

describe('Support modals close behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SupportCloseTicketModal dispara onClose por overlay, ESC e Cancelar', () => {
    const onClose = vi.fn();
    const onConfirmClose = vi.fn();

    const { container } = render(
      <SupportCloseTicketModal
        isOpen
        closing={false}
        closeReasons={[{ id: 'reason-1', name: 'Resolvido' }]}
        selectedCloseReasonId=""
        setSelectedCloseReasonId={vi.fn()}
        selectedCloseReasonName=""
        setSelectedCloseReasonName={vi.fn()}
        closeTagsInput=""
        setCloseTagsInput={vi.fn()}
        onConfirmClose={onConfirmClose}
        onClose={onClose}
      />,
    );

    const overlay = container.querySelector('.support-modal-overlay');
    expect(overlay).toBeTruthy();

    fireEvent.click(overlay);
    fireEvent.keyDown(overlay, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/i }));

    expect(onClose).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole('button', { name: /Fechar/i }));
    expect(onConfirmClose).toHaveBeenCalledTimes(1);
  });

  it('SupportCloseTicketModal bloqueia fechamento quando closing=true', () => {
    const onClose = vi.fn();

    const { container } = render(
      <SupportCloseTicketModal
        isOpen
        closing
        closeReasons={[]}
        selectedCloseReasonId=""
        setSelectedCloseReasonId={vi.fn()}
        selectedCloseReasonName=""
        setSelectedCloseReasonName={vi.fn()}
        closeTagsInput=""
        setCloseTagsInput={vi.fn()}
        onConfirmClose={vi.fn()}
        onClose={onClose}
      />,
    );

    const overlay = container.querySelector('.support-modal-overlay');
    fireEvent.click(overlay);
    fireEvent.keyDown(overlay, { key: 'Escape' });

    const cancelButton = screen.getByRole('button', { name: /Cancelar/i });
    expect(cancelButton).toBeDisabled();

    fireEvent.click(cancelButton);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('SupportDeliveryFailuresModal dispara onClose por overlay, ESC e botão Fechar', () => {
    const onClose = vi.fn();

    const { container } = render(
      <SupportDeliveryFailuresModal
        isOpen
        loading={false}
        deliveryFailures={{ outboundQueue: [], channelMessages: [] }}
        selectedTicket={{ id: 'ticket-1' }}
        showToast={vi.fn()}
        showToastRef={{ current: vi.fn() }}
        onClose={onClose}
      />,
    );

    const overlay = container.querySelector('.support-modal-overlay');
    fireEvent.click(overlay);
    fireEvent.keyDown(overlay, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /Fechar/i }));

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('SupportDeliveryFailuresModal exibe estado de loading', () => {
    render(
      <SupportDeliveryFailuresModal
        isOpen
        loading
        deliveryFailures={{ outboundQueue: [], channelMessages: [] }}
        selectedTicket={{ id: 'ticket-1' }}
        showToast={vi.fn()}
        showToastRef={{ current: vi.fn() }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/Carregando/i)).toBeInTheDocument();
  });
});
