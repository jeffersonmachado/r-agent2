import { Button } from '../../../styles/Button';

export function SupportWorkspaceHeader({
  wsStatus,
  loadTickets,
  loading,
  queues,
  setNewConversationQueue,
  setShowNewConversationModal,
  setCrmContactSearch,
  setCrmContactResults,
  setCrmContactsLoading,
  setSelectedCrmContact,
  webPushSupported,
  webPushEnabled,
  webPushLoading,
  handleDisableWebPush,
  handleEnableWebPush,
  uiContactHistoryOnly,
  canFilterBySelectedContactHistory,
  selectedTicket,
  getContactName,
}) {
  return (
    <div className="support-header">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h1>💬 Atendimento</h1>
      </div>
      <div className="support-controls">
        <div
          className="support-ws-status-control"
          title={wsStatus.title}
          aria-label={`Status WebSocket: ${wsStatus.label}`}
        >
          <span className={`inline-block h-2 w-2 rounded-full ${wsStatus.indicatorDotClassName}`} />
          <span className="support-ws-status-label text-sm text-text-secondary">{wsStatus.label}</span>
        </div>
        <Button
          onClick={() => {
            if (loadTickets) loadTickets();
          }}
          disabled={loading}
          title={loading ? 'Atualizando chamados' : 'Atualizar chamados'}
          aria-label={loading ? 'Atualizando chamados' : 'Atualizar chamados'}
          className="support-refresh-control"
        >
          <span className="support-refresh-icon" aria-hidden="true">{loading ? '⏳' : '🔄'}</span>
          <span className="support-refresh-label">{loading ? 'Carregando...' : 'Atualizar'}</span>
        </Button>
        <Button
          onClick={() => {
            setNewConversationQueue(queues.length > 0 ? queues[0] : '');
            setShowNewConversationModal(true);
            setCrmContactSearch('');
            setCrmContactResults([]);
            setCrmContactsLoading(false);
            setSelectedCrmContact(null);
          }}
          style={{ backgroundColor: '#25D366', color: 'white' }}
        >
          ➕ Iniciar Conversa
        </Button>
        {webPushSupported ? (
          <Button
            onClick={webPushEnabled ? handleDisableWebPush : handleEnableWebPush}
            disabled={webPushLoading}
            title={webPushEnabled ? 'Desativar notificações web' : 'Ativar notificações web'}
          >
            {webPushLoading
              ? 'Processando...'
              : webPushEnabled
                ? '🔔 Desativar notificações'
                : '🔔 Ativar notificações'}
          </Button>
        ) : null}
      </div>
      {uiContactHistoryOnly && canFilterBySelectedContactHistory ? (
        <div className="mt-2 text-sm text-text-secondary">
          Exibindo todo o histórico do contato selecionado: <strong>{getContactName(selectedTicket)}</strong>
        </div>
      ) : null}
    </div>
  );
}
