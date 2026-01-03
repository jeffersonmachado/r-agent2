import React, { useState, useEffect } from 'react';
import { listTemplates, sendTemplateMessage } from '../api/whatsappTemplates';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import logger from '../utils/logger';

export function WhatsAppTemplatesPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  
  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);
  
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  
  const [sendData, setSendData] = useState({
    to: '',
    parameters: '',
  });

  useEffect(() => {
    if (isAuthenticated) {
      loadTemplates();
    }
  }, [isAuthenticated]);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const data = await listTemplates();
      setTemplates(data.templates || []);
    } catch (error) {
      logger.error('Erro ao carregar templates:', error);
      showToast('Erro ao carregar templates', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!selectedTemplate || !sendData.to.trim()) {
      showToast('Preencha todos os campos', 'error');
      return;
    }
    
    try {
      const parameters = sendData.parameters
        ? sendData.parameters.split(',').map(p => p.trim()).filter(Boolean)
        : [];
      
      await sendTemplateMessage(
        sendData.to,
        selectedTemplate.name,
        'pt_BR',
        parameters
      );
      
      showToast('Mensagem enviada com sucesso!', 'success');
      setShowSendModal(false);
      setSelectedTemplate(null);
      setSendData({ to: '', parameters: '' });
    } catch (error) {
      logger.error('Erro ao enviar template:', error);
      showToast('Erro ao enviar mensagem', 'error');
    }
  };

  const openSendModal = (template) => {
    setSelectedTemplate(template);
    setShowSendModal(true);
  };

  if (authLoading) {
    return (
      <div className="support-page">
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Será redirecionado pelo useEffect
  }

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>Templates WhatsApp Business API</h1>
        </div>
        <p className="text-text-secondary" style={{ marginBottom: '20px' }}>
          Gerencie templates aprovados do WhatsApp
        </p>
      </div>

        {loading ? (
          <div className="text-center py-12">
            <p className="text-text-secondary">Carregando templates...</p>
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-12 bg-bg-elevated rounded-xl border border-border-default">
            <p className="text-text-secondary mb-4">
              Nenhum template encontrado
            </p>
            <p className="text-sm text-text-tertiary">
              Templates devem ser criados e aprovados no painel do Meta Business antes de aparecerem aqui.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {templates.map((template) => (
              <div
                key={template.id || template.name}
                className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg"
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-text-primary mb-1">
                      {template.name}
                    </h3>
                    {template.status && (
                      <span className={`text-xs px-2 py-1 rounded font-medium ${
                        template.status === 'APPROVED' 
                          ? 'bg-status-success/20 text-status-success'
                          : 'bg-status-warning/20 text-status-warning'
                      }`}>
                        {template.status}
                      </span>
                    )}
                  </div>
                </div>
                
                {template.language && (
                  <p className="text-sm text-text-secondary mb-2">
                    Idioma: {template.language}
                  </p>
                )}
                
                {template.category && (
                  <p className="text-sm text-text-secondary mb-4">
                    Categoria: {template.category}
                  </p>
                )}
                
                <Button
                  size="sm"
                  onClick={() => openSendModal(template)}
                  disabled={template.status !== 'APPROVED'}
                >
                  Enviar Mensagem
                </Button>
              </div>
            ))}
          </div>
        )}

      {/* Modal de Envio */}
      {showSendModal && selectedTemplate && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowSendModal(false);
              setSelectedTemplate(null);
            }
          }}
        >
          <div 
            className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold text-text-primary mb-4">
              Enviar Template: {selectedTemplate.name}
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Número do Destinatário
                </label>
                <input
                  value={sendData.to}
                  onChange={(e) => setSendData({ ...sendData, to: e.target.value })}
                  placeholder="5511999999999"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                />
              </div>
              
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Parâmetros (separados por vírgula, se necessário)
                </label>
                <input
                  value={sendData.parameters}
                  onChange={(e) => setSendData({ ...sendData, parameters: e.target.value })}
                  placeholder="Ex: João, 12345"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                />
              </div>
            </div>
            
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="ghost" onClick={() => { setShowSendModal(false); setSelectedTemplate(null); }}>
                Cancelar
              </Button>
              <Button onClick={handleSend}>
                Enviar
              </Button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer />
    </div>
  );
}

