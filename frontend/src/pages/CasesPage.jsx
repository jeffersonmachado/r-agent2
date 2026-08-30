import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { listCases, getCase, linkConversationToCase, unlinkConversationFromCase } from '../api/cases';
import logger from '../utils/logger';
import { CrudPageBase } from '../modules/crud-base';

function formatDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('pt-BR');
}

function formatStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  const map = {
    open: 'Aberto',
    in_progress: 'Em andamento',
    waiting: 'Aguardando',
    resolved: 'Resolvido',
    closed: 'Fechado',
  };
  return map[normalized] || normalized || 'Aberto';
}

const STATUS_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'open', label: 'Abertos' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'resolved', label: 'Resolvidos' },
  { value: 'closed', label: 'Fechados' },
];

/**
 * Página de Chamados (Case Management): lista, detalhe e vínculo de conversas.
 */
export function CasesPage() {
  const { isAuthenticated, loading: authLoading, agent, capabilities } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const caseManagementEnabled = capabilities?.caseManagement === true;
  const canManageCapabilities = ['owner', 'admin', 'super_admin'].includes(String(agent?.role || '').toLowerCase());

  const [cases, setCases] = useState([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedCase, setSelectedCase] = useState(null);
  const [caseConversations, setCaseConversations] = useState([]);
  const [linkInput, setLinkInput] = useState('');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  const loadCases = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listCases({ status: statusFilter || undefined, limit: 100, offset: 0 });
      setCases(Array.isArray(data?.cases) ? data.cases : []);
      setTotal(Number(data?.total) || 0);
    } catch (err) {
      logger.error('[Cases] Erro ao carregar chamados', err);
      showToast('Erro ao carregar chamados', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, statusFilter]);

  useEffect(() => {
    if (!authLoading && isAuthenticated && caseManagementEnabled) {
      loadCases();
    }
  }, [authLoading, isAuthenticated, caseManagementEnabled, loadCases]);

  const handleSelectCase = useCallback(async (caseItem) => {
    setSelectedCase(caseItem);
    setLinkInput('');
    try {
      const data = await getCase(caseItem.id);
      setSelectedCase(data?.case || caseItem);
      setCaseConversations(Array.isArray(data?.conversations) ? data.conversations : []);
    } catch (err) {
      logger.error('[Cases] Erro ao carregar detalhe do chamado', err);
      showToast('Erro ao carregar detalhe do chamado', 'error');
      setCaseConversations([]);
    }
  }, [showToast]);

  const handleLinkConversation = useCallback(async () => {
    if (!selectedCase || !linkInput.trim()) return;
    try {
      await linkConversationToCase(selectedCase.id, linkInput.trim());
      showToast('Conversa vinculada ao chamado', 'success');
      setLinkInput('');
      await handleSelectCase(selectedCase);
    } catch (err) {
      showToast(err?.message || 'Erro ao vincular conversa', 'error');
    }
  }, [handleSelectCase, linkInput, selectedCase, showToast]);

  const handleUnlinkConversation = useCallback(async (conversationId) => {
    if (!selectedCase || !conversationId) return;
    try {
      await unlinkConversationFromCase(selectedCase.id, conversationId);
      showToast('Conversa desvinculada', 'success');
      await handleSelectCase(selectedCase);
    } catch (err) {
      showToast(err?.message || 'Erro ao desvincular conversa', 'error');
    }
  }, [handleSelectCase, selectedCase, showToast]);

  if (authLoading) {
    return (
      <CrudPageBase>
        <div className="page-loading"><p>Carregando...</p></div>
      </CrudPageBase>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (!caseManagementEnabled) {
    return (
      <CrudPageBase>
        <div className="support-header">
          <h1>🎫 Chamados</h1>
        </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 text-center">
          <h2 className="text-xl font-semibold text-text-primary mb-2">Case Management não está ativo</h2>
          <p className="text-sm text-text-secondary mb-4">
            Este tenant está no modo de atendimento simples (caixa de entrada única).
          </p>
          {canManageCapabilities ? (
            <Button variant="primary" onClick={() => navigate('/config')}>
              Ativar em Configurações
            </Button>
          ) : null}
        </div>
        <ToastContainer />
      </CrudPageBase>
    );
  }

  return (
    <CrudPageBase>
      <div className="support-header">
        <h1>🎫 Chamados</h1>
        <div className="support-controls" style={{ flexWrap: 'wrap' }}>
          <label>
            Status
            <select
              className="support-form-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <Button onClick={loadCases} disabled={loading} className="support-button">
            Atualizar
          </Button>
        </div>
      </div>

      <div className="support-grid">
        <div className="support-tickets-panel">
          <div className="support-tickets-list" role="list">
            {loading ? <p className="support-tickets-empty">Carregando chamados...</p> : null}
            {!loading && cases.length === 0 ? (
              <p className="support-tickets-empty">Nenhum chamado encontrado</p>
            ) : null}
            {cases.map((caseItem) => (
              <div
                key={caseItem.id}
                role="listitem"
                className={`support-ticket-card ${selectedCase?.id === caseItem.id ? 'selected' : ''}`}
                onClick={() => handleSelectCase(caseItem)}
                onKeyDown={(e) => e.key === 'Enter' && handleSelectCase(caseItem)}
                tabIndex={0}
              >
                <div className="support-ticket-contact-row">
                  <span className="support-ticket-contact-name">{caseItem.subject || `Chamado #${caseItem.id}`}</span>
                  <span className={`support-ticket-status ${String(caseItem.status || '').toLowerCase()}`}>
                    {formatStatus(caseItem.status)}
                  </span>
                </div>
                <div className="support-ticket-meta-row">
                  Prioridade {caseItem.priority || 'normal'} • {formatDate(caseItem.updatedAt || caseItem.createdAt)}
                </div>
              </div>
            ))}
          </div>
          <p className="workspace-muted text-sm mt-2">{total} chamado(s)</p>
        </div>

        <div className="support-details-panel">
          {selectedCase ? (
            <div className="support-details-content">
              <div className="support-details-header">
                <h3 className="support-details-title">{selectedCase.subject || `Chamado #${selectedCase.id}`}</h3>
                <div style={{ color: 'var(--color-text-tertiary)' }}>
                  Status: {formatStatus(selectedCase.status)} · Prioridade: {selectedCase.priority || 'normal'}
                </div>
              </div>

              <div className="support-details-section">
                <div className="support-details-subtitle">Conversas vinculadas</div>
                {caseConversations.length === 0 ? (
                  <p style={{ color: 'var(--color-text-tertiary)' }}>Nenhuma conversa vinculada.</p>
                ) : (
                  caseConversations.map((conversation) => (
                    <div key={conversation.id} className="workspace-rail-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <span>
                        #{conversation.id} — {conversation.channelType || 'canal'} · {formatStatus(conversation.status)}
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => handleUnlinkConversation(conversation.id)}>
                        Desvincular
                      </Button>
                    </div>
                  ))
                )}
              </div>

              <div className="support-details-section">
                <div className="support-form-group">
                  <label className="support-form-label">Vincular conversa</label>
                  <input
                    className="support-form-input"
                    value={linkInput}
                    onChange={(e) => setLinkInput(e.target.value)}
                    placeholder="ID da conversa"
                  />
                  <Button onClick={handleLinkConversation} className="support-button-full" disabled={!linkInput.trim()}>
                    Vincular conversa
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="support-details-empty">
              <p>Selecione um chamado para visualizar detalhes.</p>
            </div>
          )}
        </div>
      </div>
      <ToastContainer />
    </CrudPageBase>
  );
}

export default CasesPage;
