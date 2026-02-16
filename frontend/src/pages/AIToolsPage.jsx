import React, { useState, useEffect } from 'react';
import { suggestResponse, rewriteMessage } from '../api/aiTools';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { Button } from '../styles/Button';
import logger from '../utils/logger';

export function AIToolsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  
  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);
  
  const [activeTab, setActiveTab] = useState('suggest');
  
  // Sugestão de Resposta
  const [suggestContext, setSuggestContext] = useState({
    userMessage: '',
    conversationHistory: '',
  });
  const [suggestions, setSuggestions] = useState(null);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  
  // Reescrita
  const [rewriteData, setRewriteData] = useState({
    message: '',
    tone: 'professional',
    context: '',
  });
  const [rewritten, setRewritten] = useState(null);
  const [loadingRewrite, setLoadingRewrite] = useState(false);

  const handleSuggest = async () => {
    if (!suggestContext.userMessage.trim()) {
      showToast('Digite uma mensagem do usuário', 'error');
      return;
    }
    
    setLoadingSuggest(true);
    try {
      const history = suggestContext.conversationHistory
        ? suggestContext.conversationHistory.split('\n').map(line => {
            const parts = line.split(':');
            if (parts.length >= 2) {
              return {
                sender: parts[0].trim().toLowerCase() === 'cliente' ? 'user' : 'agent',
                text: parts.slice(1).join(':').trim(),
              };
            }
            return null;
          }).filter(Boolean)
        : [];
      
      const result = await suggestResponse(suggestContext.userMessage, history);
      setSuggestions(result);
    } catch (error) {
      logger.error('Erro ao sugerir resposta:', error);
      showToast('Erro ao gerar sugestões', 'error');
    } finally {
      setLoadingSuggest(false);
    }
  };

  const handleRewrite = async () => {
    if (!rewriteData.message.trim()) {
      showToast('Digite uma mensagem para reescrever', 'error');
      return;
    }
    
    setLoadingRewrite(true);
    try {
      const result = await rewriteMessage(
        rewriteData.message,
        rewriteData.tone,
        rewriteData.context
      );
      setRewritten(result);
    } catch (error) {
      logger.error('Erro ao reescrever mensagem:', error);
      showToast('Erro ao reescrever mensagem', 'error');
    } finally {
      setLoadingRewrite(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    showToast('Copiado para a área de transferência!', 'success');
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
          <h1>🤖 Ferramentas de IA</h1>
        </div>
        <p className="text-text-secondary" style={{ marginBottom: '20px' }}>
          Sugestões de resposta e reescrita inteligente
        </p>
      
        <div className="support-controls">
          <button
            type="button"
            className="btn-default px-4 py-2 text-sm"
            onClick={() => window.location.reload()}
          >
            🔄 Atualizar
          </button>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <p className="text-sm text-text-secondary">Sem filtros específicos para esta tela.</p>
      </div>

        {/* Tabs */}
        <div className="bg-bg-elevated rounded-xl border border-border-default mb-6 shadow-lg">
          <div className="flex border-b border-border-default">
            <button
              onClick={() => setActiveTab('suggest')}
              className={`flex-1 px-6 py-3 text-center font-medium transition-colors ${
                activeTab === 'suggest'
                  ? 'text-accent-primary border-b-2 border-accent-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Sugestão de Resposta
            </button>
            <button
              onClick={() => setActiveTab('rewrite')}
              className={`flex-1 px-6 py-3 text-center font-medium transition-colors ${
                activeTab === 'rewrite'
                  ? 'text-accent-primary border-b-2 border-accent-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Reescrita Inteligente
            </button>
          </div>
        </div>

        {/* Sugestão de Resposta */}
        {activeTab === 'suggest' && (
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <h2 className="text-xl font-semibold text-text-primary mb-4">
              Sugestão de Resposta
            </h2>
            
            <div className="space-y-4 mb-4">
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Última Mensagem do Cliente
                </label>
                <textarea
                  value={suggestContext.userMessage}
                  onChange={(e) => setSuggestContext({ ...suggestContext, userMessage: e.target.value })}
                  placeholder="Ex: Preciso de ajuda com meu pedido"
                  rows={3}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all resize-y"
                />
              </div>
              
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Histórico da Conversa (opcional, formato: Cliente: mensagem ou Atendente: mensagem)
                </label>
                <textarea
                  value={suggestContext.conversationHistory}
                  onChange={(e) => setSuggestContext({ ...suggestContext, conversationHistory: e.target.value })}
                  placeholder="Cliente: Olá&#10;Atendente: Olá! Como posso ajudar?"
                  rows={4}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all resize-y"
                />
              </div>
            </div>
            
            <Button onClick={handleSuggest} disabled={loadingSuggest}>
              {loadingSuggest ? 'Gerando...' : 'Gerar Sugestões'}
            </Button>

            {suggestions && (
              <div className="mt-6 space-y-4">
                {suggestions.suggestions && suggestions.suggestions.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-text-primary mb-3">
                      Sugestões de IA
                    </h3>
                    <div className="space-y-2">
                      {suggestions.suggestions.map((suggestion, index) => (
                        <div
                          key={index}
                          className="border border-border-default rounded-xl p-4 bg-bg-secondary flex justify-between items-start"
                        >
                          <p className="text-text-primary flex-1">
                            {suggestion}
                          </p>
                          <button
                            onClick={() => copyToClipboard(suggestion)}
                            className="ml-4 text-accent-primary hover:text-accent-hover"
                            title="Copiar"
                          >
                            📋
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {suggestions.quickReplies && suggestions.quickReplies.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-text-primary mb-3">
                      Respostas Rápidas Sugeridas
                    </h3>
                    <div className="space-y-2">
                      {suggestions.quickReplies.map((qr) => (
                        <div
                          key={qr.id}
                          className="border border-border-default rounded-xl p-4 bg-bg-secondary flex justify-between items-start"
                        >
                          <div className="flex-1">
                            <p className="font-medium text-text-primary mb-1">
                              {qr.title}
                            </p>
                            <p className="text-text-secondary">
                              {qr.message}
                            </p>
                          </div>
                          <button
                            onClick={() => copyToClipboard(qr.message)}
                            className="ml-4 text-accent-primary hover:text-accent-hover"
                            title="Copiar"
                          >
                            📋
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Reescrita Inteligente */}
        {activeTab === 'rewrite' && (
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <h2 className="text-xl font-semibold text-text-primary mb-4">
              Reescrita Inteligente
            </h2>
            
            <div className="space-y-4 mb-4">
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Mensagem Original
                </label>
                <textarea
                  value={rewriteData.message}
                  onChange={(e) => setRewriteData({ ...rewriteData, message: e.target.value })}
                  placeholder="Ex: Oi, tudo bem?"
                  rows={4}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all resize-y"
                />
              </div>
              
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Tom
                </label>
                <select
                  value={rewriteData.tone}
                  onChange={(e) => setRewriteData({ ...rewriteData, tone: e.target.value })}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
                >
                  <option value="professional">Profissional</option>
                  <option value="friendly">Amigável</option>
                  <option value="formal">Formal</option>
                  <option value="casual">Casual</option>
                </select>
              </div>
              
              <div>
                <label className="block mb-2 text-sm font-medium text-text-primary">
                  Contexto (opcional)
                </label>
                <input
                  value={rewriteData.context}
                  onChange={(e) => setRewriteData({ ...rewriteData, context: e.target.value })}
                  placeholder="Ex: Atendimento ao cliente, problema técnico"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
                />
              </div>
            </div>
            
            <Button onClick={handleRewrite} disabled={loadingRewrite}>
              {loadingRewrite ? 'Reescrevendo...' : 'Reescrever'}
            </Button>

            {rewritten && (
              <div className="mt-6 space-y-4">
                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    Mensagem Original
                  </h3>
                  <div className="border border-border-default rounded-xl p-4 bg-bg-secondary">
                    <p className="text-text-secondary">
                      {rewritten.original}
                    </p>
                  </div>
                </div>
                
                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    Mensagem Reescrita
                  </h3>
                  <div className="border border-accent-primary rounded-xl p-4 bg-accent-light flex justify-between items-start">
                    <p className="text-text-primary flex-1">
                      {rewritten.rewritten}
                    </p>
                    <button
                      onClick={() => copyToClipboard(rewritten.rewritten)}
                      className="ml-4 text-accent-primary hover:text-accent-hover"
                      title="Copiar"
                    >
                      📋
                    </button>
                  </div>
                </div>
                
                {rewritten.improvements && rewritten.improvements.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-text-primary mb-2">
                      Melhorias Aplicadas
                    </h3>
                    <ul className="list-disc list-inside text-text-secondary space-y-1">
                      {rewritten.improvements.map((improvement, index) => (
                        <li key={index}>{improvement}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      <ToastContainer />
    </div>
  );
}
