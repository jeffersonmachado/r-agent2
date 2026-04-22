import { useCallback, useEffect, useMemo, useState } from 'react';
import { listQuickReplies } from '../api/quickReplies';
import { useDebounce } from './useDebounce';

const BASE_COMMANDS = {
  bot: [
    { id: 'take-over', label: '/assumir', description: 'Assume o atendimento em modo humano.' },
    { id: 'quick-replies', label: '/resposta-rapida', description: 'Abre a lista de respostas rapidas.' },
    { id: 'schedule', label: '/agendar', description: 'Abre o fluxo de agendamento do ticket.' },
    { id: 'delivery-failures', label: '/falhas-entrega', description: 'Mostra as falhas de entrega do ticket.' },
    { id: 'close-ticket', label: '/fechar-ticket', description: 'Inicia o fechamento do ticket.' },
  ],
  human: [
    { id: 'return-to-bot', label: '/devolver-bot', description: 'Devolve o atendimento ao bot.' },
    { id: 'pause', label: '/pausar', description: 'Pausa o atendimento humano.' },
    { id: 'quick-replies', label: '/resposta-rapida', description: 'Abre a lista de respostas rapidas.' },
    { id: 'schedule', label: '/agendar', description: 'Abre o fluxo de agendamento do ticket.' },
    { id: 'delivery-failures', label: '/falhas-entrega', description: 'Mostra as falhas de entrega do ticket.' },
    { id: 'close-ticket', label: '/fechar-ticket', description: 'Inicia o fechamento do ticket.' },
  ],
  paused: [
    { id: 'resume', label: '/retomar', description: 'Retoma o atendimento humano.' },
    { id: 'quick-replies', label: '/resposta-rapida', description: 'Abre a lista de respostas rapidas.' },
    { id: 'schedule', label: '/agendar', description: 'Abre o fluxo de agendamento do ticket.' },
    { id: 'delivery-failures', label: '/falhas-entrega', description: 'Mostra as falhas de entrega do ticket.' },
    { id: 'close-ticket', label: '/fechar-ticket', description: 'Inicia o fechamento do ticket.' },
  ],
};

