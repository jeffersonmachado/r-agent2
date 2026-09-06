import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';

const listInboxConversations = vi.fn();
const getInboxConversation = vi.fn();
const replyInboxConversation = vi.fn();
const setInboxConversationStatus = vi.fn();
const createCaseFromConversation = vi.fn();
const getAgentNameById = vi.fn();
const listQuickReplies = vi.fn();
const useQuickReply = vi.fn();
const operatorCallback = vi.fn();
const fetchRecordingFile = vi.fn();

const authDouble = vi.hoisted(() => ({
  capabilities: { inbox: true, caseManagement: true, caseCreationPolicy: 'manual' },
}));

const wsDouble = vi.hoisted(() => ({ onEvent: null }));

const toastDouble = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock('../api/inbox', () => ({
  listInboxConversations: (...args) => listInboxConversations(...args),
  getInboxConversation: (...args) => getInboxConversation(...args),
  replyInboxConversation: (...args) => replyInboxConversation(...args),
  assignInboxConversation: vi.fn(),
  transferInboxConversation: vi.fn(),
  addInboxNote: vi.fn(),
  createCaseFromConversation: (...args) => createCaseFromConversation(...args),
  setInboxConversationStatus: (...args) => setInboxConversationStatus(...args),
}));

vi.mock('../api/quickReplies', () => ({
  listQuickReplies: (...args) => listQuickReplies(...args),
  useQuickReply: (...args) => useQuickReply(...args),
}));

vi.mock('../api/pbx', () => ({
  operatorCallback: (...args) => operatorCallback(...args),
  fetchRecordingFile: (...args) => fetchRecordingFile(...args),
}));

vi.mock('../api/tickets', () => ({
  listQueues: vi.fn(async () => ['comercial', 'suporte']),
}));

vi.mock('../api/auth', () => ({
  getAgentNameById: (...args) => getAgentNameById(...args),
}));

vi.mock('../context/WebSocketContext', () => ({
  useWebSocketContext: ({ onEvent }) => {
    wsDouble.onEvent = onEvent;
    return { connected: true, authenticated: true, send: vi.fn(), reconnect: vi.fn() };
  },
}));

vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('../context/authContext', async () => {
  const actual = await vi.importActual('../context/authContext');
  return {
    ...actual,
    useAuth: () => ({
      isAuthenticated: true,
      loading: false,
      agent: { id: 'agent-1', username: 'test' },
      capabilities: authDouble.capabilities,
    }),
  };
});

const mockNavigate = vi.fn();
vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({ navigate: mockNavigate, currentPath: '/inbox' }),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: toastDouble.showToast,
    ToastContainer: () => null,
  }),
}));

vi.mock('../hooks/usePhoneMasking', () => ({
  usePhoneMasking: () => ({ enabled: false }),
}));

vi.mock('../components/MaskedPhone', () => ({
  MaskedPhone: ({ phone }) => <span>{phone}</span>,
}));

vi.mock('../modules/crud-base', () => ({
  CrudPageBase: ({ children }) => <div>{children}</div>,
}));

