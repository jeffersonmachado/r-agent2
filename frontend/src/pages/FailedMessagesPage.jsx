import React, { useState, useEffect } from 'react';
import { useRouter } from '../hooks/useRouter';
import { fetchJson } from '../api/client';

export function FailedMessagesPage() {
  const { navigate } = useRouter();
  const [failedMessages, setFailedMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ limit: 50, offset: 0, total: 0 });
  const [filters, setFilters] = useState({
    channel: '',
    status: 'failed',
    sortBy: 'updated_at',
    searchId: '',
  });
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [tab, setTab] = useState('failed');

  // Carregar mensagens (falhadas ou entregues)
  const loadMessages = async (pageLimit = 50, pageOffset = 0) => {
    try {
      setLoading(true);
      setError(null);

      const endpoint = tab === 'delivered' ? '/api/support/delivered-messages' : '/api/support/failed-messages';
      const params = new URLSearchParams({
        limit: pageLimit,
        offset: pageOffset,
        ...(filters.channel && { channel: filters.channel }),
        ...(filters.searchId && { searchId: filters.searchId }),
      });

      // Adiciona status apenas para aba falhadas
      if (tab !== 'delivered') {
        params.append('status', filters.status || 'all');
        params.append('sortBy', filters.sortBy);
      } else {
        params.append('sortBy', filters.sortBy);
      }

      const data = await fetchJson(`${endpoint}?${params}`);
      
      setFailedMessages(data.messages || []);
      setPagination(prev => ({
        ...prev,
        total: data.total || 0,
        limit: data.limit || pageLimit,
        offset: data.offset || pageOffset,
      }));
    } catch (err) {
      console.error('[Messages] Erro ao carregar:', err);
      setError(err.message || 'Erro ao carregar mensagens');
    } finally {
      setLoading(false);
    }
  };

  // Carrega dados na primeira vez e quando tab muda
  useEffect(() => {
    loadMessages(50, 0);
  }, [tab]);

  // Recarrega quando filtros mudam
  useEffect(() => {
    if (!loading) {
      loadMessages(50, 0);
    }
  }, [filters]);

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, offset: 0 }));
  };

  const handlePageChange = (newOffset) => {
    const validOffset = Math.max(0, newOffset);
    setPagination(prev => ({ ...prev, offset: validOffset }));
    loadMessages(pagination.limit, validOffset);
  };

  const handleRetry = () => {
    loadMessages(pagination.limit, pagination.offset);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'failed':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'delivered':
        return 'bg-green-100 text-green-800 border-green-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('pt-BR');
  };

  const formatJson = (obj) => {
    if (!obj) return '';
    if (typeof obj === 'string') {
      try {
        return JSON.stringify(JSON.parse(obj), null, 2);
      } catch {
        return obj;
      }
    }
    return JSON.stringify(obj, null, 2);
  };

  const renderMessageContent = (message) => {
    if (!message) return null;
    
    // Converter para objeto se for string
    let msg;
    if (typeof message === 'string') {
      try {
        msg = JSON.parse(message);
      } catch {
        // Se não for JSON, retornar como texto simples
        return (
          <div className="p-3 bg-bg-secondary rounded-lg text-sm text-text-primary whitespace-pre-wrap break-words">
            {message}
          </div>
        );
      }
    } else {
      msg = message;
    }

    // Se o objeto inteiro for uma string primitiva (raramente)
    if (typeof msg === 'string') {
      return (
        <div className="p-3 bg-bg-secondary rounded-lg text-sm text-text-primary whitespace-pre-wrap break-words">
          {msg}
        </div>
      );
    }

    // Se não for objeto, retornar como está
    if (typeof msg !== 'object' || msg === null) {
      return (
        <div className="p-3 bg-bg-secondary rounded-lg text-sm text-text-primary">
          {String(msg)}
        </div>
      );
    }

    // Helper para extrair valores legíveis de objetos aninhados
    const flattenObject = (obj, prefix = '') => {
      const result = [];
      for (const [key, value] of Object.entries(obj)) {
        const label = prefix ? `${prefix}.${key}` : key;
        if (value === null || value === undefined || value === '') {
          continue;
        }
        if (typeof value === 'object') {
          result.push(...flattenObject(value, label));
        } else {
          result.push({ label, value: String(value) });
        }
      }
      return result;
    };

    // Helper para converter valores complexos em string
    const valueToString = (val) => {
      if (val === null || val === undefined) return '';
      if (typeof val === 'string') {
        // Tentar parsear se for JSON stringificado
        try {
          const parsed = JSON.parse(val);
          if (typeof parsed === 'object') {
            // Se é um objeto simples com só "text", "body", "message" ou "content", retorna só o valor
            const keys = Object.keys(parsed);
            if (keys.length === 1 && ['text', 'body', 'message', 'content'].includes(keys[0])) {
              return String(parsed[keys[0]]);
            }
            // Nunca mostrar JSON - extrair valores legíveis
            const flattened = flattenObject(parsed);
            if (flattened.length === 0) return '';
            return flattened.map(item => `${item.label}: ${item.value}`).join('\n');
          }
          return String(parsed);
        } catch {
          return String(val);
        }
      }
      if (typeof val === 'object') {
        // Se é um objeto simples com só "text", "body", "message" ou "content", retorna só o valor
        const keys = Object.keys(val);
        if (keys.length === 1 && ['text', 'body', 'message', 'content'].includes(keys[0])) {
          return String(val[keys[0]]);
        }
        // Nunca mostrar JSON - extrair valores legíveis
        const flattened = flattenObject(val);
        if (flattened.length === 0) return '';
        return flattened.map(item => `${item.label}: ${item.value}`).join('\n');
      }
      return String(val);
    };

    // Renderizar campo genérico
    const renderField = (label, icon, value) => {
      if (!value) return null;
      return (
        <div>
          <div className="block font-medium text-text-primary mb-1">{icon} {label}:</div>
          <div className="text-sm text-text-primary bg-bg-secondary rounded p-3 whitespace-pre-wrap break-words font-mono border border-border-default">
            {valueToString(value)}
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-4">
        {renderField('Destinatário', '📱', msg.to || msg.phone_number || msg.recipient)}
        {renderField('Remetente', '👤', msg.from || msg.sender)}
        {renderField('Mensagem', '💬', msg.body || msg.text || msg.message || msg.content)}
        {renderField('Tipo', '📎', msg.type || msg.media_type || msg.mediaType)}
        {renderField('Mídia URL', '🖼️', msg.media_url || msg.mediaUrl || msg.image_url || msg.imageUrl)}
        {renderField('Ticket ID', '🎫', msg.ticketId || msg.ticket_id)}
        {renderField('Conversa', '🔗', msg.conversation_id || msg.conversationId || msg.chat_id)}
        {renderField('Cliente', '👥', msg.clientId || msg.client_id || msg.customer_id)}
        {renderField('Account', '🏢', msg.channel_account_id || msg.accountId || msg.account_id)}

        {/* Timestamp */}
        {(msg.timestamp || msg.created_at || msg.sent_at) && (
          <div>
            <div className="block font-medium text-text-primary mb-1">📅 Enviada em:</div>
            <div className="text-sm text-text-primary bg-bg-secondary rounded p-3 whitespace-pre-wrap break-words font-mono border border-border-default">
              {(() => {
                const ts = msg.timestamp || msg.created_at || msg.sent_at;
                const date = new Date(typeof ts === 'number' ? ts * 1000 : ts);
                return date.toLocaleString('pt-BR');
              })()}
            </div>
          </div>
        )}

        {/* Campos adicionais */}
        {(() => {
          const commonFields = ['to', 'phone_number', 'recipient', 'from', 'sender', 'body', 'text', 'message', 'content', 'media_type', 'mediaType', 'media_url', 'mediaUrl', 'image_url', 'imageUrl', 'timestamp', 'created_at', 'sent_at', 'conversation_id', 'conversationId', 'chat_id', 'type', 'ticketId', 'ticket_id', 'clientId', 'client_id', 'customer_id', 'channel_account_id', 'accountId', 'account_id'];
          const others = Object.entries(msg).filter(([key]) => !commonFields.includes(key) && msg[key] !== null && msg[key] !== '');
          
          if (others.length > 0) {
            const combinedData = Object.fromEntries(others);
            const flattened = flattenObject(combinedData);
            
            if (flattened.length > 0) {
              return (
                <div>
                  <div className="block font-medium text-text-primary mb-1">⚙️ Outros dados:</div>
                  <div className="text-sm text-text-primary bg-bg-secondary rounded p-3 font-mono max-h-48 overflow-y-auto border border-border-default whitespace-pre-wrap break-words">
                    {flattened.map(item => `${item.label}: ${item.value}`).join('\n')}
                  </div>
                </div>
              );
            }
          }
          return null;
        })()}
      </div>
    );
  };

  const totalPages = Math.ceil(pagination.total / pagination.limit);
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;

  return (
    <div className="support-page">
      <div className="support-header">
        <h1>Monitoramento de Mensagens</h1>
        <p>Visualize mensagens falhadas, pendentes e entregues</p>
      </div>

      {/* Abas */}
      <div className="bg-bg-elevated rounded-xl border border-border-default mb-6 overflow-hidden">
        <div className="flex border-b border-border-default">
          <button
            onClick={() => setTab('failed')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              tab === 'failed'
                ? 'bg-red-50 text-red-700 border-b-2 border-red-500'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            🚨 Falhadas/Pendentes
          </button>
          <button
            onClick={() => setTab('delivered')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              tab === 'delivered'
                ? 'bg-green-50 text-green-700 border-b-2 border-green-500'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            ✅ Entregues
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6">
        <h3 className="text-lg font-semibold text-text-primary mb-4">Filtros</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Canal</label>
            <select
              value={filters.channel}
              onChange={(e) => handleFilterChange('channel', e.target.value)}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
            >
              <option value="">Todos os canais</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="messenger">Messenger</option>
              <option value="instagram">Instagram</option>
              <option value="telegram">Telegram</option>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
            </select>
          </div>

          {tab !== 'delivered' && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">Status</label>
              <select
                value={filters.status}
                onChange={(e) => handleFilterChange('status', e.target.value)}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
              >
                <option value="failed">Falhado</option>
                <option value="pending">Pendente</option>
                <option value="">Todos</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Ordenar por</label>
            <select
              value={filters.sortBy}
              onChange={(e) => handleFilterChange('sortBy', e.target.value)}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
            >
              <option value="updated_at">Mais recentes</option>
              <option value="attempts">Mais tentativas</option>
              <option value="created_at">Mais antigas</option>
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-text-primary mb-2">🔍 Buscar por ID</label>
          <input
            type="text"
            placeholder="Cole o ID da mensagem (ex: outq-1771528...)"
            value={filters.searchId}
            onChange={(e) => handleFilterChange('searchId', e.target.value)}
            className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary font-mono"
          />
        </div>
      </div>

      {/* Status e carregamento */}
      {loading && (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 text-center">
          <div className="text-text-secondary">Carregando mensagens...</div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-300 rounded-xl p-4 mb-6">
          <div className="text-red-800 text-sm">Erro: {error}</div>
          <button
            onClick={handleRetry}
            className="mt-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Resumo */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-bg-elevated rounded-xl border border-border-default p-4">
              <div className="text-xs text-text-tertiary">Total de Mensagens</div>
              <div className="text-2xl font-semibold text-text-primary">{pagination.total}</div>
              <div className="text-xs text-text-secondary mt-1">registros encontrados</div>
            </div>
            <div className="bg-bg-elevated rounded-xl border border-border-default p-4">
              <div className="text-xs text-text-tertiary">Página {currentPage} de {totalPages || 1}</div>
              <div className="text-2xl font-semibold text-text-primary">{failedMessages.length}</div>
              <div className="text-xs text-text-secondary mt-1">itens por página</div>
            </div>
            <div className="bg-bg-elevated rounded-xl border border-border-default p-4">
              <div className="text-xs text-text-tertiary">Canal: {filters.channel || 'Todos'}</div>
              <div className="text-2xl font-semibold text-text-primary">{filters.status}</div>
              <div className="text-xs text-text-secondary mt-1">status do filtro</div>
            </div>
          </div>

          {/* Tabela de mensagens */}
          <div className="bg-bg-elevated rounded-xl border border-border-default overflow-hidden mb-6">
            {failedMessages.length === 0 ? (
              <div className="p-8 text-center text-text-secondary">
                Nenhuma mensagem falhada encontrada
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-bg-secondary border-b border-border-default">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-text-primary">ID</th>
                      <th className="px-4 py-3 text-left font-medium text-text-primary">Canal</th>
                      <th className="px-4 py-3 text-left font-medium text-text-primary">Status</th>
                      <th className="px-4 py-3 text-left font-medium text-text-primary">Erro</th>
                      <th className="px-4 py-3 text-center font-medium text-text-primary">Tentativas</th>
                      <th className="px-4 py-3 text-left font-medium text-text-primary">Última Tentativa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failedMessages.map((msg, idx) => (
                      <tr key={idx} className="border-b border-border-default hover:bg-bg-secondary transition-colors cursor-pointer" onClick={() => setSelectedMessage(msg)}>
                        <td className="px-4 py-3">
                          <code className="text-xs bg-bg-secondary px-2 py-1 rounded break-all">
                            {msg.id}
                          </code>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-block px-2 py-1 bg-bg-secondary rounded text-xs font-medium">
                            {msg.channel_type || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-1 rounded text-xs font-medium border ${getStatusColor(msg.status)}`}>
                            {msg.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="max-w-xs truncate text-text-secondary" title={msg.last_error}>
                            {msg.last_error || msg.reason_code || '-'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-block px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs font-medium">
                            {msg.attempts || 0}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-text-secondary text-xs">
                          {formatDate(msg.updated_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Paginação */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mb-6">
              <button
                onClick={() => handlePageChange(pagination.offset - pagination.limit)}
                disabled={currentPage === 1}
                className="px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-border-default transition-colors"
              >
                ← Anterior
              </button>

              <div className="text-sm text-text-secondary">
                Página {currentPage} de {totalPages}
              </div>

              <button
                onClick={() => handlePageChange(pagination.offset + pagination.limit)}
                disabled={currentPage === totalPages}
                className="px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-border-default transition-colors"
              >
                Próxima →
              </button>
            </div>
          )}
        </>
      )}

      {/* Modal de Detalhes */}
      {selectedMessage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-bg-elevated rounded-xl border border-border-default max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-bg-secondary border-b border-border-default p-6 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-text-primary">Detalhes da Mensagem</h2>
              <button
                onClick={() => setSelectedMessage(null)}
                className="text-text-secondary hover:text-text-primary text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* ID e Status */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-text-tertiary font-medium mb-2">ID Completo</label>
                  <code className="block p-3 bg-bg-secondary rounded-lg text-sm text-text-primary break-all">
                    {selectedMessage.id}
                  </code>
                </div>
                <div>
                  <label className="block text-xs text-text-tertiary font-medium mb-2">Status</label>
                  <span className={`inline-block px-3 py-2 rounded-lg text-sm font-medium border ${getStatusColor(selectedMessage.status)}`}>
                    {selectedMessage.status}
                  </span>
                </div>
              </div>

              {/* Canal e Tentativas */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-text-tertiary font-medium mb-2">Canal</label>
                  <div className="p-3 bg-bg-secondary rounded-lg text-sm text-text-primary capitalize">
                    {selectedMessage.channel_type || '-'}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-text-tertiary font-medium mb-2">Tentativas</label>
                  <div className="p-3 bg-bg-secondary rounded-lg text-sm text-text-primary">
                    {selectedMessage.attempts || 0} tentativas
                  </div>
                </div>
              </div>

              {/* Datas */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-text-tertiary font-medium mb-2">Criada em</label>
                  <div className="p-3 bg-bg-secondary rounded-lg text-sm text-text-primary">
                    {formatDate(selectedMessage.created_at)}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-text-tertiary font-medium mb-2">Última atualização</label>
                  <div className="p-3 bg-bg-secondary rounded-lg text-sm text-text-primary">
                    {formatDate(selectedMessage.updated_at)}
                  </div>
                </div>
              </div>

              {/* Erro */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs text-text-tertiary font-medium">Última Mensagem de Erro</label>
                  {selectedMessage.last_error && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(selectedMessage.last_error);
                        alert('Erro copiado!');
                      }}
                      className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                    >
                      📋 Copiar
                    </button>
                  )}
                </div>
                <div className="p-3 bg-red-50 rounded-lg text-sm text-red-900 border border-red-200 min-h-12 max-h-40 overflow-y-auto font-mono whitespace-pre-wrap break-words">
                  {selectedMessage.last_error || '-'}
                </div>
              </div>

              {/* Código de Motivo */}
              <div>
                <label className="block text-xs text-text-tertiary font-medium mb-2">Código de Motivo</label>
                <code className="block p-3 bg-bg-secondary rounded-lg text-sm text-text-primary">
                  {selectedMessage.reason_code || '-'}
                </code>
              </div>

              {/* ID Externo (se houve tentativa) */}
              {selectedMessage.external_message_id && (
                <div>
                  <label className="block text-xs text-text-tertiary font-medium mb-2">ID Externo</label>
                  <code className="block p-3 bg-bg-secondary rounded-lg text-sm text-text-primary break-all">
                    {selectedMessage.external_message_id}
                  </code>
                </div>
              )}

              {/* Mensagem (Conteúdo Legível) */}
              {selectedMessage.message && (
                <div>
                  <label className="block text-xs text-text-tertiary font-medium mb-3">📨 Conteúdo da Mensagem</label>
                  <div className="p-4 bg-bg-secondary rounded-lg border border-border-default">
                    {renderMessageContent(selectedMessage.message)}
                  </div>
                </div>
              )}

              {/* Botão fechar */}
              <button
                onClick={() => setSelectedMessage(null)}
                className="w-full px-4 py-2 bg-accent-primary text-white rounded-lg font-medium hover:opacity-90 transition-opacity"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