export function useSupportSlashMenu({
  selectedTicket,
  messageText,
  quickReplySelectedCategory,
  onExecuteSlashCommand,
  onInsertQuickReply,
  onSendMessage,
}) {
  const [quickReplySlashResults, setQuickReplySlashResults] = useState([]);
  const [quickReplySlashOpen, setQuickReplySlashOpen] = useState(false);
  const [slashMenuMode, setSlashMenuMode] = useState('commands');
  const [slashMenuCursorIndex, setSlashMenuCursorIndex] = useState(-1);

  const slashCommandResults = useMemo(() => {
    if (!selectedTicket || selectedTicket.status !== 'in_progress') {
      return [];
    }

    const mode = String(selectedTicket.mode || 'bot').toLowerCase();
    const commands = BASE_COMMANDS[mode] || BASE_COMMANDS.bot;
    const text = String(messageText || '').trim().toLowerCase();
    if (!text.startsWith('/')) {
      return [];
    }

    const query = text.slice(1);
    if (!query) {
      return commands;
    }

    return commands.filter((command) => command.label.includes(`/${query}`));
  }, [messageText, selectedTicket]);

  const closeSlashMenu = useCallback(() => {
    setQuickReplySlashOpen(false);
    setSlashMenuCursorIndex(-1);
  }, []);

  const openQuickReplySlashMenu = useCallback((items) => {
    setSlashMenuMode('quick_replies');
    setQuickReplySlashResults(Array.isArray(items) ? items.slice(0, 8) : []);
    setQuickReplySlashOpen(true);
  }, []);

  const resetSlashResults = useCallback(() => {
    setSlashMenuMode('commands');
    setSlashMenuCursorIndex(-1);
    setQuickReplySlashOpen(false);
    setQuickReplySlashResults([]);
  }, []);

  const { debouncedFn: debouncedSearchSlashQuickReplies } = useDebounce(() => {
    const txt = (messageText || '').trim();
    if (!txt.startsWith('/') || txt.length < 2) {
      resetSlashResults();
      return;
    }

    const query = txt.slice(1);
    listQuickReplies({ search: query, activeOnly: true, category: quickReplySelectedCategory || undefined })
      .then((resp) => {
        const list = resp?.quickReplies || [];
        openQuickReplySlashMenu(list);
      })
      .catch(() => {
        resetSlashResults();
      });
  }, 250);

  useEffect(() => {
    if (!selectedTicket || selectedTicket.status !== 'in_progress') return;
    const text = String(messageText || '').trim();
    if (!text.startsWith('/')) {
      resetSlashResults();
      return;
    }

    if (slashCommandResults.length > 0 || text === '/') {
      setSlashMenuMode('commands');
      setQuickReplySlashOpen(true);
      setQuickReplySlashResults([]);
      return;
    }

    debouncedSearchSlashQuickReplies();
  }, [messageText, selectedTicket?.id, selectedTicket?.status, slashCommandResults, debouncedSearchSlashQuickReplies, resetSlashResults]);

  useEffect(() => {
    if (!quickReplySlashOpen) {
      setSlashMenuCursorIndex(-1);
      return;
    }

    const itemCount = slashMenuMode === 'commands'
      ? slashCommandResults.length
      : quickReplySlashResults.length;

    setSlashMenuCursorIndex(itemCount > 0 ? 0 : -1);
  }, [quickReplySlashOpen, slashMenuMode, slashCommandResults, quickReplySlashResults]);

  const onHoverSlashItem = useCallback((index) => {
    setSlashMenuCursorIndex(index);
  }, []);

  const onSelectSlashItem = useCallback(async (item) => {
    if (!item) return;

    if (item.kind === 'quick_reply' && item.reply) {
      await onInsertQuickReply(item.reply);
      closeSlashMenu();
      return;
    }

    if (item.id === 'quick-replies') {
      const resp = await listQuickReplies({ activeOnly: true, category: quickReplySelectedCategory || undefined });
      openQuickReplySlashMenu(resp?.quickReplies || []);
      return;
    }

    await onExecuteSlashCommand(item.id);
  }, [closeSlashMenu, onExecuteSlashCommand, onInsertQuickReply, openQuickReplySlashMenu, quickReplySelectedCategory]);

  const onComposerKeyDown = useCallback(async (event) => {
    if (event.key === 'Escape' && quickReplySlashOpen) {
      event.preventDefault();
      closeSlashMenu();
      return;
    }

    const menuItems = slashMenuMode === 'commands' ? slashCommandResults : quickReplySlashResults;
    if (quickReplySlashOpen && menuItems.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setSlashMenuCursorIndex((current) => {
        const start = current >= 0 ? current : 0;
        if (event.key === 'ArrowDown') {
          return (start + 1) % menuItems.length;
        }
        return (start - 1 + menuItems.length) % menuItems.length;
      });
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();

      if (quickReplySlashOpen && menuItems.length > 0) {
        const index = slashMenuCursorIndex >= 0 ? slashMenuCursorIndex : 0;
        const selectedItem = slashMenuMode === 'commands'
          ? menuItems[index]
          : { kind: 'quick_reply', reply: menuItems[index] };
        await onSelectSlashItem(selectedItem);
        return;
      }

      await onSendMessage();
    }
  }, [closeSlashMenu, onSelectSlashItem, onSendMessage, quickReplySlashOpen, quickReplySlashResults, slashCommandResults, slashMenuCursorIndex, slashMenuMode]);

  return {
    quickReplySlashResults,
    quickReplySlashOpen,
    slashMenuMode,
    slashCommandResults,
    slashMenuCursorIndex,
    onHoverSlashItem,
    onSelectSlashItem,
    onComposerKeyDown,
    closeSlashMenu,
  };
}
