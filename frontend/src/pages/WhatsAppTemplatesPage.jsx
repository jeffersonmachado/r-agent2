import React, { useState, useEffect, useMemo } from 'react';
import { listTemplates, sendTemplateMessage, getTemplate } from '../api/whatsappTemplates';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { Input } from '../styles/Input';
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
  const [allTemplates, setAllTemplates] = useState([]); // Todos os templates (antes dos filtros)
  const [loading, setLoading] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateDetails, setTemplateDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  
  // Filtros e busca
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [languageFilter, setLanguageFilter] = useState('all');
  
  const [sendData, setSendData] = useState({
    to: '',
    parameters: '',
  });
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      loadTemplates();
    }
  }, [isAuthenticated]);

  // Aplica filtros e busca
  useEffect(() => {
    let filtered = [...allTemplates];

    // Busca por nome
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(t => 
        t.name?.toLowerCase().includes(query) ||
        t.id?.toLowerCase().includes(query)
      );
    }

    // Filtro por status
    if (statusFilter !== 'all') {
      filtered = filtered.filter(t => t.status === statusFilter);
    }

    // Filtro por categoria
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(t => t.category === categoryFilter);
    }

    // Filtro por idioma
    if (languageFilter !== 'all') {
      filtered = filtered.filter(t => t.language === languageFilter);
    }

    setTemplates(filtered);
  }, [searchQuery, statusFilter, categoryFilter, languageFilter, allTemplates]);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const data = await listTemplates();
      const templatesList = data.templates || [];
      setAllTemplates(templatesList);
      setTemplates(templatesList);
      showToast('Templates atualizados!', 'success');
    } catch (error) {
      logger.error('Erro ao carregar templates:', error);
      showToast('Erro ao carregar templates', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadTemplateDetails = async (template) => {
    if (!template.id) {
      setTemplateDetails(template);
      return;
    }

    setLoadingDetails(true);
    try {
      const details = await getTemplate(template.id);
      setTemplateDetails(details || template);
    } catch (error) {
      logger.error('Erro ao carregar detalhes do template:', error);
      // Usa o template básico se não conseguir carregar detalhes
      setTemplateDetails(template);
    } finally {
      setLoadingDetails(false);
    }
  };

  const openDetailsModal = async (template) => {
    setSelectedTemplate(template);
    setShowDetailsModal(true);
    await loadTemplateDetails(template);
  };

  const openSendModal = (template) => {
    setSelectedTemplate(template);
    setShowSendModal(true);
    setSendData({ to: '', parameters: '' });
  };

  // Conta variáveis no template ({{1}}, {{2}}, etc)
  const countVariables = (text) => {
    if (!text) return 0;
    const matches = text.match(/\{\{\d+\}\}/g);
    return matches ? matches.length : 0;
  };

  // Extrai variáveis do template
  const extractVariables = (template) => {
    const variables = [];
    if (template.components) {
      template.components.forEach(component => {
        if (component.type === 'BODY' && component.text) {
          const matches = component.text.match(/\{\{(\d+)\}\}/g);
          if (matches) {
            matches.forEach(match => {
              const num = match.match(/\d+/)[0];
              if (!variables.includes(num)) {
                variables.push(num);
              }
            });
          }
        }
      });
    }
    return variables.sort((a, b) => parseInt(a) - parseInt(b));
  };

  const handleSend = async () => {
    if (!selectedTemplate || !sendData.to.trim()) {
      showToast('Preencha o número do destinatário', 'error');
      return;
    }

    // Valida formato do número (deve ter pelo menos 10 dígitos)
    const phoneNumber = sendData.to.replace(/\D/g, '');
    if (phoneNumber.length < 10) {
      showToast('Número de telefone inválido', 'error');
      return;
    }

    // Valida parâmetros se o template tiver variáveis
    const variables = extractVariables(selectedTemplate);
    const parameters = sendData.parameters
      ? sendData.parameters.split(',').map(p => p.trim()).filter(Boolean)
      : [];

    if (variables.length > 0 && parameters.length !== variables.length) {
      showToast(
        `Este template requer ${variables.length} parâmetro(s). Você forneceu ${parameters.length}.`,
        'error'
      );
      return;
    }

    if (variables.length === 0 && parameters.length > 0) {
      showToast('Este template não aceita parâmetros', 'warning');
    }
    
    setSending(true);
    try {
      await sendTemplateMessage(
        phoneNumber,
        selectedTemplate.name,
        selectedTemplate.language || 'pt_BR',
        parameters
      );
      
      showToast('Mensagem enviada com sucesso!', 'success');
      setShowSendModal(false);
      setSelectedTemplate(null);
      setSendData({ to: '', parameters: '' });
    } catch (error) {
      logger.error('Erro ao enviar template:', error);
      showToast(`Erro ao enviar mensagem: ${error.message || 'Erro desconhecido'}`, 'error');
    } finally {
      setSending(false);
    }
  };

  // Lista de status únicos
  const uniqueStatuses = useMemo(() => {
    const statuses = new Set(allTemplates.map(t => t.status).filter(Boolean));
    return Array.from(statuses);
  }, [allTemplates]);

  // Lista de categorias únicas
  const uniqueCategories = useMemo(() => {
    const categories = new Set(allTemplates.map(t => t.category).filter(Boolean));
    return Array.from(categories);
  }, [allTemplates]);

  // Lista de idiomas únicos
  const uniqueLanguages = useMemo(() => {
    const languages = new Set(allTemplates.map(t => t.language).filter(Boolean));
    return Array.from(languages);
  }, [allTemplates]);

  if (authLoading) {
    return (
      <div className="support-page">
        <div className="support-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h1>💬 Templates WhatsApp Business API</h1>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
            <p className="text-text-secondary">Carregando...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Será redirecionado pelo useEffect
  }

  const templateVariables = selectedTemplate ? extractVariables(selectedTemplate) : [];

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>💬 Templates WhatsApp Business API</h1>
        </div>
        <div className="support-controls">
          <Button
            variant="secondary"
            onClick={loadTemplates}
            disabled={loading}
            className="flex items-center gap-2"
          >
            <span>🔄</span>
            <span>{loading ? 'Atualizando...' : 'Atualizar Templates'}</span>
          </Button>
        </div>
        <p className="text-text-secondary text-sm" style={{ marginBottom: '20px' }}>
          Gerencie templates aprovados do WhatsApp
        </p>
      </div>

      {/* Busca e Filtros */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Busca */}
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              🔍 Buscar
            </label>
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Nome ou ID do template..."
              className="w-full"
            />
          </div>

          {/* Filtro Status */}
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
            >
              <option value="all">Todos</option>
              {uniqueStatuses.map(status => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>

          {/* Filtro Categoria */}
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Categoria
            </label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
            >
              <option value="all">Todas</option>
              {uniqueCategories.map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>

          {/* Filtro Idioma */}
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Idioma
            </label>
            <select
              value={languageFilter}
              onChange={(e) => setLanguageFilter(e.target.value)}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
            >
              <option value="all">Todos</option>
              {uniqueLanguages.map(language => (
                <option key={language} value={language}>{language}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Contador de resultados */}
        <div className="mt-4 text-sm text-text-secondary">
          Mostrando {templates.length} de {allTemplates.length} template(s)
        </div>
      </div>

        {/* Lista de Templates */}
        {loading ? (
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
              <p className="text-text-secondary">Carregando templates...</p>
            </div>
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-12 bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
            <p className="text-text-secondary mb-4">
              {allTemplates.length === 0 
                ? 'Nenhum template encontrado'
                : 'Nenhum template corresponde aos filtros'
              }
            </p>
            <p className="text-sm text-text-tertiary">
              {allTemplates.length === 0
                ? 'Templates devem ser criados e aprovados no painel do Meta Business antes de aparecerem aqui.'
                : 'Tente ajustar os filtros de busca.'
              }
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
            {templates.map((template) => {
              const variables = extractVariables(template);
              return (
                <div
                  key={template.id || template.name}
                  className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg hover:border-accent-primary transition-colors"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-text-primary mb-2">
                        {template.name}
                      </h3>
                      {template.status && (
                        <span className={`inline-block text-xs px-2 py-1 rounded font-medium mb-2 ${
                          template.status === 'APPROVED' 
                            ? 'bg-status-success/20 text-status-success'
                            : template.status === 'PENDING'
                            ? 'bg-status-warning/20 text-status-warning'
                            : 'bg-status-error/20 text-status-error'
                        }`}>
                          {template.status}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="space-y-2 mb-4">
                    {template.language && (
                      <p className="text-sm text-text-secondary">
                        🌐 Idioma: {template.language}
                      </p>
                    )}
                    
                    {template.category && (
                      <p className="text-sm text-text-secondary">
                        📁 Categoria: {template.category}
                      </p>
                    )}

                    {variables.length > 0 && (
                      <p className="text-sm text-text-tertiary">
                        🔢 {variables.length} variável(is) necessária(s)
                      </p>
                    )}
                  </div>
                  
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openDetailsModal(template)}
                      className="flex-1"
                    >
                      📋 Detalhes
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => openSendModal(template)}
                      disabled={template.status !== 'APPROVED'}
                      className="flex-1"
                    >
                      ✉️ Enviar
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      {/* Modal de Detalhes */}
        {showDetailsModal && selectedTemplate && (
          <div 
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowDetailsModal(false);
                setSelectedTemplate(null);
                setTemplateDetails(null);
              }
            }}
          >
            <div 
              className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-start mb-6">
                <h2 className="text-2xl font-bold text-text-primary">
                  📋 Detalhes do Template
                </h2>
                <button
                  onClick={() => {
                    setShowDetailsModal(false);
                    setSelectedTemplate(null);
                    setTemplateDetails(null);
                  }}
                  className="text-text-tertiary hover:text-text-primary transition-colors"
                >
                  ✕
                </button>
              </div>

              {loadingDetails ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-primary mx-auto mb-4"></div>
                  <p className="text-text-secondary">Carregando detalhes...</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Informações Básicas */}
                  <div className="bg-bg-secondary rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-text-primary mb-4">Informações Básicas</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-text-tertiary">Nome:</span>
                        <p className="text-text-primary font-medium">{templateDetails?.name || selectedTemplate.name}</p>
                      </div>
                      <div>
                        <span className="text-text-tertiary">ID:</span>
                        <p className="text-text-primary font-mono text-xs">{templateDetails?.id || selectedTemplate.id || 'N/A'}</p>
                      </div>
                      <div>
                        <span className="text-text-tertiary">Status:</span>
                        <p className="text-text-primary">
                          <span className={`px-2 py-1 rounded text-xs ${
                            (templateDetails?.status || selectedTemplate.status) === 'APPROVED'
                              ? 'bg-status-success/20 text-status-success'
                              : 'bg-status-warning/20 text-status-warning'
                          }`}>
                            {templateDetails?.status || selectedTemplate.status}
                          </span>
                        </p>
                      </div>
                      <div>
                        <span className="text-text-tertiary">Categoria:</span>
                        <p className="text-text-primary">{templateDetails?.category || selectedTemplate.category || 'N/A'}</p>
                      </div>
                      <div>
                        <span className="text-text-tertiary">Idioma:</span>
                        <p className="text-text-primary">{templateDetails?.language || selectedTemplate.language || 'N/A'}</p>
                      </div>
                      {templateDetails?.quality_score && (
                        <div>
                          <span className="text-text-tertiary">Qualidade:</span>
                          <p className="text-text-primary">{templateDetails.quality_score}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Componentes do Template */}
                  {templateDetails?.components && templateDetails.components.length > 0 && (
                    <div className="bg-bg-secondary rounded-lg p-4">
                      <h3 className="text-lg font-semibold text-text-primary mb-4">Componentes</h3>
                      <div className="space-y-4">
                        {templateDetails.components.map((component, index) => (
                          <div key={index} className="border-l-2 border-accent-primary pl-4">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs font-medium text-accent-primary uppercase">
                                {component.type}
                              </span>
                              {component.format && (
                                <span className="text-xs text-text-tertiary">
                                  ({component.format})
                                </span>
                              )}
                            </div>
                            
                            {component.text && (
                              <div className="bg-bg-primary rounded p-3 mb-2">
                                <p className="text-text-primary whitespace-pre-wrap">
                                  {component.text}
                                </p>
                                {countVariables(component.text) > 0 && (
                                  <p className="text-xs text-text-tertiary mt-2">
                                    {countVariables(component.text)} variável(is) neste componente
                                  </p>
                                )}
                              </div>
                            )}

                            {component.buttons && component.buttons.length > 0 && (
                              <div className="space-y-2 mt-2">
                                {component.buttons.map((button, btnIndex) => (
                                  <div key={btnIndex} className="bg-bg-primary rounded p-2 text-sm">
                                    <span className="text-text-tertiary">Botão {btnIndex + 1}:</span>
                                    <p className="text-text-primary">{button.text}</p>
                                    {button.type && (
                                      <span className="text-xs text-text-tertiary">({button.type})</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Variáveis Necessárias */}
                  {templateVariables.length > 0 && (
                    <div className="bg-bg-secondary rounded-lg p-4">
                      <h3 className="text-lg font-semibold text-text-primary mb-4">Variáveis Necessárias</h3>
                      <div className="space-y-2">
                        {templateVariables.map((varNum, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <span className="text-accent-primary font-mono">{"{{" + varNum + "}}"}</span>
                            <span className="text-text-secondary">Parâmetro {index + 1}</span>
                          </div>
                        ))}
                        <p className="text-sm text-text-tertiary mt-4">
                          💡 Ao enviar, forneça {templateVariables.length} parâmetro(s) separado(s) por vírgula
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Preview */}
                  {templateDetails?.components && (
                    <div className="bg-bg-secondary rounded-lg p-4">
                      <h3 className="text-lg font-semibold text-text-primary mb-4">Preview</h3>
                      <div className="bg-bg-primary rounded-lg p-4 border border-border-default">
                        <div className="space-y-3">
                          {templateDetails.components.map((component, index) => {
                            if (component.type === 'HEADER' && component.text) {
                              return (
                                <div key={index} className="font-semibold text-text-primary">
                                  {component.text.replace(/\{\{\d+\}\}/g, '[Variável]')}
                                </div>
                              );
                            }
                            if (component.type === 'BODY' && component.text) {
                              return (
                                <div key={index} className="text-text-primary">
                                  {component.text.replace(/\{\{\d+\}\}/g, '[Variável]')}
                                </div>
                              );
                            }
                            if (component.type === 'FOOTER' && component.text) {
                              return (
                                <div key={index} className="text-sm text-text-tertiary italic">
                                  {component.text}
                                </div>
                              );
                            }
                            return null;
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Botões de Ação */}
                  <div className="flex gap-3">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setShowDetailsModal(false);
                        openSendModal(selectedTemplate);
                      }}
                      disabled={selectedTemplate.status !== 'APPROVED'}
                      className="flex-1"
                    >
                      ✉️ Enviar Mensagem
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setShowDetailsModal(false);
                        setSelectedTemplate(null);
                        setTemplateDetails(null);
                      }}
                    >
                      Fechar
                    </Button>
                  </div>
                </div>
              )}
            </div>
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
                setSendData({ to: '', parameters: '' });
              }
            }}
          >
            <div 
              className="bg-bg-elevated rounded-xl border border-border-default p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                ✉️ Enviar Template: {selectedTemplate.name}
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block mb-2 text-sm font-medium text-text-primary">
                    Número do Destinatário <span className="text-status-error">*</span>
                  </label>
                  <Input
                    type="tel"
                    value={sendData.to}
                    onChange={(e) => setSendData({ ...sendData, to: e.target.value })}
                    placeholder="5511999999999"
                    className="w-full"
                    disabled={sending}
                  />
                  <p className="text-xs text-text-tertiary mt-1">
                    Formato: código do país + DDD + número (sem espaços ou caracteres especiais)
                  </p>
                </div>
                
                {templateVariables.length > 0 ? (
                  <div>
                    <label className="block mb-2 text-sm font-medium text-text-primary">
                      Parâmetros <span className="text-status-error">*</span>
                      <span className="text-xs text-text-tertiary ml-2">
                        ({templateVariables.length} necessário(s))
                      </span>
                    </label>
                    <Input
                      type="text"
                      value={sendData.parameters}
                      onChange={(e) => setSendData({ ...sendData, parameters: e.target.value })}
                      placeholder={`Ex: ${templateVariables.map((_, i) => `Parâmetro${i + 1}`).join(', ')}`}
                      className="w-full"
                      disabled={sending}
                    />
                    <p className="text-xs text-text-tertiary mt-1">
                      Separe os parâmetros por vírgula. Ex: João, 12345, Ativo
                    </p>
                    <div className="mt-2 p-2 bg-bg-secondary rounded text-xs">
                      <p className="text-text-secondary mb-1">Variáveis esperadas:</p>
                      <div className="flex flex-wrap gap-1">
                        {templateVariables.map((varNum, index) => (
                          <span key={index} className="px-2 py-1 bg-accent-primary/20 text-accent-primary rounded">
                            {"{{" + varNum + "}}"}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-bg-secondary rounded-lg">
                    <p className="text-sm text-text-secondary">
                      ℹ️ Este template não requer parâmetros
                    </p>
                  </div>
                )}
              </div>
              
              <div className="flex justify-end gap-3 mt-6">
                <Button 
                  variant="ghost" 
                  onClick={() => { 
                    setShowSendModal(false); 
                    setSelectedTemplate(null);
                    setSendData({ to: '', parameters: '' });
                  }}
                  disabled={sending}
                >
                  Cancelar
                </Button>
                <Button 
                  onClick={handleSend}
                  disabled={sending}
                >
                  {sending ? 'Enviando...' : 'Enviar'}
                </Button>
              </div>
            </div>
          </div>
        )}

      <ToastContainer />
    </div>
  );
}
