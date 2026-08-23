import React, { useEffect, useRef, useState } from 'react';
import { fetchJson } from '../api/client';
import logger from '../utils/logger';

/**
 * AskAiWidget — botão flutuante "Perguntar à IA" presente em todas as telas.
 *
 * Abre um painel de conversa que envia a pergunta do usuário para o endpoint
 * governado `POST /api/ask-ai` (RAG tenant-scoped + domain router) e exibe a
 * resposta com as fontes utilizadas.
 */

const WELCOME_MESSAGE = {
  role: 'assistant',
  content: 'Olá! 👋 Pergunte qualquer coisa sobre a plataforma, seus fluxos, clientes ou processos. Estou aqui para ajudar.',
  sources: [],
};

export function AskAiWidget() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, sending]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const sendQuestion = async (question) => {
    const trimmed = String(question || '').trim();
    if (!trimmed || sending) return;

    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setInput('');
    setError(null);
    setSending(true);

    try {
      const data = await fetchJson('/api/ask-ai', {
        method: 'POST',
        body: JSON.stringify({ question: trimmed }),
      });

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data?.answer || data?.message || 'Não consegui encontrar uma resposta.',
          sources: Array.isArray(data?.sources) ? data.sources : [],
          fromCache: !!data?.fromCache,
        },
      ]);
    } catch (err) {
      logger.error('Erro ao perguntar à IA', err);
      const message = err?.status === 401
        ? 'Sua sessão expirou. Faça login novamente.'
        : 'Não foi possível obter uma resposta agora. Tente novamente.';
      setError(message);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: message, sources: [], isError: true },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    sendQuestion(input);
  };

  return (
    <>
      {open && (
        <div className="fixed bottom-24 left-6 z-[1000] w-[380px] max-w-[calc(100vw-2rem)] rounded-xl border border-border-default bg-bg-elevated shadow-2xl flex flex-col overflow-hidden"
          role="dialog"
          aria-label="Perguntar à IA"
          data-testid="ask-ai-panel"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-default bg-bg-secondary">
            <div className="flex items-center gap-2">
              <span className="text-lg" aria-hidden="true">🤖</span>
              <div>
                <h2 className="text-sm font-semibold text-text-primary">Perguntar à IA</h2>
                <p className="text-xs text-text-tertiary">Respostas baseadas no conhecimento do seu tenant</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-text-secondary hover:text-text-primary text-lg leading-none px-1"
              aria-label="Fechar painel"
            >
              ×
            </button>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[260px] max-h-[420px]">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                    message.role === 'user'
                      ? 'bg-accent-primary text-white'
                      : 'bg-bg-primary text-text-primary border border-border-default'
                  }`}
                  data-testid={message.role === 'user' ? 'ask-ai-user-msg' : 'ask-ai-assistant-msg'}
                >
                  {message.content}
                  {message.sources && message.sources.length > 0 && (
                    <div className="mt-2 border-t border-border-default pt-2">
                      <p className="text-xs font-medium text-text-secondary mb-1">Fontes:</p>
                      <ul className="text-xs text-text-tertiary space-y-1">
                        {message.sources.slice(0, 5).map((source, sourceIndex) => (
                          <li key={sourceIndex} className="truncate">
                            {typeof source === 'string'
                              ? source
                              : (source.title || source.id || source.chunkId || JSON.stringify(source).slice(0, 120))}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-lg px-3 py-2 text-sm bg-bg-primary border border-border-default text-text-tertiary">
                  Pensando…
                </div>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="border-t border-border-default p-3 bg-bg-secondary">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Digite sua pergunta…"
                disabled={sending}
                maxLength={2000}
                className="flex-1 px-3 py-2 text-sm bg-bg-primary border border-border-default rounded text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                data-testid="ask-ai-input"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="px-3 py-2 text-sm font-medium bg-accent-primary text-white rounded hover:opacity-90 disabled:opacity-50"
                data-testid="ask-ai-send"
              >
                Enviar
              </button>
            </div>
            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          </form>
        </div>
      )}

      <div className="fixed bottom-6 left-6 z-[1000] flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((previous) => !previous)}
          className={`flex items-center rounded-full bg-accent-primary text-white shadow-lg hover:opacity-90 transition-opacity ${
            collapsed ? 'justify-center w-12 h-12' : 'gap-2 px-4 py-3'
          }`}
          aria-label={open ? 'Fechar assistente de IA' : 'Perguntar à IA'}
          title={open ? 'Fechar' : 'Perguntar à IA'}
          data-testid="ask-ai-toggle"
        >
          <span className="text-xl leading-none" aria-hidden="true">{open ? '×' : '🤖'}</span>
          {!collapsed && <span className="text-sm font-medium">Perguntar à IA</span>}
        </button>
        <button
          type="button"
          onClick={() => setCollapsed((previous) => !previous)}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-bg-elevated border border-border-default text-text-secondary shadow-md hover:text-text-primary transition-colors"
          aria-label={collapsed ? 'Expandir assistente de IA' : 'Reduzir assistente de IA'}
          title={collapsed ? 'Expandir' : 'Reduzir'}
          data-testid="ask-ai-collapse"
        >
          <span aria-hidden="true">{collapsed ? '›' : '‹'}</span>
        </button>
      </div>
    </>
  );
}
