import { Button } from '../../../styles/Button';

export function SupportWorkspaceHeader({
  wsStatus,
  loadTickets,
  loading,
  queues = [],
  setNewConversationQueue,
  setShowNewConversationModal,
  onEnableNotifications,
}) {
  return (
    <div className="support-header">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h1>💬 Atendimento</h1>
      </div>
      <div className="support-controls">
        <button
          type="button"
          className="btn-default px-4 py-2 text-sm auto-filter-toggle-btn"
          aria-label="Mostrar ou ocultar filtros"
          aria-pressed="false"
          title="Mostrar filtros"
        >
          🔍
        </button>
        <div
          className="support-ws-status-control"
          title={wsStatus?.title}
          aria-label={`Status WebSocket: ${wsStatus?.label || 'desconhecido'}`}
        >
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: wsStatus?.color || 'rgb(245, 158, 11)',
              animation: wsStatus?.animated ? 'pulse 2s ease 0s infinite normal none running pulse' : 'none',
            }}
          />
          <span className="support-ws-status-label text-sm text-text-secondary">{wsStatus?.label || 'Desconectado'}</span>
        </div>
        <Button onClick={() => loadTickets?.()} disabled={loading} className="support-refresh-control" title="Atualizar chamados" aria-label="Atualizar chamados">
          <span className="support-refresh-icon" aria-hidden="true">🔄</span>
          <span className="support-refresh-label">{loading ? 'Carregando...' : 'Atualizar'}</span>
        </Button>
        <Button
          onClick={() => {
            setNewConversationQueue?.(queues.length > 0 ? queues[0] : '');
            setShowNewConversationModal?.(true);
          }}
          style={{ backgroundColor: '#25D366', color: 'white' }}
        >
          ➕ Iniciar Conversa
        </Button>
        <Button
          type="button"
          title="Ativar notificações web"
          aria-label="Ativar notificações web"
          onClick={() => onEnableNotifications?.()}
        >
          🔔 Ativar notificações
        </Button>
      </div>
    </div>
  );
}
