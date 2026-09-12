import React, { useState, useEffect, useRef } from 'react';
import { listCampaigns, createCampaign, updateCampaign, deleteCampaign, startCampaign, pauseCampaign, resumeCampaign } from '../api/bulkMessaging';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../context/authContext';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useRouter } from '../hooks/useRouter';
import { Button } from '../styles/Button';
import logger from '../utils/logger';
import { CrudPageBase } from '../modules/crud-base';

export function BulkMessagingPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  
  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);
  
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState(null);
  
  const [formData, setFormData] = useState({
    name: '',
    message: '',
    phoneNumbers: '',
    rateLimit: 20,
  });

  useEffect(() => {
    if (isAuthenticated) {
      loadCampaigns();
      // Realtime por PUSH: evento WS `campaign.updated` (acima). Sem polling — a
      // regra do projeto proibe setInterval para sincronizar estado.
      const onVisibilityChange = () => {
        if (document.visibilityState === 'visible') loadCampaigns();
      };
      document.addEventListener('visibilitychange', onVisibilityChange);
      return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  }, [isAuthenticated]);

  const loadInFlightRef = useRef(false);

  const loadCampaigns = async () => {
    // Guarda de overlap: não dispara novo fetch se o anterior não terminou
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    try {
      const data = await listCampaigns();
      setCampaigns(data.campaigns || []);
    } catch (error) {
      logger.error('Erro ao carregar campanhas:', error);
    } finally {
      loadInFlightRef.current = false;
    }
  };

  // Refresh sob demanda via WebSocket: o backend emite `campaign.updated`
  // nas transições de estado e em progresso agregado (throttle de 5s).
  useWebSocketContext({
    enabled: isAuthenticated,
    onEvent: (event) => {
      if (event === 'campaign.updated') {
        loadCampaigns();
      }
    },
    subscribeEvents: ['campaign.updated'],
  });

  const handleCreate = async () => {
    try {
      const phoneNumbers = formData.phoneNumbers.split('\n').map(p => p.trim()).filter(Boolean);
      await createCampaign({
        name: formData.name,
        message: formData.message,
        phoneNumbers,
        rateLimit: parseInt(formData.rateLimit) || 20,
      });
      
      showToast('Campanha criada com sucesso!', 'success');
      setShowModal(false);
      resetForm();
      loadCampaigns();
    } catch (error) {
      logger.error('Erro ao criar campanha:', error);
      showToast('Erro ao criar campanha', 'error');
    }
  };

  const handleStart = async (id) => {
    try {
      await startCampaign(id);
      showToast('Campanha iniciada!', 'success');
      loadCampaigns();
    } catch (error) {
      logger.error('Erro ao iniciar campanha:', error);
      showToast('Erro ao iniciar campanha', 'error');
    }
  };

  const handlePause = async (id) => {
    try {
      await pauseCampaign(id);
      showToast('Campanha pausada!', 'success');
      loadCampaigns();
    } catch (error) {
      logger.error('Erro ao pausar campanha:', error);
      showToast('Erro ao pausar campanha', 'error');
    }
  };

  const handleResume = async (id) => {
    try {
      await resumeCampaign(id);
      showToast('Campanha retomada!', 'success');
      loadCampaigns();
    } catch (error) {
      logger.error('Erro ao retomar campanha:', error);
      showToast('Erro ao retomar campanha', 'error');
    }
  };

  const handleDelete = async (id) => {
    const confirmed = await confirm('Tem certeza que deseja excluir esta campanha?');
    if (!confirmed) return;
    
    try {
      await deleteCampaign(id);
      showToast('Campanha excluída com sucesso!', 'success');
      loadCampaigns();
    } catch (error) {
      logger.error('Erro ao excluir campanha:', error);
      showToast('Erro ao excluir campanha', 'error');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      message: '',
      phoneNumbers: '',
      rateLimit: 20,
    });
    setEditingCampaign(null);
  };

  const getStatusColor = (status) => {
    const colors = {
      draft: 'bg-text-tertiary',
      scheduled: 'bg-status-info',
      sending: 'bg-status-warning',
      completed: 'bg-status-success',
      paused: 'bg-status-warning',
      cancelled: 'bg-status-error',
    };
    return colors[status] || 'bg-text-tertiary';
  };

  const getStatusLabel = (status) => {
    const labels = {
      draft: 'Rascunho',
      scheduled: 'Agendada',
      sending: 'Enviando',
      completed: 'Concluída',
      paused: 'Pausada',
      cancelled: 'Cancelada',
    };
    return labels[status] || status;
  };

  if (authLoading) {
    return (
      <CrudPageBase>
        <div className="page-loading">
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
    );
  }

  if (!isAuthenticated) {
    return null; // Será redirecionado pelo useEffect
  }

  return (
    <CrudPageBase>
      <div className="support-header">
        <div className="page-header">
          <h1>📢 Disparos em Massa</h1>
        </div>
        <p className="text-text-secondary" style={{ marginBottom: '20px' }}>
          Gerencie campanhas de envio em massa
        </p>
        <div className="support-controls">
          <Button 
            onClick={() => { resetForm(); setShowModal(true); }}
            style={{ backgroundColor: '#25D366', color: 'white' }}
          >
            ➕ Nova Campanha
          </Button>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <p className="text-sm text-text-secondary">Sem filtros específicos para esta tela.</p>
      </div>

      {campaigns.length === 0 ? (
        <div className="text-center py-12 bg-bg-elevated rounded-xl border border-border-default">
          <p className="text-text-secondary">Nenhuma campanha encontrada</p>
        </div>
      ) : (
        <div className="space-y-4">
          {campaigns.map((campaign) => (
            <div
              key={campaign.id}
              className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-text-primary">
                      {campaign.name}
                    </h3>
                    <span className={`px-3 py-1 rounded-full text-text-primary text-xs font-medium ${getStatusColor(campaign.status)}`}>
                      {getStatusLabel(campaign.status)}
                    </span>
                  </div>
                  <p className="text-text-secondary mb-3">
                    {campaign.message}
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-text-secondary">Total:</span>
                      <span className="ml-2 font-semibold text-text-primary">
                        {campaign.totalRecipients}
                      </span>
                    </div>
                    <div>
                      <span className="text-text-secondary">Enviados:</span>
                      <span className="ml-2 font-semibold text-status-success">
                        {campaign.sentCount}
                      </span>
                    </div>
                    <div>
                      <span className="text-text-secondary">Falhados:</span>
                      <span className="ml-2 font-semibold text-status-error">
                        {campaign.failedCount}
                      </span>
                    </div>
                    <div>
                      <span className="text-text-secondary">Pendentes:</span>
                      <span className="ml-2 font-semibold text-status-warning">
                        {campaign.pendingCount}
                      </span>
                    </div>
                  </div>
                  {campaign.totalRecipients > 0 && (
                    <div className="mt-3">
                      <div className="w-full bg-bg-secondary rounded-full h-2">
                        <div
                          className="bg-accent-primary h-2 rounded-full transition-all"
                          style={{ width: `${(campaign.sentCount / campaign.totalRecipients) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2 ml-4">
                  {campaign.status === 'draft' && (
                    <Button size="sm" onClick={() => handleStart(campaign.id)}>
                      Iniciar
                    </Button>
                  )}
                  {campaign.status === 'sending' && (
                    <Button size="sm" variant="ghost" onClick={() => handlePause(campaign.id)}>
                      Pausar
                    </Button>
                  )}
                  {campaign.status === 'paused' && (
                    <Button size="sm" onClick={() => handleResume(campaign.id)}>
                      Retomar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(campaign.id)}
                    className="text-red-600"
                  >
                    Excluir
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowModal(false);
            }
          }}
        >
          <div 
            className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold text-text-primary mb-4">
              Nova Campanha
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Nome da Campanha
                </label>
                <input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ex: Campanha Promocional"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                />
              </div>
              
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Mensagem
                </label>
                <textarea
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  placeholder="Digite a mensagem a ser enviada..."
                  rows={4}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all resize-y"
                />
              </div>
              
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Números de Telefone (um por linha)
                </label>
                <textarea
                  value={formData.phoneNumbers}
                  onChange={(e) => setFormData({ ...formData, phoneNumbers: e.target.value })}
                  placeholder="5511999999999&#10;5511888888888"
                  rows={6}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all font-mono text-sm resize-y"
                />
              </div>
              
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Taxa de Envio (mensagens por minuto)
                </label>
                <input
                  type="number"
                  value={formData.rateLimit}
                  onChange={(e) => setFormData({ ...formData, rateLimit: e.target.value })}
                  min="1"
                  max="100"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                />
              </div>
            </div>
            
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={() => { setShowModal(false); resetForm(); }}>
                Cancelar
              </Button>
              <Button onClick={handleCreate}>
                Criar Campanha
              </Button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer />
      <ConfirmDialog />
    </CrudPageBase>
  );
}
