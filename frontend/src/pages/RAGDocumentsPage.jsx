import React, { useState, useEffect } from 'react';
import { listDocuments, getDocument, getDocumentsStats, deleteDocument, reindexDocument, reindexAllNotIndexed, queryRag } from '../api/ragDocuments';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import { Button } from '../styles/Button';
import logger from '../utils/logger';

export function RAGDocumentsPage() {
  const { isAuthenticated, loading: authLoading, agent } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();

  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

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

  const [documents, setDocuments] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    source: '',
    status: '',
    search: '',
  });
  const [showReindexModal, setShowReindexModal] = useState(false);
  const [reindexProgress, setReindexProgress] = useState({
    status: 'idle', // idle, processing, completed, error
    message: '',
    total: 0,
    indexed: 0,
    failed: 0,
    errors: [],
  });
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showQueryModal, setShowQueryModal] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [queryResult, setQueryResult] = useState(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [analysisResults, setAnalysisResults] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({
    currentDocument: null,
    currentDocumentIndex: 0,
    totalDocuments: 0,
    currentQuestion: null,
    currentQuestionIndex: 0,
    totalQuestions: 0,
    questionsTested: 0,
    successfulQuestions: 0,
    failedQuestions: 0,
    documentsAnalyzed: 0,
  });

  useEffect(() => {
    loadData();
  }, [filters]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [docs, statsData] = await Promise.all([
        listDocuments(filters),
        getDocumentsStats(),
      ]);
      // Garante que docs seja sempre um array
      const documentsArray = Array.isArray(docs) ? docs : [];
      setDocuments(documentsArray);
      setStats(statsData);
    } catch (error) {
      logger.error('Erro ao carregar dados:', error);
      showToast('Erro ao carregar dados', 'error');
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (doc, closeModal = false) => {
    const confirmed = await confirm({
      title: 'Confirmar exclusão',
      message: `Tem certeza que deseja excluir o documento "${doc.title}"?`,
    });

    if (!confirmed) return;

    try {
      await deleteDocument(doc.id);
      showToast('Documento excluído com sucesso!', 'success');
      if (closeModal) {
        setShowDetailsModal(false);
        setTimeout(() => {
          setSelectedDocument(null);
        }, 300);
      }
      loadData();
    } catch (error) {
      logger.error('Erro ao excluir documento:', error);
      showToast('Erro ao excluir documento', 'error');
    }
  };

  const handleReindex = async (doc, closeModal = false) => {
    try {
      setLoading(true);
      const result = await reindexDocument(doc.id);
      showToast(`Documento reindexado! ${result.chunksCreated} chunks criados.`, 'success');
      if (closeModal) {
        setShowDetailsModal(false);
        setTimeout(() => {
          setSelectedDocument(null);
        }, 300);
      }
      loadData();
    } catch (error) {
      logger.error('Erro ao reindexar:', error);
      showToast('Erro ao reindexar documento', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleShowDetails = (doc) => {
    setSelectedDocument(doc);
    setShowDetailsModal(true);
  };

  const analyzeDocuments = async () => {
    setAnalyzing(true);
    setAnalysisResults(null);

    try {
      const documentsArray = Array.isArray(documents) ? documents : [];
      const tenantId = agent?.tenantId || null;

      // Filtra apenas documentos indexados e ativos
      const indexedDocs = documentsArray.filter(
        doc => doc.indexed && doc.status === 'active' && doc.content
      );

      if (indexedDocs.length === 0) {
        showToast('Não há documentos indexados para analisar', 'warning');
        setAnalyzing(false);
        return;
      }

      // Limita a 10 documentos para não demorar muito
      const docsToAnalyze = indexedDocs.slice(0, 10);
      
      // Calcula total de perguntas estimado
      let totalQuestionsEstimate = 0;
      for (const doc of docsToAnalyze) {
        const title = doc.title || '';
        const content = doc.content || '';
        const contentPreview = content.substring(0, 500);
        const questions = generateQuestionsFromContent(title, contentPreview);
        totalQuestionsEstimate += Math.min(questions.length, 3);
      }

      // Inicializa progresso
      setAnalysisProgress({
        currentDocument: null,
        currentDocumentIndex: 0,
        totalDocuments: docsToAnalyze.length,
        currentQuestion: null,
        currentQuestionIndex: 0,
        totalQuestions: totalQuestionsEstimate,
        questionsTested: 0,
        successfulQuestions: 0,
        failedQuestions: 0,
        documentsAnalyzed: 0,
      });

      const results = [];

      // Analisa cada documento e gera perguntas de teste
      for (let docIndex = 0; docIndex < docsToAnalyze.length; docIndex++) {
        const doc = docsToAnalyze[docIndex];
        
        // Extrai palavras-chave do título e conteúdo
        const title = doc.title || '';
        const content = doc.content || '';
        const contentPreview = content.substring(0, 500);

        // Gera perguntas baseadas no conteúdo
        const questions = generateQuestionsFromContent(title, contentPreview);
        const questionsToTest = questions.slice(0, 3); // Máximo 3 perguntas por documento

        // Atualiza progresso - documento atual
        setAnalysisProgress(prev => ({
          ...prev,
          currentDocument: title,
          currentDocumentIndex: docIndex + 1,
          currentQuestion: null,
          currentQuestionIndex: 0,
        }));

        // Testa cada pergunta com diferentes configurações
        for (let qIndex = 0; qIndex < questionsToTest.length; qIndex++) {
          const question = questionsToTest[qIndex];
          
          // Atualiza progresso - pergunta atual
          setAnalysisProgress(prev => ({
            ...prev,
            currentQuestion: question,
            currentQuestionIndex: qIndex + 1,
          }));

          try {
            // Tenta com minScore mais baixo primeiro (0.3)
            let result = await queryRag(question, tenantId, { topK: 6, minScore: 0.3, maxTokens: 1000 });
            
            // Se não encontrou com 0.3, tenta com 0.45 (padrão otimizado)
            if (!result.success || !result.sources || result.sources.length === 0) {
              result = await queryRag(question, tenantId, { topK: 6, minScore: 0.45, maxTokens: 1000 });
            }
            
            // Verifica se encontrou o documento atual nos resultados
            const foundCurrentDoc = result.sources?.some(s => s.documentId === doc.id) || false;
            
            const isSuccess = result.success && result.sources && result.sources.length > 0;
            
            results.push({
              documentId: doc.id,
              documentTitle: title,
              question,
              success: isSuccess,
              foundCurrentDocument: foundCurrentDoc,
              hasResponse: !!result.response,
              sourcesCount: result.sources?.length || 0,
              confidence: result.confidence || 0,
              response: result.response?.substring(0, 200) || null,
              error: result.error || null,
              metadata: result.metadata || {},
            });

            // Atualiza progresso - estatísticas
            setAnalysisProgress(prev => ({
              ...prev,
              questionsTested: prev.questionsTested + 1,
              successfulQuestions: isSuccess ? prev.successfulQuestions + 1 : prev.successfulQuestions,
              failedQuestions: !isSuccess ? prev.failedQuestions + 1 : prev.failedQuestions,
            }));

            // Pequeno delay para não sobrecarregar
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (error) {
            results.push({
              documentId: doc.id,
              documentTitle: title,
              question,
              success: false,
              foundCurrentDocument: false,
              hasResponse: false,
              sourcesCount: 0,
              confidence: 0,
              response: null,
              error: error.message || 'Erro ao processar pergunta',
              metadata: {},
            });

            // Atualiza progresso - erro
            setAnalysisProgress(prev => ({
              ...prev,
              questionsTested: prev.questionsTested + 1,
              failedQuestions: prev.failedQuestions + 1,
            }));
          }
        }

        // Atualiza progresso - documento concluído
        setAnalysisProgress(prev => ({
          ...prev,
          documentsAnalyzed: prev.documentsAnalyzed + 1,
        }));
      }

      setAnalysisResults({
        totalDocuments: indexedDocs.length,
        documentsAnalyzed: new Set(results.map(r => r.documentId)).size,
        totalQuestions: results.length,
        successfulQuestions: results.filter(r => r.success).length,
        failedQuestions: results.filter(r => !r.success).length,
        results,
      });

      // Limpa progresso detalhado
      setAnalysisProgress({
        currentDocument: null,
        currentDocumentIndex: 0,
        totalDocuments: 0,
        currentQuestion: null,
        currentQuestionIndex: 0,
        totalQuestions: 0,
        questionsTested: 0,
        successfulQuestions: 0,
        failedQuestions: 0,
        documentsAnalyzed: 0,
      });

      showToast(
        `Análise concluída! ${results.filter(r => r.success).length} de ${results.length} perguntas geraram respostas.`,
        'success'
      );
    } catch (error) {
      logger.error('Erro ao analisar documentos:', error);
      showToast('Erro ao analisar documentos', 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  const generateQuestionsFromContent = (title, content) => {
    const questions = [];
    const titleLower = title.toLowerCase();
    const contentLower = content.toLowerCase();

    // Perguntas baseadas no título (mais específicas)
    if (title) {
      // Remove palavras comuns e mantém palavras-chave
      const titleWords = title.split(/\s+/).filter(w => 
        w.length > 3 && !['como', 'para', 'sobre', 'sobre', 'guia', 'manual'].includes(w.toLowerCase())
      );
      if (titleWords.length > 0) {
        const mainTopic = titleWords[0];
        questions.push(`O que é ${mainTopic}?`);
        questions.push(`Como funciona ${mainTopic}?`);
        if (titleWords.length > 1) {
          questions.push(`${titleWords[0]} ${titleWords[1]}`);
        }
      }
    }

    // Perguntas baseadas em palavras-chave específicas do conteúdo
    const keywordPatterns = {
      'senha|password': ['Como resetar minha senha?', 'Como alterar minha senha?', 'Esqueci minha senha'],
      'conta|account': ['Como criar uma conta?', 'Como cancelar minha conta?', 'Como fechar minha conta?'],
      'pagamento|payment|pagar': ['Como fazer um pagamento?', 'Quais são as formas de pagamento?', 'Como pagar?'],
      'suporte|support|ajuda|help': ['Como entrar em contato com o suporte?', 'Onde posso obter ajuda?', 'Preciso de ajuda'],
      'produto|product': ['Quais produtos estão disponíveis?', 'Como comprar um produto?', 'Informações sobre produtos'],
      'ticket|chamado': ['Como abrir um ticket?', 'Como acompanhar meu ticket?', 'Abrir chamado'],
      'configuração|config|settings': ['Como configurar?', 'Onde estão as configurações?', 'Configurações do sistema'],
      'resetar|reset': ['Como resetar?', 'Resetar configurações'],
      'instalar|instalação': ['Como instalar?', 'Instruções de instalação'],
      'erro|error|problema': ['Como resolver este problema?', 'O que fazer quando ocorre erro?'],
    };

    for (const [pattern, questionList] of Object.entries(keywordPatterns)) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(contentLower) || regex.test(titleLower)) {
        questions.push(...questionList);
      }
    }

    // Extrai frases importantes do conteúdo para criar perguntas mais específicas
    if (content.length > 50) {
      // Busca por frases que começam com verbos de ação
      const actionVerbs = ['acesse', 'clique', 'selecione', 'digite', 'insira', 'configure', 'ativar', 'desativar'];
      const sentences = content.split(/[.!?]/).filter(s => s.trim().length > 20 && s.trim().length < 150);
      
      for (const sentence of sentences.slice(0, 3)) {
        const sentenceLower = sentence.toLowerCase().trim();
        for (const verb of actionVerbs) {
          if (sentenceLower.startsWith(verb)) {
            // Cria pergunta baseada na ação
            const question = sentence.replace(/^[^\w]*\w+\s+/, '').trim();
            if (question.length > 10 && question.length < 80) {
              questions.push(`Como ${question}?`);
            }
            break;
          }
        }
      }

      // Se não encontrou perguntas específicas, usa a primeira frase importante
      if (questions.length < 3 && sentences.length > 0) {
        const firstSentence = sentences[0].trim();
        if (firstSentence.length > 20 && firstSentence.length < 100) {
          questions.push(firstSentence);
        }
      }
    }

    // Remove duplicatas e retorna no máximo 5 perguntas
    const uniqueQuestions = [...new Set(questions)];
    return uniqueQuestions.slice(0, 5);
  };

  const handleQuery = async () => {
    if (!queryText.trim()) {
      showToast('Por favor, digite uma pergunta', 'warning');
      return;
    }

    setQueryLoading(true);
    setQueryResult(null);

    try {
      // Obtém tenantId do agente autenticado
      const tenantId = agent?.tenantId || null;

      const result = await queryRag(queryText.trim(), tenantId);
      setQueryResult(result);
      
      // Só mostra erro se não houver resposta válida
      // Quando não há chunks, ainda temos uma resposta válida (mesmo com success=false)
      if (!result.success && !result.response) {
        showToast(result.error || 'Erro ao processar pergunta', 'error');
      } else if (!result.success && result.response) {
        // Quando não há chunks mas há resposta, mostra como informação
        showToast('Nenhum documento relevante encontrado para esta pergunta', 'info');
      }
    } catch (error) {
      logger.error('Erro ao fazer pergunta:', error);
      showToast(error.message || 'Erro ao fazer pergunta', 'error');
      setQueryResult({
        success: false,
        error: error.message || 'Erro desconhecido',
      });
    } finally {
      setQueryLoading(false);
    }
  };

  const handleReindexAll = async () => {
    const confirmed = await confirm({
      title: 'Confirmar reindexação em lote',
      message: `Tem certeza que deseja reindexar todos os documentos não indexados? Esta operação pode demorar alguns minutos.`,
    });

    if (!confirmed) return;

    // Abre o modal de progresso
    setShowReindexModal(true);
    setReindexProgress({
      status: 'processing',
      message: 'Iniciando reindexação...',
      total: stats?.notIndexed || 0,
      indexed: 0,
      failed: 0,
      errors: [],
    });

    try {
      setLoading(true);
      const result = await reindexAllNotIndexed();
      
      if (result.success) {
        if (result.total === 0) {
          setReindexProgress({
            status: 'completed',
            message: 'Não há documentos não indexados para reindexar.',
            total: 0,
            indexed: 0,
            failed: 0,
            errors: [],
          });
          showToast('Não há documentos não indexados para reindexar.', 'info');
        } else {
          setReindexProgress({
            status: 'completed',
            message: `Reindexação concluída! ${result.indexed} documentos indexados, ${result.failed} falharam.`,
            total: result.total,
            indexed: result.indexed,
            failed: result.failed,
            errors: result.errors || [],
          });
          showToast(
            `Reindexação concluída! ${result.indexed} documentos indexados, ${result.failed} falharam.`,
            result.failed > 0 ? 'warning' : 'success'
          );
          if (result.errors && result.errors.length > 0) {
            logger.warn('Erros durante reindexação em lote:', result.errors);
          }
        }
      } else {
        // Tenta extrair mensagem de erro mais detalhada
        let errorMessage = result.error || result.message;
        
        // Se houver erros no array, usa o primeiro
        if (!errorMessage && result.errors && result.errors.length > 0) {
          const firstError = result.errors[0];
          errorMessage = firstError.error || firstError.message || firstError.title || 'Erro desconhecido';
        }
        
        // Mensagem padrão se não houver nenhuma
        if (!errorMessage) {
          errorMessage = 'Erro ao reindexar documentos em lote. Verifique se o serviço RAG está rodando.';
        }
        
        // Melhora mensagem se for sobre serviço RAG indisponível
        if (errorMessage.includes('Serviço RAG') || errorMessage.includes('não está respondendo')) {
          errorMessage = `Serviço RAG não está disponível.\n\nPara iniciar, execute:\ncd rag-service\nuvicorn main:app --reload --host 0.0.0.0 --port 9000`;
        }
        
        setReindexProgress({
          status: 'error',
          message: errorMessage,
          total: result.total || 0,
          indexed: result.indexed || 0,
          failed: result.failed || 0,
          errors: result.errors || [],
        });
        
        logger.error('Erro ao reindexar documentos em lote:', { result, errorMessage });
        showToast(errorMessage, 'error', 10000); // Toast mais longo para mensagem com instruções
      }
      loadData();
    } catch (error) {
      const errorMessage = error.message || error.body?.error || 'Erro ao reindexar documentos em lote';
      setReindexProgress({
        status: 'error',
        message: errorMessage,
        total: 0,
        indexed: 0,
        failed: 0,
        errors: [],
      });
      logger.error('Erro ao reindexar documentos em lote:', { error, errorMessage, stack: error.stack });
      showToast(errorMessage, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Garante que documents seja sempre um array antes de usar filter/map
  const documentsArray = Array.isArray(documents) ? documents : [];
  
  const filteredDocs = documentsArray.filter(doc => {
    if (filters.source && doc.metadata?.source !== filters.source) {
      return false;
    }
    if (filters.status && doc.status !== filters.status) {
      return false;
    }
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      return (
        doc.title?.toLowerCase().includes(searchLower) ||
        doc.content?.toLowerCase().includes(searchLower) ||
        doc.id?.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  const sources = [...new Set(documentsArray.map(doc => doc.metadata?.source).filter(Boolean))];

  return (
    <div className="support-page" style={{ paddingTop: '60px' }}>
      <div className="support-header">
        <div style={{ marginBottom: '10px' }}>
          <h1>📚 Gerenciamento de Documentos RAG</h1>
          <p className="text-text-secondary" style={{ marginTop: '8px', marginBottom: '15px' }}>
            Gerencie todos os documentos indexados no sistema RAG
          </p>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <Button
              onClick={() => setShowQueryModal(true)}
              style={{ 
                backgroundColor: 'var(--status-info)', 
                color: 'white',
                padding: '10px 20px',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              💬 Fazer Pergunta
            </Button>
            <Button
              onClick={() => {
                setShowAnalysisModal(true);
                analyzeDocuments();
              }}
              disabled={analyzing || loading}
              style={{ 
                backgroundColor: 'var(--status-warning)', 
                color: 'white',
                padding: '10px 20px',
                borderRadius: '8px',
                border: 'none',
                cursor: analyzing || loading ? 'not-allowed' : 'pointer',
                opacity: analyzing || loading ? 0.6 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              {analyzing ? '🔍 Analisando...' : '📊 Analisar Documentos'}
            </Button>
            {stats && stats.notIndexed > 0 && (
              <Button
                onClick={handleReindexAll}
                disabled={loading}
                style={{ 
                  backgroundColor: 'var(--accent-primary)', 
                  color: 'white',
                  padding: '10px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.6 : 1,
                  whiteSpace: 'nowrap',
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                {loading ? 'Reindexando...' : `🔄 Reindexar Todos (${stats.notIndexed})`}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Estatísticas */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="text-3xl font-bold text-text-primary mb-2">{stats.total || 0}</div>
            <div className="text-sm text-text-secondary">Total de Documentos</div>
          </div>
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="text-3xl font-bold text-status-success mb-2">{stats.indexed || 0}</div>
            <div className="text-sm text-text-secondary">Indexados</div>
          </div>
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="text-3xl font-bold text-status-error mb-2">{stats.notIndexed || 0}</div>
            <div className="text-sm text-text-secondary">Não Indexados</div>
          </div>
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="text-3xl font-bold text-text-primary mb-2">{stats.totalChunks || 0}</div>
            <div className="text-sm text-text-secondary">Total de Chunks</div>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Buscar
            </label>
            <input
              type="text"
              placeholder="Buscar por título, conteúdo ou ID..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Fonte
            </label>
            <select
              value={filters.source}
              onChange={(e) => setFilters({ ...filters, source: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
            >
              <option value="">Todas as fontes</option>
              {sources.map(source => (
                <option key={source} value={source}>{source}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
            >
              <option value="">Todos os status</option>
              <option value="active">Ativo</option>
              <option value="archived">Arquivado</option>
              <option value="deleted">Deletado</option>
            </select>
          </div>
        </div>
      </div>

      {/* Lista */}
      {loading && documentsArray.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-text-secondary">Carregando...</p>
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="text-center py-12 bg-bg-elevated rounded-xl border border-border-default">
          <p className="text-text-secondary">Nenhum documento encontrado</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredDocs.map(doc => (
            <div
              key={doc.id}
              className="bg-bg-elevated rounded-xl border border-border-default p-6 hover:shadow-lg transition-shadow"
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <h3 className="text-lg font-semibold text-text-primary">
                      {doc.title}
                    </h3>
                    <span className={`text-xs px-2 py-1 rounded ${
                      doc.metadata?.source === 'knowledge_base' ? 'bg-status-info/20 text-status-info' :
                      doc.metadata?.source === 'product_docs' ? 'bg-status-warning/20 text-status-warning' :
                      doc.metadata?.source === 'tickets' ? 'bg-accent-light text-accent-primary' :
                      'bg-bg-secondary text-text-secondary'
                    }`}>
                      {doc.metadata?.source || 'unknown'}
                    </span>
                    <span className={`text-xs px-2 py-1 rounded ${
                      doc.status === 'active' ? 'bg-status-success/20 text-status-success' :
                      doc.status === 'archived' ? 'bg-status-warning/20 text-status-warning' :
                      'bg-status-error/20 text-status-error'
                    }`}>
                      {doc.status}
                    </span>
                  </div>
                  <p className="text-sm text-text-secondary mb-3 line-clamp-3">
                    {doc.content.substring(0, 200)}...
                  </p>
                  <div className="flex flex-wrap gap-2 mb-2 text-xs">
                    <span className="text-text-tertiary">ID: {doc.id.substring(0, 8)}...</span>
                    {doc.metadata?.category && (
                      <span className="px-2 py-1 bg-accent-light text-accent-primary rounded">
                        {doc.metadata.category}
                      </span>
                    )}
                    {doc.metadata?.productId && (
                      <span className="px-2 py-1 bg-status-warning/20 text-status-warning rounded">
                        Produto: {doc.metadata.productId}
                      </span>
                    )}
                    {doc.metadata?.tags?.map(tag => (
                      <span key={tag} className="px-2 py-1 bg-bg-secondary text-text-secondary rounded">
                        {tag}
                      </span>
                    ))}
                    <span className={`px-2 py-1 rounded ${
                      doc.indexed ? 'bg-status-success/20 text-status-success' : 'bg-status-error/20 text-status-error'
                    }`}>
                      {doc.indexed ? '✓ Indexado' : '✗ Não indexado'}
                    </span>
                    {doc.chunksCount > 0 && (
                      <span className="text-text-tertiary">
                        {doc.chunksCount} chunks
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => handleShowDetails(doc)}
                  className="text-accent-primary hover:text-accent-hover"
                  title="Ver detalhes"
                >
                  📄
                </button>
                {!doc.indexed && (
                  <button
                    onClick={() => handleReindex(doc)}
                    className="text-accent-primary hover:text-accent-hover"
                    title="Indexar"
                  >
                    🔍
                  </button>
                )}
                {doc.indexed && (
                  <button
                    onClick={() => handleReindex(doc)}
                    className="text-accent-primary hover:text-accent-hover"
                    title="Reindexar"
                  >
                    🔄
                  </button>
                )}
                <button
                  onClick={() => handleDelete(doc)}
                  className="text-status-error hover:opacity-80"
                  title="Excluir"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ToastContainer />
      <ConfirmDialog />

      {/* Modal de Progresso de Reindexação */}
      <Dialog
        isOpen={showReindexModal}
        onClose={() => {
          // Só permite fechar se não estiver processando
          if (reindexProgress.status !== 'processing') {
            setShowReindexModal(false);
            // Reset do progresso após fechar
            setTimeout(() => {
              setReindexProgress({
                status: 'idle',
                message: '',
                total: 0,
                indexed: 0,
                failed: 0,
                errors: [],
              });
            }, 300);
          }
        }}
        title="Reindexação em Lote"
        size="md"
        showCloseButton={reindexProgress.status !== 'processing'}
      >
        <div className="space-y-4">
          {/* Status e Mensagem */}
          <div className="text-center">
            {reindexProgress.status === 'processing' && (
              <div className="mb-4">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-accent-primary border-t-transparent"></div>
              </div>
            )}
            {reindexProgress.status === 'completed' && (
              <div className="mb-4">
                <div className="inline-block rounded-full h-12 w-12 bg-status-success flex items-center justify-center">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              </div>
            )}
            {reindexProgress.status === 'error' && (
              <div className="mb-4">
                <div className="inline-block rounded-full h-12 w-12 bg-status-error flex items-center justify-center">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
              </div>
            )}
            <p className="text-text-primary font-medium mb-2">
              {reindexProgress.status === 'processing' && 'Processando...'}
              {reindexProgress.status === 'completed' && 'Concluído!'}
              {reindexProgress.status === 'error' && 'Erro'}
            </p>
            <p className="text-text-secondary text-sm whitespace-pre-line">
              {reindexProgress.message}
            </p>
          </div>

          {/* Estatísticas */}
          {reindexProgress.total > 0 && (
            <div className="bg-bg-secondary rounded-lg p-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-text-secondary">Total de documentos:</span>
                <span className="text-text-primary font-semibold">{reindexProgress.total}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-text-secondary">Indexados com sucesso:</span>
                <span className="text-status-success font-semibold">{reindexProgress.indexed}</span>
              </div>
              {reindexProgress.failed > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-text-secondary">Falharam:</span>
                  <span className="text-status-error font-semibold">{reindexProgress.failed}</span>
                </div>
              )}
            </div>
          )}

          {/* Barra de Progresso (Indeterminada durante processamento) */}
          {reindexProgress.status === 'processing' && reindexProgress.total > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Processando</span>
                <span className="text-text-primary">
                  {reindexProgress.total} documento{reindexProgress.total !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="w-full bg-bg-secondary rounded-full h-3 overflow-hidden">
                <div
                  className="bg-accent-primary h-3 rounded-full animate-pulse"
                  style={{ width: '100%' }}
                />
              </div>
              <p className="text-xs text-text-tertiary text-center">
                Aguarde enquanto os documentos são processados...
              </p>
            </div>
          )}

          {/* Barra de Progresso Final */}
          {reindexProgress.status === 'completed' && reindexProgress.total > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Progresso</span>
                <span className="text-text-primary">
                  {reindexProgress.indexed + reindexProgress.failed} / {reindexProgress.total}
                </span>
              </div>
              <div className="w-full bg-bg-secondary rounded-full h-3 overflow-hidden">
                <div
                  className={`h-3 rounded-full transition-all duration-300 flex items-center justify-end pr-2 ${
                    reindexProgress.failed > 0 ? 'bg-status-warning' : 'bg-status-success'
                  }`}
                  style={{ width: '100%' }}
                >
                  <span className="text-xs text-white font-medium">100%</span>
                </div>
              </div>
            </div>
          )}

          {/* Lista de Erros */}
          {reindexProgress.errors && reindexProgress.errors.length > 0 && (
            <div className="bg-status-error/10 border border-status-error/30 rounded-lg p-4 max-h-48 overflow-y-auto">
              <p className="text-status-error font-semibold mb-2">Erros encontrados:</p>
              <ul className="space-y-2 text-sm">
                {reindexProgress.errors.slice(0, 10).map((error, index) => (
                  <li key={index} className="text-text-secondary">
                    <span className="font-medium text-text-primary">
                      {error.title || error.documentId || `Documento ${index + 1}`}:
                    </span>{' '}
                    {error.error || error.message || 'Erro desconhecido'}
                  </li>
                ))}
                {reindexProgress.errors.length > 10 && (
                  <li className="text-text-tertiary italic">
                    ... e mais {reindexProgress.errors.length - 10} erro(s)
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* Botão de Fechar */}
          {reindexProgress.status !== 'processing' && (
            <div className="flex justify-end pt-2">
              <Button
                onClick={() => {
                  setShowReindexModal(false);
                  setTimeout(() => {
                    setReindexProgress({
                      status: 'idle',
                      message: '',
                      total: 0,
                      indexed: 0,
                      failed: 0,
                      errors: [],
                    });
                  }, 300);
                }}
                style={{
                  backgroundColor: 'var(--accent-primary)',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Fechar
              </Button>
            </div>
          )}
        </div>
      </Dialog>

      {/* Modal de Detalhes do Documento */}
      <Dialog
        isOpen={showDetailsModal}
        onClose={() => {
          setShowDetailsModal(false);
          setTimeout(() => {
            setSelectedDocument(null);
          }, 300);
        }}
        title="Detalhes do Documento"
        size="lg"
      >
        {selectedDocument && (
          <div className="space-y-4">
            {/* Título */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Título</label>
              <p className="text-text-primary font-semibold">{selectedDocument.title || 'Sem título'}</p>
            </div>

            {/* ID */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">ID</label>
              <p className="text-text-primary font-mono text-sm break-all">{selectedDocument.id}</p>
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Status</label>
              <span className={`inline-block px-3 py-1 rounded text-sm ${
                selectedDocument.status === 'active' ? 'bg-status-success/20 text-status-success' :
                selectedDocument.status === 'archived' ? 'bg-status-warning/20 text-status-warning' :
                'bg-status-error/20 text-status-error'
              }`}>
                {selectedDocument.status || 'unknown'}
              </span>
            </div>

            {/* Indexação */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Status de Indexação</label>
              <div className="flex items-center gap-3">
                <span className={`inline-block px-3 py-1 rounded text-sm ${
                  selectedDocument.indexed ? 'bg-status-success/20 text-status-success' : 'bg-status-error/20 text-status-error'
                }`}>
                  {selectedDocument.indexed ? '✓ Indexado' : '✗ Não indexado'}
                </span>
                {selectedDocument.chunksCount > 0 && (
                  <span className="text-text-secondary text-sm">
                    {selectedDocument.chunksCount} chunk{selectedDocument.chunksCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {selectedDocument.indexedAt && (
                <p className="text-text-tertiary text-xs mt-1">
                  Indexado em: {new Date(selectedDocument.indexedAt).toLocaleString('pt-BR')}
                </p>
              )}
            </div>

            {/* Fonte */}
            {selectedDocument.metadata?.source && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Fonte</label>
                <span className={`inline-block px-3 py-1 rounded text-sm ${
                  selectedDocument.metadata.source === 'knowledge_base' ? 'bg-status-info/20 text-status-info' :
                  selectedDocument.metadata.source === 'product_docs' ? 'bg-status-warning/20 text-status-warning' :
                  selectedDocument.metadata.source === 'tickets' ? 'bg-accent-light text-accent-primary' :
                  'bg-bg-secondary text-text-secondary'
                }`}>
                  {selectedDocument.metadata.source}
                </span>
              </div>
            )}

            {/* Metadados */}
            {selectedDocument.metadata && Object.keys(selectedDocument.metadata).length > 0 && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Metadados</label>
                <div className="bg-bg-secondary rounded-lg p-4 space-y-2">
                  {selectedDocument.metadata.category && (
                    <div className="flex justify-between">
                      <span className="text-text-secondary text-sm">Categoria:</span>
                      <span className="text-text-primary text-sm">{selectedDocument.metadata.category}</span>
                    </div>
                  )}
                  {selectedDocument.metadata.productId && (
                    <div className="flex justify-between">
                      <span className="text-text-secondary text-sm">ID do Produto:</span>
                      <span className="text-text-primary text-sm font-mono">{selectedDocument.metadata.productId}</span>
                    </div>
                  )}
                  {selectedDocument.metadata.tags && selectedDocument.metadata.tags.length > 0 && (
                    <div>
                      <span className="text-text-secondary text-sm block mb-1">Tags:</span>
                      <div className="flex flex-wrap gap-2">
                        {selectedDocument.metadata.tags.map((tag, index) => (
                          <span key={index} className="px-2 py-1 bg-bg-tertiary text-text-secondary rounded text-xs">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {Object.entries(selectedDocument.metadata)
                    .filter(([key]) => !['source', 'category', 'productId', 'tags'].includes(key))
                    .map(([key, value]) => (
                      <div key={key} className="flex justify-between">
                        <span className="text-text-secondary text-sm">{key}:</span>
                        <span className="text-text-primary text-sm break-all text-right max-w-[60%]">
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Conteúdo */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Conteúdo</label>
              <div className="bg-bg-secondary rounded-lg p-4 max-h-96 overflow-y-auto">
                <p className="text-text-primary text-sm whitespace-pre-wrap break-words">
                  {selectedDocument.content || 'Sem conteúdo'}
                </p>
              </div>
              {selectedDocument.content && (
                <p className="text-text-tertiary text-xs mt-1">
                  {selectedDocument.content.length} caractere{selectedDocument.content.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>

            {/* Datas */}
            <div className="grid grid-cols-2 gap-4">
              {selectedDocument.createdAt && (
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Criado em</label>
                  <p className="text-text-primary text-sm">
                    {new Date(selectedDocument.createdAt).toLocaleString('pt-BR')}
                  </p>
                </div>
              )}
              {selectedDocument.updatedAt && (
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Atualizado em</label>
                  <p className="text-text-primary text-sm">
                    {new Date(selectedDocument.updatedAt).toLocaleString('pt-BR')}
                  </p>
                </div>
              )}
            </div>

            {/* Tenant ID */}
            {selectedDocument.tenantId && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Tenant ID</label>
                <p className="text-text-primary font-mono text-sm break-all">{selectedDocument.tenantId}</p>
              </div>
            )}

            {/* Botões de Ação */}
            <div className="flex gap-2 justify-end pt-4 border-t border-border-default">
              <Button
                onClick={() => {
                  if (selectedDocument) {
                    handleReindex(selectedDocument, true);
                  }
                }}
                disabled={loading}
                style={{
                  backgroundColor: 'var(--accent-primary)',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.6 : 1,
                }}
              >
                {selectedDocument?.indexed ? '🔄 Reindexar' : '🔍 Indexar'}
              </Button>
              <Button
                onClick={() => {
                  if (selectedDocument) {
                    handleDelete(selectedDocument, true);
                  }
                }}
                disabled={loading}
                style={{
                  backgroundColor: 'var(--status-error)',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.6 : 1,
                }}
              >
                🗑️ Excluir
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Modal de Pergunta RAG */}
      <Dialog
        isOpen={showQueryModal}
        onClose={() => {
          setShowQueryModal(false);
          setQueryText('');
          setQueryResult(null);
        }}
        title="Fazer Pergunta ao RAG"
        size="lg"
      >
        <div className="space-y-4">
          {/* Campo de entrada */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Digite sua pergunta
            </label>
            <textarea
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Ex: Como funciona o sistema de tickets?"
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all resize-none"
              rows={4}
              disabled={queryLoading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleQuery();
                }
              }}
            />
            <p className="text-xs text-text-tertiary mt-1">
              Pressione Ctrl+Enter (ou Cmd+Enter no Mac) para enviar
            </p>
          </div>

          {/* Botão de enviar */}
          <div className="flex justify-end">
            <Button
              onClick={handleQuery}
              disabled={queryLoading || !queryText.trim()}
              style={{
                backgroundColor: 'var(--accent-primary)',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                cursor: queryLoading || !queryText.trim() ? 'not-allowed' : 'pointer',
                opacity: queryLoading || !queryText.trim() ? 0.6 : 1,
              }}
            >
              {queryLoading ? 'Processando...' : '🔍 Buscar'}
            </Button>
          </div>

          {/* Resultado */}
          {queryResult && (
            <div className="space-y-4 mt-6 pt-6 border-t border-border-default">
              {queryResult.success || queryResult.response ? (
                <>
                  {/* Resposta */}
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Resposta
                    </label>
                    <div className={`rounded-lg p-4 ${
                      queryResult.success ? 'bg-bg-secondary' : 'bg-status-warning/10 border border-status-warning/30'
                    }`}>
                      <p className="text-text-primary whitespace-pre-wrap">
                        {queryResult.response || 'Sem resposta'}
                      </p>
                    </div>
                    {queryResult.confidence !== undefined && queryResult.confidence > 0 && (
                      <p className="text-xs text-text-tertiary mt-1">
                        Confiança: {Math.round(queryResult.confidence * 100)}%
                      </p>
                    )}
                    {!queryResult.success && (
                      <p className="text-xs text-status-warning mt-1">
                        ⚠️ Nenhum documento relevante encontrado para esta pergunta
                      </p>
                    )}
                  </div>

                  {/* Documentos relacionados */}
                  {queryResult.sources && queryResult.sources.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-2">
                        Documentos Relacionados ({queryResult.sources.length})
                      </label>
                      <div className="space-y-3 max-h-96 overflow-y-auto">
                        {queryResult.sources.map((source, index) => (
                          <div
                            key={index}
                            className="bg-bg-secondary rounded-lg p-4 border border-border-default hover:border-accent-primary transition-colors cursor-pointer"
                            onClick={async () => {
                              try {
                                const doc = await getDocument(source.documentId);
                                if (doc) {
                                  setSelectedDocument(doc);
                                  setShowQueryModal(false);
                                  setTimeout(() => {
                                    setShowDetailsModal(true);
                                  }, 300);
                                } else {
                                  showToast('Documento não encontrado', 'warning');
                                }
                              } catch (error) {
                                logger.error('Erro ao buscar documento:', error);
                                showToast('Erro ao buscar documento', 'error');
                              }
                            }}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex-1">
                                <h4 className="text-text-primary font-semibold mb-1">
                                  {source.title || `Documento ${index + 1}`}
                                </h4>
                                {source.score !== undefined && (
                                  <span className="text-xs text-text-tertiary">
                                    Relevância: {Math.round(source.score * 100)}%
                                  </span>
                                )}
                              </div>
                              <button
                                className="text-accent-primary hover:text-accent-hover text-sm"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    const doc = await getDocument(source.documentId);
                                    if (doc) {
                                      setSelectedDocument(doc);
                                      setShowQueryModal(false);
                                      setTimeout(() => {
                                        setShowDetailsModal(true);
                                      }, 300);
                                    } else {
                                      showToast('Documento não encontrado', 'warning');
                                    }
                                  } catch (error) {
                                    logger.error('Erro ao buscar documento:', error);
                                    showToast('Erro ao buscar documento', 'error');
                                  }
                                }}
                              >
                                📄 Ver detalhes
                              </button>
                            </div>
                            <p className="text-text-secondary text-sm line-clamp-3">
                              {source.excerpt || 'Sem trecho disponível'}
                            </p>
                            {source.documentId && (
                              <p className="text-text-tertiary text-xs mt-2 font-mono">
                                ID: {source.documentId.substring(0, 16)}...
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Metadados */}
                  {queryResult.metadata && (
                    <div className="bg-bg-secondary rounded-lg p-3 text-xs text-text-tertiary">
                      <div className="flex justify-between">
                        <span>Chunks encontrados:</span>
                        <span className="text-text-primary">
                          {queryResult.metadata.chunksFound || 0}
                        </span>
                      </div>
                      {queryResult.metadata.chunksSearched && (
                        <div className="flex justify-between mt-1">
                          <span>Chunks pesquisados:</span>
                          <span className="text-text-primary">
                            {queryResult.metadata.chunksSearched}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="bg-status-error/10 border border-status-error/30 rounded-lg p-4">
                  <p className="text-status-error font-semibold mb-1">Erro</p>
                  <p className="text-text-secondary text-sm">
                    {queryResult.error || 'Erro desconhecido ao processar pergunta'}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </Dialog>

      {/* Modal de Análise de Documentos */}
      <Dialog
        isOpen={showAnalysisModal}
        onClose={() => {
          if (!analyzing) {
            setShowAnalysisModal(false);
            setAnalysisResults(null);
          }
        }}
        title="Análise de Documentos RAG"
        size="xl"
        showCloseButton={!analyzing}
      >
        <div className="space-y-4">
          {analyzing && (
            <div className="space-y-6">
              {/* Indicador de carregamento */}
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-accent-primary border-t-transparent mb-4"></div>
                <p className="text-text-primary font-medium text-lg">Analisando documentos e testando perguntas...</p>
                <p className="text-text-secondary text-sm mt-2">Isso pode levar alguns minutos</p>
              </div>

              {/* Progresso Geral */}
              {analysisProgress.totalDocuments > 0 && (
                <div className="bg-bg-secondary rounded-lg p-4 space-y-4">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-text-primary font-medium">Progresso Geral</span>
                      <span className="text-text-secondary text-sm">
                        {analysisProgress.documentsAnalyzed} / {analysisProgress.totalDocuments} documentos
                      </span>
                    </div>
                    <div className="w-full bg-bg-tertiary rounded-full h-3 overflow-hidden">
                      <div
                        className="bg-accent-primary h-3 rounded-full transition-all duration-300"
                        style={{
                          width: `${(analysisProgress.documentsAnalyzed / analysisProgress.totalDocuments) * 100}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Documento Atual */}
                  {analysisProgress.currentDocument && (
                    <div className="border-t border-border-default pt-4">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-text-secondary text-sm">Documento atual:</span>
                        <span className="text-text-primary font-medium text-sm">
                          {analysisProgress.currentDocumentIndex} / {analysisProgress.totalDocuments}
                        </span>
                      </div>
                      <p className="text-text-primary font-semibold truncate" title={analysisProgress.currentDocument}>
                        {analysisProgress.currentDocument}
                      </p>
                    </div>
                  )}

                  {/* Pergunta Atual */}
                  {analysisProgress.currentQuestion && (
                    <div className="border-t border-border-default pt-4">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-text-secondary text-sm">Pergunta atual:</span>
                        <span className="text-text-primary font-medium text-sm">
                          {analysisProgress.currentQuestionIndex} / 3
                        </span>
                      </div>
                      <p className="text-text-primary text-sm italic truncate" title={analysisProgress.currentQuestion}>
                        "{analysisProgress.currentQuestion}"
                      </p>
                    </div>
                  )}

                  {/* Estatísticas em Tempo Real */}
                  <div className="border-t border-border-default pt-4">
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <div className="text-2xl font-bold text-text-primary">
                          {analysisProgress.questionsTested}
                        </div>
                        <div className="text-xs text-text-secondary">Perguntas Testadas</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-status-success">
                          {analysisProgress.successfulQuestions}
                        </div>
                        <div className="text-xs text-text-secondary">Com Resposta</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-status-error">
                          {analysisProgress.failedQuestions}
                        </div>
                        <div className="text-xs text-text-secondary">Sem Resposta</div>
                      </div>
                    </div>
                    {analysisProgress.questionsTested > 0 && (
                      <div className="mt-3 pt-3 border-t border-border-default">
                        <div className="flex items-center justify-between">
                          <span className="text-text-secondary text-sm">Taxa de sucesso:</span>
                          <span className="text-text-primary font-semibold">
                            {Math.round((analysisProgress.successfulQuestions / analysisProgress.questionsTested) * 100)}%
                          </span>
                        </div>
                        <div className="w-full bg-bg-tertiary rounded-full h-2 mt-2 overflow-hidden">
                          <div
                            className="bg-status-success h-2 rounded-full transition-all duration-300"
                            style={{
                              width: `${(analysisProgress.successfulQuestions / analysisProgress.questionsTested) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {!analyzing && analysisResults && (
            <>
              {/* Resumo */}
              <div className="bg-bg-secondary rounded-lg p-4">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Resumo da Análise</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-2xl font-bold text-text-primary">{analysisResults.documentsAnalyzed}</div>
                    <div className="text-sm text-text-secondary">Documentos Analisados</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-text-primary">{analysisResults.totalQuestions}</div>
                    <div className="text-sm text-text-secondary">Perguntas Testadas</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-status-success">{analysisResults.successfulQuestions}</div>
                    <div className="text-sm text-text-secondary">Com Resposta</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-status-error">{analysisResults.failedQuestions}</div>
                    <div className="text-sm text-text-secondary">Sem Resposta</div>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-border-default">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-secondary">Taxa de sucesso:</span>
                    <span className="text-lg font-semibold text-text-primary">
                      {Math.round((analysisResults.successfulQuestions / analysisResults.totalQuestions) * 100)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Resultados Detalhados */}
              <div>
                <h3 className="text-lg font-semibold text-text-primary mb-4">Resultados Detalhados</h3>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {analysisResults.results.map((result, index) => (
                    <div
                      key={index}
                      className={`rounded-lg p-4 border ${
                        result.success
                          ? 'bg-status-success/10 border-status-success/30'
                          : 'bg-status-error/10 border-status-error/30'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <h4 className="text-text-primary font-semibold mb-1">{result.documentTitle}</h4>
                          <p className="text-text-secondary text-sm mb-2">
                            <strong>Pergunta:</strong> {result.question}
                          </p>
                        </div>
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            result.success
                              ? 'bg-status-success/20 text-status-success'
                              : 'bg-status-error/20 text-status-error'
                          }`}
                        >
                          {result.success ? '✓ Sucesso' : '✗ Falhou'}
                        </span>
                      </div>
                      
                      {result.success && (
                        <div className="mt-2 space-y-1 text-sm">
                          <div className="flex justify-between">
                            <span className="text-text-secondary">Documentos encontrados:</span>
                            <span className="text-text-primary font-semibold">{result.sourcesCount}</span>
                          </div>
                          {result.foundCurrentDocument !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-text-secondary">Documento atual encontrado:</span>
                              <span className={`font-semibold ${result.foundCurrentDocument ? 'text-status-success' : 'text-status-warning'}`}>
                                {result.foundCurrentDocument ? '✓ Sim' : '✗ Não'}
                              </span>
                            </div>
                          )}
                          {result.confidence > 0 && (
                            <div className="flex justify-between">
                              <span className="text-text-secondary">Confiança:</span>
                              <span className="text-text-primary font-semibold">
                                {Math.round(result.confidence * 100)}%
                              </span>
                            </div>
                          )}
                          {result.metadata && (
                            <div className="flex justify-between text-xs text-text-tertiary">
                              <span>Chunks pesquisados:</span>
                              <span>{result.metadata.chunksSearched || 'N/A'}</span>
                            </div>
                          )}
                          {result.response && (
                            <div className="mt-2 pt-2 border-t border-border-default">
                              <p className="text-text-secondary text-xs mb-1">Resposta:</p>
                              <p className="text-text-primary text-xs">{result.response}...</p>
                            </div>
                          )}
                        </div>
                      )}

                      {!result.success && (
                        <div className="mt-2 pt-2 border-t border-border-default space-y-1 text-xs">
                          {result.error && (
                            <p className="text-status-error">
                              <strong>Erro:</strong> {result.error}
                            </p>
                          )}
                          {result.metadata && (
                            <div className="text-text-tertiary">
                              <p>Chunks pesquisados: {result.metadata.chunksSearched || 'N/A'}</p>
                              <p>Chunks encontrados: {result.metadata.chunksFound || 0}</p>
                            </div>
                          )}
                          {!result.error && (
                            <p className="text-status-warning">
                              Nenhum documento relevante encontrado. Verifique se o documento está indexado e se o conteúdo é relevante para a pergunta.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Estatísticas por Documento */}
              <div>
                <h3 className="text-lg font-semibold text-text-primary mb-4">Estatísticas por Documento</h3>
                <div className="space-y-2">
                  {Array.from(
                    new Map(
                      analysisResults.results.map(r => [r.documentId, r.documentTitle])
                    ).entries()
                  ).map(([docId, docTitle]) => {
                    const docResults = analysisResults.results.filter(r => r.documentId === docId);
                    const successCount = docResults.filter(r => r.success).length;
                    return (
                      <div key={docId} className="bg-bg-secondary rounded-lg p-3">
                        <div className="flex justify-between items-center">
                          <span className="text-text-primary font-medium">{docTitle}</span>
                          <span className="text-text-secondary text-sm">
                            {successCount} / {docResults.length} perguntas com resposta
                          </span>
                        </div>
                        <div className="mt-2 w-full bg-bg-tertiary rounded-full h-2">
                          <div
                            className="bg-accent-primary h-2 rounded-full transition-all"
                            style={{
                              width: `${(successCount / docResults.length) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {!analyzing && !analysisResults && (
            <div className="text-center py-8">
              <p className="text-text-secondary">Clique em "Analisar Documentos" para começar</p>
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
