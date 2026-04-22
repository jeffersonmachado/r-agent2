import { useCallback, useEffect, useState } from 'react';
import { closeTicket } from '../api/tickets';
import { listCloseReasons } from '../api/closeReasons';
import logger from '../utils/logger';

export function useSupportCloseTicket({
  confirm,
  selectedTicket,
  setSelectedTicket,
  loadTicketsRef,
  showToast,
}) {
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closingTicketId, setClosingTicketId] = useState(null);
  const [closeReasons, setCloseReasons] = useState([]);
  const [selectedCloseReasonId, setSelectedCloseReasonId] = useState('');
  const [selectedCloseReasonName, setSelectedCloseReasonName] = useState('');
  const [closeTagsInput, setCloseTagsInput] = useState('');
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!showCloseModal) return;
    listCloseReasons({ activeOnly: true })
      .then((resp) => setCloseReasons(resp?.closeReasons || []))
      .catch(() => setCloseReasons([]));
  }, [showCloseModal]);

  const handleClose = useCallback((ticketId) => {
    setClosingTicketId(ticketId);
    setSelectedCloseReasonId('');
    setSelectedCloseReasonName('');
    setCloseTagsInput('');
    setShowCloseModal(true);
  }, []);

  const closeCloseModal = useCallback(() => {
    setShowCloseModal(false);
    setClosingTicketId(null);
  }, []);

  const handleConfirmClose = useCallback(async () => {
    if (!closingTicketId) return;

    const hasReason = !!(String(selectedCloseReasonId || '').trim() || String(selectedCloseReasonName || '').trim());
    if (!hasReason) {
      showToast('Informe o motivo de encerramento', 'warning');
      return;
    }

    const confirmed = await confirm({
      title: 'Fechar Ticket',
      message: 'Deseja realmente fechar este ticket? Esta ação não pode ser desfeita.',
      confirmLabel: 'Fechar',
      cancelLabel: 'Cancelar',
      variant: 'warning',
    });
    if (!confirmed) return;

    setClosing(true);
    try {
      const tags = (closeTagsInput || '')
        .split(',')
        .map((tag) => String(tag).trim())
        .filter(Boolean)
        .slice(0, 20);

      await closeTicket(closingTicketId, {
        closeReasonId: selectedCloseReasonId || undefined,
        closeReasonName: selectedCloseReasonName || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });
      showToast('Ticket fechado com sucesso', 'success');
      if (selectedTicket?.id === closingTicketId) {
        setSelectedTicket(null);
      }
      closeCloseModal();
      if (loadTicketsRef.current) loadTicketsRef.current();
    } catch (error) {
      logger.error('Erro ao fechar ticket', error);
      const errorMessage = error?.response?.data?.message || error?.message || 'Erro ao fechar ticket. Tente novamente.';
      showToast(errorMessage, 'error');
    } finally {
      setClosing(false);
    }
  }, [closeCloseModal, closeTagsInput, closingTicketId, confirm, loadTicketsRef, selectedCloseReasonId, selectedCloseReasonName, selectedTicket?.id, setSelectedTicket, showToast]);

  return {
    showCloseModal,
    closing,
    closeReasons,
    selectedCloseReasonId,
    setSelectedCloseReasonId,
    selectedCloseReasonName,
    setSelectedCloseReasonName,
    closeTagsInput,
    setCloseTagsInput,
    handleClose,
    handleConfirmClose,
    closeCloseModal,
  };
}
