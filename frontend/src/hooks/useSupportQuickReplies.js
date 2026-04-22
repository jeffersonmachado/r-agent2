import { useCallback, useEffect, useState } from 'react';
import { listQuickReplies, searchQuickReplies, useQuickReply, getCategories as getQuickReplyCategories } from '../api/quickReplies';

function applyTemplateVariables(text, variables) {
  if (!text) return '';
  const vars = (variables && typeof variables === 'object') ? variables : {};
  return String(text).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key) => {
    const value = vars[key];
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  });
}

export function useSupportQuickReplies({
  selectedTicket,
  setMessageText,
}) {
  const [quickReplySuggestions, setQuickReplySuggestions] = useState([]);
  const [quickReplyCategories, setQuickReplyCategories] = useState([]);
  const [quickReplySelectedCategory, setQuickReplySelectedCategory] = useState('');
  const [quickReplyCategoryItems, setQuickReplyCategoryItems] = useState([]);

  useEffect(() => {
    const context = selectedTicket?.lastUserMessage || '';
    if (!selectedTicket?.id || !context) {
      setQuickReplySuggestions([]);
      return;
    }

    searchQuickReplies(context, 5)
      .then((resp) => setQuickReplySuggestions(resp?.quickReplies || []))
      .catch(() => setQuickReplySuggestions([]));
  }, [selectedTicket?.id, selectedTicket?.lastUserMessage]);

  useEffect(() => {
    getQuickReplyCategories()
      .then((resp) => setQuickReplyCategories(resp?.categories || []))
      .catch(() => setQuickReplyCategories([]));
  }, []);

  useEffect(() => {
    if (!selectedTicket || selectedTicket.status !== 'in_progress') {
      setQuickReplyCategoryItems([]);
      return;
    }

    listQuickReplies({
      category: quickReplySelectedCategory || undefined,
      activeOnly: true,
    })
      .then((resp) => setQuickReplyCategoryItems((resp?.quickReplies || []).slice(0, 12)))
      .catch(() => setQuickReplyCategoryItems([]));
  }, [selectedTicket?.id, selectedTicket?.status, quickReplySelectedCategory]);

  const insertQuickReply = useCallback(async (reply) => {
    if (!reply) return;

    const baseVars = selectedTicket?.context?.variables || {};
    const variables = {
      ...baseVars,
      ticketId: selectedTicket?.id || '',
      telefone: selectedTicket?.phoneNumber || '',
      fila: selectedTicket?.queue || '',
    };

    const rendered = applyTemplateVariables(reply.message || '', variables);

    setMessageText((prev) => {
      const current = (prev || '').trim();
      if (current.startsWith('/')) return rendered;
      return prev ? `${prev}\n${rendered}` : rendered;
    });

    try {
      await useQuickReply(reply.id);
    } catch {
      // best-effort analytics de uso
    }
  }, [selectedTicket, setMessageText]);

  return {
    quickReplySuggestions,
    quickReplyCategories,
    quickReplySelectedCategory,
    setQuickReplySelectedCategory,
    quickReplyCategoryItems,
    insertQuickReply,
  };
}