vi.mock('../utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { InboxPage } from './InboxPage';

// Contrato novo da listagem (GET /inbox/conversations)
const baseConversation = {
  id: 'c1',
  tenantId: 'tenant-1',
  channelType: 'whatsapp',
  externalId: 'ext-1',
  contactId: 'contact-1',
  status: 'open',
  currentTicketId: null,
  assignedTo: null,
  metadata: {},
  contactName: 'Ana',
  phoneNumber: '+5511999990000',
  lastMessage: { text: 'Oi, tudo bem?', type: 'text', direction: 'in', createdAt: '2026-08-01T10:05:00Z' },
  unreadCount: 0,
  lastMessageAt: '2026-08-01T10:05:00Z',
  createdAt: '2026-08-01T10:00:00Z',
  updatedAt: '2026-08-01T10:05:00Z',
};

describe('pages/InboxPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    wsDouble.onEvent = null;
    authDouble.capabilities = { inbox: true, caseManagement: true, caseCreationPolicy: 'manual' };
    listInboxConversations.mockResolvedValue({ conversations: [], total: 0 });
    getInboxConversation.mockResolvedValue({ conversation: baseConversation, messages: [] });
    getAgentNameById.mockResolvedValue({ agent: { name: 'Agente X' } });
    listQuickReplies.mockResolvedValue({ quickReplies: [] });
    useQuickReply.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllTimers();
    localStorage.clear();
    window.history.pushState({}, '', '/inbox');
  });

  it('deep-link: ?conversationId=conv-9 abre a conversa mesmo fora da lista', async () => {
    window.history.pushState({}, '', '/inbox?conversationId=conv-9');
    const deepLinked = { ...baseConversation, id: 'conv-9', contactName: 'Carlos', unreadCount: 5 };
    listInboxConversations.mockResolvedValue({ conversations: [baseConversation], total: 1 });
    getInboxConversation.mockResolvedValue({ conversation: deepLinked, messages: [] });

    await act(async () => {
      render(<InboxPage />);
    });

    expect(getInboxConversation).toHaveBeenCalledWith('conv-9');
    expect(screen.getByText(/Conversa #conv-9/)).toBeInTheDocument();
    // Painel de detalhes aberto (composer disponível)
    expect(screen.getByRole('button', { name: 'Enviar resposta' })).toBeInTheDocument();
  });

  it('deep-link: id desconhecido mostra toast de erro e permanece na lista', async () => {
    window.history.pushState({}, '', '/inbox?conversationId=conv-404');
    listInboxConversations.mockResolvedValue({ conversations: [baseConversation], total: 1 });
    const notFoundError = new Error('not found');
    notFoundError.status = 404;
    getInboxConversation.mockRejectedValue(notFoundError);

    await act(async () => {
      render(<InboxPage />);
    });

    expect(getInboxConversation).toHaveBeenCalledWith('conv-404');
    expect(toastDouble.showToast).toHaveBeenCalledWith('Conversa não encontrada', 'error');
    // Permanece na lista: painel de detalhes vazio e cards visíveis
    expect(screen.getByText('Selecione uma conversa para visualizar detalhes.')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  it('usa o contrato novo de listagem ({ conversations, total }) com status e canal server-side', async () => {
    listInboxConversations.mockResolvedValue({ conversations: [baseConversation], total: 1 });

    await act(async () => {
      render(<InboxPage />);
    });

    expect(listInboxConversations).toHaveBeenCalled();
    const lastCall = listInboxConversations.mock.calls.at(-1)[0];
    expect(lastCall).toMatchObject({ limit: 500, offset: 0 });
    expect(lastCall.assignedTo).toBeUndefined();
    expect(lastCall.queue).toBeUndefined();
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  it('card renderiza contactName, preview da última mensagem e badge de não lidas', async () => {
    listInboxConversations.mockResolvedValue({
      conversations: [{ ...baseConversation, unreadCount: 3 }],
      total: 1,
    });

    await act(async () => {
      render(<InboxPage />);
    });

    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('+5511999990000')).toBeInTheDocument();
    expect(screen.getByText('Oi, tudo bem?')).toBeInTheDocument();
    // Badge de canal no card (além do <option> do filtro de canal)
    expect(screen.getAllByText('WhatsApp').length).toBeGreaterThan(1);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('card usa placeholder de mídia quando a última mensagem não tem texto', async () => {
    listInboxConversations.mockResolvedValue({
      conversations: [{
        ...baseConversation,
        contactName: null,
        lastMessage: { text: null, type: 'image', direction: 'in', createdAt: '2026-08-01T10:05:00Z' },
      }],
      total: 1,
    });

    await act(async () => {
      render(<InboxPage />);
    });

    // Sem contactName: cai no telefone (nome + linha secundária)
    expect(screen.getAllByText('+5511999990000').length).toBeGreaterThan(0);
    expect(screen.getByText('📷 Imagem')).toBeInTheDocument();
  });

  it('busca livre envia q server-side após debounce de ~300ms', async () => {
    listInboxConversations.mockResolvedValue({ conversations: [baseConversation], total: 1 });

    await act(async () => {
      render(<InboxPage />);
    });

    const callsAfterMount = listInboxConversations.mock.calls.length;
    const input = screen.getByPlaceholderText('Buscar conversa (nome, telefone, mensagem)');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'ana' } });
    });

    // Antes do debounce, sem refetch
    expect(listInboxConversations.mock.calls.length).toBe(callsAfterMount);

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(listInboxConversations.mock.calls.length).toBeGreaterThan(callsAfterMount);
    const lastCall = listInboxConversations.mock.calls.at(-1)[0];
    expect(lastCall).toMatchObject({ q: 'ana', offset: 0 });
  });

  it('botão Resolver chama o endpoint de status e atualiza a UI', async () => {
    listInboxConversations.mockResolvedValue({ conversations: [baseConversation], total: 1 });
    setInboxConversationStatus.mockResolvedValue({
      ok: true,
      conversation: { ...baseConversation, status: 'resolved' },
    });

    await act(async () => {
      render(<InboxPage />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Ana'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resolver' }));
    });

    expect(setInboxConversationStatus).toHaveBeenCalledWith('c1', 'resolved');
    // UI atualizada: status Resolvido e ação passa a ser Reabrir
    expect(screen.getByRole('button', { name: 'Reabrir' })).toBeInTheDocument();
    expect(screen.getAllByText('Resolvido').length).toBeGreaterThan(0);
  });

  it('botão Reabrir aparece em conversa resolvida e chama o endpoint com status open', async () => {
    const resolvedConversation = { ...baseConversation, status: 'resolved' };
    listInboxConversations.mockResolvedValue({ conversations: [resolvedConversation], total: 1 });
    setInboxConversationStatus.mockResolvedValue({
      ok: true,
      conversation: { ...baseConversation, status: 'open' },
    });

    await act(async () => {
      render(<InboxPage />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Ana'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reabrir' }));
    });

    expect(setInboxConversationStatus).toHaveBeenCalledWith('c1', 'open');
    expect(screen.getByRole('button', { name: 'Resolver' })).toBeInTheDocument();
  });

  it('renderiza mídias na thread: imagem clicável e áudio com controls', async () => {
    listInboxConversations.mockResolvedValue({ conversations: [baseConversation], total: 1 });
    getInboxConversation.mockResolvedValue({
      conversation: baseConversation,
      messages: [
        {
          id: 'm1',
          direction: 'in',
          createdAt: '2026-08-01T10:01:00Z',
          body: { type: 'image', mediaUrl: 'https://cdn.exemplo.com/foto.png', text: '' },
        },
        {
          id: 'm2',
          direction: 'out',
          createdAt: '2026-08-01T10:02:00Z',
          body: { type: 'audio', mediaUrl: 'https://cdn.exemplo.com/audio.ogg' },
        },
        {
          id: 'm3',
          direction: 'in',
          createdAt: '2026-08-01T10:03:00Z',
          body: { type: 'document', mediaUrl: 'https://cdn.exemplo.com/boleto.pdf', filename: 'boleto.pdf' },
        },
      ],
    });

    let container;
    await act(async () => {
      ({ container } = render(<InboxPage />));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Ana'));
    });

    const image = container.querySelector('img.inbox-media-image');
    expect(image).not.toBeNull();
    expect(image.getAttribute('src')).toBe('https://cdn.exemplo.com/foto.png');
    expect(image.closest('a').getAttribute('href')).toBe('https://cdn.exemplo.com/foto.png');

    const audio = container.querySelector('audio.inbox-media-audio');
    expect(audio).not.toBeNull();
    expect(audio.getAttribute('src')).toBe('https://cdn.exemplo.com/audio.ogg');

    const docLink = container.querySelector('a.inbox-media-link');
    expect(docLink).not.toBeNull();
    expect(docLink.textContent).toContain('boleto.pdf');
  });

  it('respostas rápidas: picker lista opções e insere o texto no composer sem enviar', async () => {
    listInboxConversations.mockResolvedValue({ conversations: [baseConversation], total: 1 });
    listQuickReplies.mockResolvedValue({
      quickReplies: [{ id: 'qr1', title: 'Saudação', message: 'Olá! Como posso ajudar?' }],
    });

    await act(async () => {
      render(<InboxPage />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Ana'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Respostas rápidas' }));
    });

    expect(listQuickReplies).toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByText('Saudação'));
    });

    const composer = screen.getByPlaceholderText('Escreva a resposta para o cliente');
    expect(composer.value).toBe('Olá! Como posso ajudar?');
    // Não envia automaticamente
    expect(replyInboxConversation).not.toHaveBeenCalled();
    expect(useQuickReply).toHaveBeenCalledWith('qr1');
  });

  it('realtime: mensagem na conversa aberta entra na thread (dedup por id) e zera não lidas', async () => {
    listInboxConversations.mockResolvedValue({
      conversations: [{ ...baseConversation, unreadCount: 2 }],
      total: 1,
    });

    let container;
    await act(async () => {
      ({ container } = render(<InboxPage />));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Ana'));
    });

    const payload = {
      conversationId: 'c1',
      channelType: 'whatsapp',
      tenantId: 'tenant-1',
      message: { id: 'm9', direction: 'in', type: 'text', text: 'mensagem realtime', createdAt: '2026-08-01T10:10:00Z' },
    };

    await act(async () => {
      wsDouble.onEvent('conversation.message.received', payload);
    });
    // Mesmo id novamente: não duplica na thread
    await act(async () => {
      wsDouble.onEvent('conversation.message.received', payload);
    });

    const thread = container.querySelector('.support-details-scroll');
    expect(thread.textContent.match(/mensagem realtime/g)).toHaveLength(1);
    // Badge de não lidas zerado (conversa aberta)
    expect(screen.queryByText('2')).not.toBeInTheDocument();
  });

  it('realtime: mensagem em outra conversa sobe para o topo com unread+1', async () => {
    const other = {
      ...baseConversation,
      id: 'c2',
      contactName: 'Bruno',
      unreadCount: 0,
    };
    listInboxConversations.mockResolvedValue({
      conversations: [baseConversation, other],
      total: 2,
    });

    await act(async () => {
      render(<InboxPage />);
    });

    await act(async () => {
      wsDouble.onEvent('conversation.message.received', {
        conversationId: 'c2',
        channelType: 'whatsapp',
        tenantId: 'tenant-1',
        message: { id: 'm10', direction: 'in', type: 'text', text: 'alô?', createdAt: '2026-08-01T10:11:00Z' },
      });
    });

    expect(screen.getByText('alô?')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    // c2 no topo da lista
    const list = screen.getByRole('list');
    expect(list.firstElementChild.textContent).toContain('Bruno');
  });

  it('realtime: conversation.updated atualiza status da conversa na lista', async () => {
    listInboxConversations.mockResolvedValue({ conversations: [baseConversation], total: 1 });

    await act(async () => {
      render(<InboxPage />);
    });

    await act(async () => {
      wsDouble.onEvent('conversation.updated', {
        conversationId: 'c1',
        tenantId: 'tenant-1',
        status: 'resolved',
        assignedTo: null,
      });
    });

    expect(screen.getByText('Resolvido')).toBeInTheDocument();
  });

  it('caseManagement ligado: mostra Criar chamado, filtro de fila e SLA', async () => {
    listInboxConversations.mockResolvedValue({ conversations: [baseConversation], total: 1 });

    await act(async () => {
      render(<InboxPage />);
    });

    expect(screen.getByText('SLA máx (min)')).toBeInTheDocument();
    expect(screen.getByText('Priorizar SLA estourado')).toBeInTheDocument();
    expect(screen.getByText('Fila')).toBeInTheDocument();

    // Seleciona a conversa para abrir o painel de detalhes
    await act(async () => {
      fireEvent.click(screen.getByText('Ana'));
    });

    expect(screen.getByRole('button', { name: 'Criar chamado' })).toBeInTheDocument();
  });

  it('caseManagement desligado: sem Criar chamado, sem SLA e sem seletor de fila', async () => {
    authDouble.capabilities = { inbox: true, caseManagement: false, caseCreationPolicy: 'manual' };
    listInboxConversations.mockResolvedValue({ conversations: [baseConversation], total: 1 });

    await act(async () => {
      render(<InboxPage />);
    });

    expect(screen.queryByText('SLA máx (min)')).not.toBeInTheDocument();
    expect(screen.queryByText('Priorizar SLA estourado')).not.toBeInTheDocument();
    expect(screen.queryByText('Fila')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('Ana'));
    });

    expect(screen.queryByRole('button', { name: 'Criar chamado' })).not.toBeInTheDocument();
    // Responder continua disponível no modo caixa de entrada simples
    expect(screen.getByRole('button', { name: 'Enviar resposta' })).toBeInTheDocument();
  });

  it('reply usa POST /inbox/conversations/:id/reply', async () => {
    listInboxConversations.mockResolvedValue({ conversations: [baseConversation], total: 1 });
    replyInboxConversation.mockResolvedValue({ message: { id: 'm1' } });

    await act(async () => {
      render(<InboxPage />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Ana'));
    });

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Escreva a resposta para o cliente'), { target: { value: 'Olá!' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enviar resposta' }));
    });

    expect(replyInboxConversation).toHaveBeenCalledWith('c1', 'Olá!');
  });

  it('criar chamado chama o endpoint de case e avisa quando a capability está desligada', async () => {
    listInboxConversations.mockResolvedValue({ conversations: [baseConversation], total: 1 });
    createCaseFromConversation.mockResolvedValue({ case: { id: 'case-1' } });

    await act(async () => {
      render(<InboxPage />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Ana'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Criar chamado' }));
    });

    expect(createCaseFromConversation).toHaveBeenCalledWith('c1', {});
  });

  it('filtro Atendente filtra client-side (sem refetch a cada tecla)', async () => {
    const uuid = '123e4567-e89b-42d3-a456-426614174000';
    listInboxConversations.mockResolvedValue({
      conversations: [
        { ...baseConversation, id: 'c1', assignedTo: uuid, contactName: 'Ana' },
        { ...baseConversation, id: 'c2', assignedTo: 'outro', contactName: 'Bruno' },
      ],
      total: 2,
    });

    await act(async () => {
      render(<InboxPage />);
    });

    const callsAfterMount = listInboxConversations.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);
    expect(getAgentNameById).toHaveBeenCalledTimes(1);

    const input = screen.getByPlaceholderText('ID ou username');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Agente' } });
      vi.advanceTimersByTime(400);
    });

    // Sem refetch: o filtro é client-side no contrato novo
    expect(listInboxConversations.mock.calls.length).toBe(callsAfterMount);
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText('Bruno')).not.toBeInTheDocument();
  });

  it('cacheia resolução de id→nome de atendente entre cargas', async () => {
    const uuid = '123e4567-e89b-42d3-a456-426614174000';
    listInboxConversations.mockResolvedValue({
      conversations: [{ ...baseConversation, assignedTo: uuid }],
      total: 1,
    });

    await act(async () => {
      render(<InboxPage />);
    });

    const nameCallsAfterFirstLoad = getAgentNameById.mock.calls.length;
    expect(nameCallsAfterFirstLoad).toBe(1);

    // Segunda carga (botão Atualizar) com o mesmo uuid: não resolve novamente
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    });

    expect(listInboxConversations.mock.calls.length).toBeGreaterThan(1);
    expect(getAgentNameById.mock.calls.length).toBe(nameCallsAfterFirstLoad);
  });

  it('conversa de voz aparece na lista com badge Voz e preview da chamada', async () => {
    const voiceConversation = {
      ...baseConversation,
      id: 'cv1',
      channelType: 'voice',
      contactName: null,
      phoneNumber: '5511999887766',
      lastMessage: { text: 'Chamada perdida de 5511999887766', type: 'call', direction: 'in', createdAt: '2026-08-01T11:00:00Z' },
      lastMessageAt: '2026-08-01T11:00:00Z',
      unreadCount: 1,
    };
    listInboxConversations.mockResolvedValue({ conversations: [voiceConversation], total: 1 });

    await act(async () => {
      render(<InboxPage />);
    });

    expect(screen.getAllByText('Voz').length).toBeGreaterThan(0);
    expect(screen.getByText('Chamada perdida de 5511999887766')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('chamada perdida inbound: card de voz com botão Retornar chamada que dispara o callback', async () => {
    const voiceConversation = {
      ...baseConversation,
      id: 'cv2',
      channelType: 'voice',
      contactName: null,
      phoneNumber: '5511999887766',
    };
    const callMessage = {
      id: 'mc1',
      direction: 'in',
      type: 'call',
      createdAt: '2026-08-01T11:00:00Z',
      body: {
        type: 'call',
        text: 'Chamada perdida de 5511999887766',
        call: {
          direction: 'in',
          answered: false,
          disposition: 'NO ANSWER',
          durationSec: 25,
          billsec: 0,
          phone: '5511999887766',
          src: '5511999887766',
        },
      },
    };
    listInboxConversations.mockResolvedValue({ conversations: [voiceConversation], total: 1 });
    getInboxConversation.mockResolvedValue({ conversation: voiceConversation, messages: [callMessage] });
    operatorCallback.mockResolvedValue({ ok: true });

    await act(async () => {
      render(<InboxPage />);
    });

    await act(async () => {
      fireEvent.click(screen.getAllByText('5511999887766')[0]);
    });

    expect(screen.getByText('📵 Chamada perdida')).toBeInTheDocument();
    expect(screen.getByText(/De 5511999887766/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retornar chamada para 5511999887766' }));
    });

    expect(operatorCallback).toHaveBeenCalledWith(expect.objectContaining({
      phone: '5511999887766',
      target: '5511999887766',
    }));
    expect(toastDouble.showToast).toHaveBeenCalledWith(expect.stringMatching(/[Rr]etorn/), 'success');
  });

  it('chamada atendida: card mostra duração e NÃO oferece retorno de chamada', async () => {
    const voiceConversation = {
      ...baseConversation,
      id: 'cv3',
      channelType: 'voice',
      contactName: 'Ana',
    };
    const callMessage = {
      id: 'mc2',
      direction: 'in',
      type: 'call',
      createdAt: '2026-08-01T11:05:00Z',
      body: {
        type: 'call',
        text: 'Chamada recebida de 5511999887766 (1 min 5 s)',
        call: {
          direction: 'in',
          answered: true,
          disposition: 'ANSWERED',
          durationSec: 90,
          billsec: 65,
          phone: '5511999887766',
          src: '5511999887766',
        },
      },
    };
    listInboxConversations.mockResolvedValue({ conversations: [voiceConversation], total: 1 });
    getInboxConversation.mockResolvedValue({ conversation: voiceConversation, messages: [callMessage] });

    await act(async () => {
      render(<InboxPage />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Ana'));
    });

    expect(screen.getByText('📞 Chamada recebida')).toBeInTheDocument();
    expect(screen.getByText('Duração: 1 min 5 s')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retornar chamada/ })).not.toBeInTheDocument();
    expect(operatorCallback).not.toHaveBeenCalled();
  });

  it('card de voz exibe transcrição e player de gravação (blob autenticado sob demanda)', async () => {
    const voiceConversation = {
      ...baseConversation,
      id: 'cv4',
      channelType: 'voice',
      contactName: 'Ana',
    };
    const callMessage = {
      id: 'mc3',
      direction: 'in',
      type: 'call',
      createdAt: '2026-08-01T11:10:00Z',
      body: {
        type: 'call',
        text: 'Chamada recebida de 5511999887766 (1 min 5 s)',
        call: {
          direction: 'in',
          answered: true,
          billsec: 65,
          phone: '5511999887766',
          src: '5511999887766',
          recordingId: 'rec-system-1',
        },
        transcription: { text: 'Olá, gostaria de confirmar meu horário de amanhã.', language: 'pt' },
      },
    };
    listInboxConversations.mockResolvedValue({ conversations: [voiceConversation], total: 1 });
    getInboxConversation.mockResolvedValue({ conversation: voiceConversation, messages: [callMessage] });
    fetchRecordingFile.mockResolvedValue(new Blob(['wav'], { type: 'audio/wav' }));
    const createObjectURL = vi.fn(() => 'blob:mock-recording');
    const revokeObjectURL = vi.fn();
    window.URL.createObjectURL = createObjectURL;
    window.URL.revokeObjectURL = revokeObjectURL;

    let container;
    await act(async () => {
      ({ container } = render(<InboxPage />));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Ana'));
    });

    // Transcrição visível no card
    expect(screen.getByTestId('call-transcription')).toHaveTextContent('Olá, gostaria de confirmar meu horário de amanhã.');
    // Player não baixa nada antes do clique
    expect(fetchRecordingFile).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ouvir gravação da chamada' }));
    });

    expect(fetchRecordingFile).toHaveBeenCalledWith('rec-system-1');
    const audio = container.querySelector('audio[data-testid="call-recording-player"]');
    expect(audio).not.toBeNull();
    expect(audio.getAttribute('src')).toBe('blob:mock-recording');
  });

  it('falha no download da gravação mostra estado de erro sem quebrar o card', async () => {
    const voiceConversation = {
      ...baseConversation,
      id: 'cv5',
      channelType: 'voice',
      contactName: 'Ana',
    };
    const callMessage = {
      id: 'mc4',
      direction: 'in',
      type: 'call',
      createdAt: '2026-08-01T11:15:00Z',
      body: {
        type: 'call',
        text: 'Chamada recebida',
        call: { direction: 'in', answered: true, billsec: 10, phone: '5511999887766', recordingId: 'rec-erro' },
      },
    };
    listInboxConversations.mockResolvedValue({ conversations: [voiceConversation], total: 1 });
    getInboxConversation.mockResolvedValue({ conversation: voiceConversation, messages: [callMessage] });
    fetchRecordingFile.mockRejectedValue(new Error('HTTP 403'));

    await act(async () => {
      render(<InboxPage />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Ana'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ouvir gravação da chamada' }));
    });

    expect(screen.getByRole('button', { name: 'Ouvir gravação da chamada' })).toHaveTextContent('Gravação indisponível');
  });
});
