import React, { useState, useEffect, useRef } from 'react';
import { listDocuments, getDocument, getDocumentsStats, getRagHealth, cleanOrphanedVectorDocuments, deleteDocument, reindexDocument, reindexAllNotIndexed, reindexAllTenant, queryRag, getRagDomains, getLearningMetrics, updateSynonymsFromDocuments, triggerLearning, getFullLearningData, updateSynonym, deleteSynonym, cleanInvalidQueries } from '../api/ragDocuments';
import { normalizeApiError, toastForApiErrorCode } from '../utils/apiErrorHandler';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import { Button } from '../styles/Button';
import { buildApiUrl } from '../api/client';
import { getAuthHeaders } from '../api/auth';
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

  // Sources conhecidas do sistema (fallback caso não haja documentos ainda)
  const KNOWN_SOURCES = [
    'web_scraping',
    'knowledge_base',
    'product_docs',
    'tickets',
    'upload',
    'manual',
  ];

  const [documents, setDocuments] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [domainsConfig, setDomainsConfig] = useState(null);
  const [allSources, setAllSources] = useState(KNOWN_SOURCES); // Inicializa com sources conhecidas
  const [filters, setFilters] = useState({
    source: '',
    status: '',
    search: '',
    domain: '',
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
  const [showLearningModal, setShowLearningModal] = useState(false);
  const deletingIdsRef = useRef(new Set());
  const [deletingById, setDeletingById] = useState({});
  const [learningData, setLearningData] = useState(null);
  const [loadingLearning, setLoadingLearning] = useState(false);
  const [editingSynonym, setEditingSynonym] = useState(null);
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [questionGenerationRules, setQuestionGenerationRules] = useState(null);
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

  const getExtractedText = (doc) => {
    if (!doc) return '';
    const meta = doc.metadata || {};
    const candidate =
      meta.extractedContent ??
      meta.extractedText ??
      meta.extracted_text ??
      meta.textoExtraido ??
      meta.texto_extraido;
    if (typeof candidate !== 'string') return '';
    const trimmed = candidate.trim();
    return trimmed ? trimmed : '';
  };

  const getDetailsText = (doc) => {
    const extracted = getExtractedText(doc);
    if (extracted) return extracted;
    if (!doc || typeof doc.content !== 'string') return '';
    const trimmed = doc.content.trim();
    return trimmed ? trimmed : '';
  };

  const downloadTextAsFile = (filename, text) => {
    try {
      const safeName = (filename || 'documento.txt')
        .toString()
        .trim()
        .replace(/[\\/:*?"<>|]+/g, '_');
      const blob = new Blob([text || ''], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = safeName.endsWith('.txt') ? safeName : `${safeName}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast('Não foi possível fazer download do texto', 'error');
    }
  };

  const downloadFromUrlBestEffort = async (url, filenameHint = null, options = {}) => {
    const rawUrl = String(url || '').trim();
    if (!rawUrl) return;
    const finalUrl = rawUrl.startsWith('/') ? buildApiUrl(rawUrl) : rawUrl;

    // Para caminhos internos (ex.: /rag/documents/:id/download) precisamos usar fetch com Authorization.
    // Só usa window.open() quando for um esquema/caminho não-http(s) e não for path relativo "/...".
    const isHttp = finalUrl.startsWith('http://') || finalUrl.startsWith('https://');
    const isInternalPath = rawUrl.startsWith('/');
    if (!isHttp && !isInternalPath) {
      window.open(finalUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      const res = await fetch(finalUrl, {
        method: 'GET',
        headers: options.headers || undefined,
      });
      if (!res.ok) {
        if (res.status === 404) {
          showToast('Arquivo original não encontrado (404).', 'warning', 6000);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filenameHint || 'documento';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      // CORS costuma bloquear fetch de sites externos; fallback orienta usuário
      showToast('Não foi possível baixar automaticamente (CORS). Abra o link e faça o download pelo navegador.', 'warning', 9000);
    }
  };

  useEffect(() => {
    loadData();
  }, [filters]);

  useEffect(() => {
    loadDomainsConfig();
  }, [agent?.tenantId]);

  // Carrega regras de geração de perguntas do config.json
  useEffect(() => {
    const loadQuestionGenerationRules = async () => {
      try {
        const configResponse = await fetch('/config');
        if (configResponse.ok) {
          const config = await configResponse.json();
          const rulesEnabled = config?.rag?.service?.adaptiveLearning?.questionGenerationRules?.enabled !== false;
          
          if (rulesEnabled) {
            // Tenta carregar o arquivo de regras do contrato
            try {
              // Tenta primeiro do contrato
              let rulesResponse = await fetch('/contracts/rag/question-generation.rules.json');
              // Fallback para o endpoint antigo
              if (!rulesResponse.ok) {
                rulesResponse = await fetch('/api/data/rag_question_generation_rules.json');
              }
              
              if (rulesResponse.ok) {
                const rules = await rulesResponse.json();
                setQuestionGenerationRules(rules);
                logger.debug('✅ [PERGUNTAS] Regras de geração carregadas do contrato', { rules });
              } else {
                logger.warn('⚠️ [PERGUNTAS] Arquivo de regras não encontrado, usando padrão');
              }
            } catch (e) {
              logger.warn('⚠️ [PERGUNTAS] Erro ao carregar regras, usando padrão', { error: e.message });
            }
          }
        }
      } catch (e) {
        logger.debug('Não foi possível carregar regras de geração, usando padrão', { error: e.message });
      }
    };
    
    loadQuestionGenerationRules();
  }, []);

  const loadLearningData = async () => {
    if (!agent?.tenantId) {
      logger.debug('⚠️ [APRENDIZADO] Tenant ID não disponível para carregar dados');
      return;
    }
    
    logger.debug('📊 [APRENDIZADO] Carregando dados de aprendizado', {
      tenantId: agent.tenantId,
      modalAberto: showLearningModal
    });
    
    setLoadingLearning(true);
    try {
      const fullData = await getFullLearningData(agent.tenantId);
      
      logger.debug('✅ [APRENDIZADO] Dados de aprendizado carregados', {
        tenantId: agent.tenantId,
        hasMetrics: !!fullData.metrics,
        hasSynonyms: !!fullData.synonyms && Object.keys(fullData.synonyms).length > 0,
        hasQueryPatterns: !!fullData.queryPatterns,
        hasConfig: !!fullData.config,
        hasLearningCycles: !!fullData.learningCycles,
        metrics: fullData.metrics,
        synonymsCount: fullData.synonyms ? Object.keys(fullData.synonyms).length : 0,
        queryPatternsCount: fullData.queryPatterns ? {
          successful: fullData.queryPatterns.successful?.length || 0,
          failed: fullData.queryPatterns.failed?.length || 0
        } : null
      });
      
      setLearningData(fullData);
    } catch (error) {
      logger.error('❌ [APRENDIZADO] Erro ao carregar dados de aprendizado:', error);
      showToast('Erro ao carregar dados de aprendizado', 'error');
      // Fallback para métricas básicas
      try {
        logger.debug('🔄 [APRENDIZADO] Tentando carregar apenas métricas básicas');
        const metrics = await getLearningMetrics(agent.tenantId);
        setLearningData({ metrics, synonyms: {}, queryPatterns: {}, config: {}, learningCycles: {} });
        logger.debug('✅ [APRENDIZADO] Métricas básicas carregadas', { metrics });
      } catch (e) {
        logger.error('❌ [APRENDIZADO] Erro ao carregar métricas básicas:', e);
        setLearningData(null);
      }
    } finally {
      setLoadingLearning(false);
    }
  };

  useEffect(() => {
    if (showLearningModal && agent?.tenantId) {
      loadLearningData();
    }
  }, [showLearningModal, agent?.tenantId]);

  // Carrega todas as sources disponíveis uma vez ao montar o componente
  useEffect(() => {
    const loadAllSources = async () => {
      try {
        const tenantId = agent?.tenantId || null;
        // Carrega documentos sem filtros para obter todas as sources disponíveis
        const allDocs = await listDocuments(tenantId ? { tenantId } : {});
        const sourcesArray = Array.isArray(allDocs) ? allDocs : [];
        const uniqueSources = [...new Set(sourcesArray.map(doc => doc.metadata?.source).filter(Boolean))];
        
        // Combina sources encontradas com sources conhecidas e remove duplicatas
        const allUniqueSources = [...new Set([...KNOWN_SOURCES, ...uniqueSources])];
        setAllSources(allUniqueSources.sort());
      } catch (error) {
        logger.error('Erro ao carregar sources:', error);
        // Em caso de erro, usa sources conhecidas como fallback
        setAllSources(KNOWN_SOURCES);
      }
    };
    
    loadAllSources();
  }, [agent?.tenantId]);

  const loadDomainsConfig = async () => {
    try {
      const tenantId = agent?.tenantId || null;
      const config = await getRagDomains(tenantId);
      setDomainsConfig(config);
    } catch (error) {
      logger.error('Erro ao carregar configuração de domínios:', error);
      // Não mostra erro para o usuário, apenas loga
    }
  };

  const loadData = async () => {
    logger.info('[RAGDocumentsPage] Iniciando carregamento de documentos');
    setLoading(true);
    try {
      const tenantId = agent?.tenantId || null;
      
      // Prepara filtros para API (inclui tenantId)
      const apiFilters = {
        ...filters,
        ...(tenantId && { tenantId }),
      };
      
      const [docs, statsData, healthData] = await Promise.all([
        listDocuments(apiFilters),
        getDocumentsStats(tenantId),
        getRagHealth(tenantId).catch((e) => ({ __error: e })),
      ]);
      // Garante que docs seja sempre um array
      const documentsArray = Array.isArray(docs) ? docs : [];
      
      // Log resumo dos documentos carregados
      logger.info('[RAGDocumentsPage] Documentos carregados', {
        totalDocuments: documentsArray.length,
        tenantId,
        filters: apiFilters,
      });
      
      // Log detalhado das estatísticas recebidas
      logger.info('[RAGDocumentsPage] Estatísticas recebidas', {
        tenantId,
        stats: statsData,
        total: statsData?.total,
        indexed: statsData?.indexed,
        notIndexed: statsData?.notIndexed,
        syncStatus: statsData?.syncStatus,
        syncDifference: statsData?.syncDifference,
        hasVectorStoreStats: !!statsData?.vectorStoreStats,
        vectorStoreIndexed: statsData?.vectorStoreStats?.indexedDocuments,
        shouldShowButton: statsData && (
          statsData.notIndexed > 0 || 
          (statsData.syncStatus === 'db_ahead' && statsData.syncDifference > 0)
        )
      });
      
      setDocuments(documentsArray);
      setStats(statsData);

      // Health (Postgres = fonte única): warnings vêm em array
      if (healthData && healthData.ok && Array.isArray(healthData.warnings) && healthData.warnings.length > 0) {
        const first = healthData.warnings[0];
        const warningMessage = first?.message || '⚠️ Inconsistência detectada no RAG.';
        showToast(warningMessage, 'warning', 9000);
      } else if (healthData && healthData.ok === false && healthData.error) {
        showToast(healthData.error.message || 'Erro ao verificar health do RAG', 'error', 7000);
      } else if (healthData && healthData.__error) {
        // Não bloqueia a tela; apenas informa em dev/observabilidade
        logger.warn('[RAGDocumentsPage] Falha ao consultar /rag/health (ignorado)', { error: healthData.__error?.message });
      }
    } catch (error) {
      logger.error('Erro ao carregar dados:', error);
      showToast('Erro ao carregar dados', 'error');
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (doc, closeModal = false) => {
    const docId = doc?.id ? String(doc.id) : '';
    if (!docId) return;

    // Evita duplicidade (ex.: clique duplo / modal + lista)
    if (deletingIdsRef.current.has(docId)) return;

    const confirmed = await confirm({
      title: 'Confirmar exclusão',
      message: `Tem certeza que deseja excluir o documento "${doc.title}"?`,
    });

    if (!confirmed) return;

    // Revalida lock após o confirm (pode ter sido excluído em paralelo)
    if (deletingIdsRef.current.has(docId)) return;
    deletingIdsRef.current.add(docId);
    setDeletingById((prev) => ({ ...prev, [docId]: true }));

    try {
      setLoading(true);
      await deleteDocument(docId);
      showToast('Documento excluído com sucesso!', 'success');
      if (closeModal) {
        setShowDetailsModal(false);
        setTimeout(() => {
          setSelectedDocument(null);
        }, 300);
      }
      loadData();
    } catch (error) {
      // Delete é idempotente: se a API indicar "não encontrado", trata como já-excluído.
      const msg = error?.body?.message || error?.message || '';
      if (error?.status === 404 || (error?.status === 400 && String(msg).toLowerCase().includes('não encontrado'))) {
        logger.warn('[RAGDocumentsPage] Delete idempotente: documento já não existe', { documentId: docId, status: error?.status });
        showToast('Documento já havia sido excluído.', 'warning', 7000);
        if (closeModal) {
          setShowDetailsModal(false);
          setTimeout(() => {
            setSelectedDocument(null);
          }, 300);
        }
        loadData();
      } else {
        logger.error('Erro ao excluir documento:', error);
        showToast('Erro ao excluir documento', 'error');
      }
    } finally {
      deletingIdsRef.current.delete(docId);
      setDeletingById((prev) => {
        const next = { ...prev };
        delete next[docId];
        return next;
      });
      setLoading(false);
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
      const info = normalizeApiError(error);
      const toast = toastForApiErrorCode(info.code);
      logger.error('Erro ao reindexar:', { error: info });
      showToast(toast.message || info.message || 'Erro ao reindexar documento', toast.type || 'error', toast.durationMs || 10000);
    } finally {
      setLoading(false);
    }
  };

  const handleCleanOrphans = async () => {
    const confirmed = await confirm({
      title: 'Limpar dados órfãos do Vector Store',
      message: 'Isso remove do vector store (Postgres/pgvector) documentos/chunks que não existem mais no banco de dados deste tenant. Continuar?',
    });
    if (!confirmed) return;

    try {
      setLoading(true);
      const tenantId = agent?.tenantId || null;
      const result = await cleanOrphanedVectorDocuments(tenantId);
      if (result.success) {
        showToast(`Órfãos removidos do vector store: ${result.removedDocuments} documentos, ${result.removedChunks} chunks.`, 'success', 9000);
      } else {
        showToast(result.error || 'Falha ao limpar órfãos do vector store', 'error', 10000);
      }
      await loadData();
    } catch (error) {
      const info = normalizeApiError(error);
      const toast = toastForApiErrorCode(info.code);
      showToast(toast.message || info.message || 'Erro ao limpar órfãos do vector store', toast.type || 'error', toast.durationMs || 10000);
    } finally {
      setLoading(false);
    }
  };

  const handleShowDetails = async (doc) => {
    // Abre rápido com o dado atual e tenta enriquecer com o detalhe completo (best-effort)
    setSelectedDocument(doc);
    setShowDetailsModal(true);
    try {
      const full = await getDocument(doc?.id);
      if (full) setSelectedDocument(full);
    } catch (error) {
      logger.warn('[RAGDocumentsPage] Falha ao buscar detalhes completos do documento', { error: error?.message, documentId: doc?.id });
    }
  };

  const analyzeDocuments = async (maxDocuments = null) => {
    logger.debug('🚀 [ANÁLISE] FUNÇÃO analyzeDocuments CHAMADA', {
      timestamp: new Date().toISOString(),
      maxDocuments,
      tenantId: agent?.tenantId,
    });
    
    logger.debug('🔍 [ANÁLISE] Iniciando análise de documentos', {
      timestamp: new Date().toISOString(),
      tenantId: agent?.tenantId,
      maxDocuments
    });
    
    logger.debug('📊 [ANÁLISE] Estados antes de iniciar', {
      analyzing,
      hasResults: !!analysisResults,
      documentsCount: documents?.length || 0
    });
    
    setAnalyzing(true);
    setAnalysisResults(null);
    
    logger.debug('✅ [ANÁLISE] Estados atualizados (analyzing=true, results=null)');

    try {
      const documentsArray = Array.isArray(documents) ? documents : [];
      const tenantId = agent?.tenantId || null;

      logger.debug('📋 [ANÁLISE] Documentos disponíveis', {
        totalDocuments: documentsArray.length,
        tenantId
      });

      // Filtra apenas documentos indexados e ativos
      const indexedDocs = documentsArray.filter(
        doc => doc.indexed && doc.status === 'active' && doc.content
      );

      logger.debug('✅ [ANÁLISE] Documentos filtrados', {
        totalIndexed: indexedDocs.length,
        indexedIds: indexedDocs.map(d => ({ id: d.id, title: d.title }))
      });

      if (indexedDocs.length === 0) {
        logger.warn('⚠️ [ANÁLISE] Nenhum documento indexado encontrado');
        showToast('Não há documentos indexados para analisar', 'warning');
        setAnalyzing(false);
        return;
      }

      // Calcula limite de documentos baseado em estimativa de tempo
      // Cada documento: ~3 perguntas × 2 tentativas RAG × ~2s = ~12s por documento
      // Limite padrão: 10 documentos (~2 minutos)
      // Se houver muitos documentos, permite mais mas com aviso
      const MAX_DOCS_DEFAULT = 10;
      const MAX_DOCS_WITH_WARNING = 50; // Máximo absoluto com aviso
      const estimatedTimePerDoc = 12; // segundos
      
      // Se maxDocuments foi passado, usa esse valor (permitindo "todos")
      // Se não foi passado, usa o padrão
      let maxDocs = (maxDocuments !== null && maxDocuments !== undefined)
        ? (maxDocuments === 'all' ? indexedDocs.length : Math.min(maxDocuments, indexedDocs.length))
        : MAX_DOCS_DEFAULT;
      
      // Aplica limite máximo de segurança
      if (maxDocs > MAX_DOCS_WITH_WARNING) {
        logger.warn('⚠️ [ANÁLISE] Limite máximo de segurança aplicado', {
          requested: maxDocs,
          maxAllowed: MAX_DOCS_WITH_WARNING,
          totalIndexed: indexedDocs.length
        });
        maxDocs = MAX_DOCS_WITH_WARNING;
      }
      
      const docsToAnalyze = indexedDocs.slice(0, maxDocs);
      const estimatedTime = Math.ceil((maxDocs * estimatedTimePerDoc) / 60);
      
      if (indexedDocs.length > maxDocs) {
        logger.debug('ℹ️ [ANÁLISE] Limite de documentos aplicado', {
          totalIndexed: indexedDocs.length,
          analyzing: maxDocs,
          skipped: indexedDocs.length - maxDocs,
          estimatedTimeMinutes: estimatedTime
        });
        
        // Mostra aviso ao usuário se muitos documentos foram pulados
        if (indexedDocs.length - maxDocs > 5) {
          showToast(
            `Analisando ${maxDocs} de ${indexedDocs.length} documentos (estimativa: ~${estimatedTime} min). Use "Analisar Todos" para processar todos.`,
            'info',
            5000
          );
        }
      } else {
        logger.debug('⏱️ [ANÁLISE] Tempo estimado', {
          documents: maxDocs,
          estimatedTimeMinutes: estimatedTime
        });
      }
      
      logger.debug('📊 [ANÁLISE] Documentos selecionados para análise', {
        totalToAnalyze: docsToAnalyze.length,
        selectedDocs: docsToAnalyze.map(d => ({ id: d.id, title: d.title, contentLength: d.content?.length || 0 }))
      });
      
      // Calcula total de perguntas estimado (usa validação básica para estimativa)
      logger.debug('📝 [ANÁLISE] Calculando estimativa de perguntas');
      let totalQuestionsEstimate = 0;
      for (const doc of docsToAnalyze) {
        const title = doc.title || '';
        const content = doc.content || '';
        const contentPreview = content.substring(0, 500);
        const rawQuestions = generateQuestionsFromContent(title, contentPreview);
        // Estima baseado em validação básica (a validação com IA será feita depois)
        const validQuestions = rawQuestions.filter(q => isValidQuestionBasic(q));
        const docEstimate = Math.min(validQuestions.length, 3);
        totalQuestionsEstimate += docEstimate;
        
        logger.debug('📝 [ANÁLISE] Estimativa por documento', {
          documentId: doc.id,
          title,
          rawQuestions: rawQuestions.length,
          validQuestions: validQuestions.length,
          estimate: docEstimate
        });
      }
      
      logger.debug('📊 [ANÁLISE] Estimativa total de perguntas', {
        totalEstimate: totalQuestionsEstimate
      });

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
      // Set para rastrear combinações únicas de documento + pergunta (evita duplicatas)
      const seenResults = new Set();
      // Array para rastrear documentos que não geraram perguntas
      const documentsWithoutQuestions = [];

      logger.debug('🔄 [ANÁLISE] Iniciando loop de análise de documentos', {
        totalDocuments: docsToAnalyze.length,
        documentIds: docsToAnalyze.map(d => d.id)
      });

      // Analisa cada documento e gera perguntas de teste
      for (let docIndex = 0; docIndex < docsToAnalyze.length; docIndex++) {
        const doc = docsToAnalyze[docIndex];
        
        logger.debug('📄 [ANÁLISE] Processando documento', {
          index: docIndex + 1,
          total: docsToAnalyze.length,
          documentId: doc.id,
          hasTitle: !!doc.title,
          hasContent: !!doc.content,
          contentLength: doc.content?.length || 0
        });
        
        // Extrai palavras-chave do título e conteúdo
        // Se não tem título, usa preview do conteúdo ou ID como fallback
        let title = doc.title || '';
        if (!title && doc.content) {
          title = doc.content.substring(0, 100).replace(/\n/g, ' ').trim() || doc.id.substring(0, 20);
        } else if (!title) {
          title = doc.id.substring(0, 20);
        }
        
        const content = doc.content || '';
        const contentPreview = content.substring(0, 500);
        
        logger.debug('📄 [ANÁLISE] Documento processado', {
          documentId: doc.id,
          title,
          titleLength: title.length,
          contentLength: content.length,
          contentPreviewLength: contentPreview.length
        });

        // Verifica se o documento tem conteúdo suficiente
        let skipReason = null;
        if (!content || content.trim().length === 0) {
          skipReason = 'Sem conteúdo';
        } else if (content.trim().length < 50) {
          skipReason = 'Conteúdo muito curto (menos de 50 caracteres)';
        }

        // Gera perguntas baseadas no conteúdo
        logger.debug('📝 [ANÁLISE] Gerando perguntas para documento', {
          documentIndex: docIndex + 1,
          documentId: doc.id,
          title,
          contentPreviewLength: contentPreview.length
        });
        
        const rawQuestions = generateQuestionsFromContent(title, contentPreview);
        
        logger.debug('📝 [ANÁLISE] Perguntas geradas (antes da validação)', {
          documentId: doc.id,
          rawQuestionsCount: rawQuestions.length,
          rawQuestions: rawQuestions
        });
        
        // Se não há perguntas geradas, registra o motivo
        if (rawQuestions.length === 0) {
          skipReason = skipReason || 'Nenhuma pergunta gerada pelo algoritmo';
        }
        
        // Valida perguntas usando IA
        logger.debug('🤖 [ANÁLISE] Validando perguntas com IA', {
          documentId: doc.id,
          questionsToValidate: rawQuestions.length
        });
        
        const questionsToTest = (await validateQuestionsWithAI(rawQuestions, title, contentPreview)).slice(0, 3);
        
        logger.debug('✅ [ANÁLISE] Perguntas validadas pela IA', {
          documentId: doc.id,
          validatedCount: questionsToTest.length,
          validatedQuestions: questionsToTest
        });
        
        // Se não há perguntas válidas, registra o documento e o motivo
        if (questionsToTest.length === 0) {
          const reason = skipReason || (rawQuestions.length === 0 
            ? 'Nenhuma pergunta gerada' 
            : `Perguntas geradas (${rawQuestions.length}) mas nenhuma validada pela IA`);
          
          logger.info('⚠️ [ANÁLISE] Documento não analisado - sem perguntas válidas', { 
            documentId: doc.id, 
            title: title || doc.id,
            reason,
            rawQuestionsCount: rawQuestions.length,
            contentLength: content.length,
            hasContent: !!content && content.trim().length > 0
          });
          
          documentsWithoutQuestions.push({
            documentId: doc.id,
            title: title || doc.id,
            reason,
            rawQuestionsCount: rawQuestions.length,
            contentLength: content.length,
            hasContent: !!content && content.trim().length > 0
          });
          
          setAnalysisProgress(prev => ({
            ...prev,
            documentsAnalyzed: prev.documentsAnalyzed + 1,
          }));
          continue;
        }

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
            logger.debug('🔍 [ANÁLISE] Testando pergunta no RAG', {
              documentId: doc.id,
              questionIndex: qIndex + 1,
              question,
              firstAttempt: { topK: 6, minScore: 0.3 }
            });
            
            // Tenta com minScore mais baixo primeiro (0.3)
            let result = await queryRag(question, tenantId, { topK: 6, minScore: 0.3, maxTokens: 1000 });
            
            logger.debug('🔍 [ANÁLISE] Resultado primeira tentativa (minScore 0.3)', {
              documentId: doc.id,
              question,
              success: result.success,
              sourcesCount: result.sources?.length || 0,
              confidence: result.confidence,
              foundCurrentDoc: result.sources?.some(s => s.documentId === doc.id) || false
            });
            
            // Se não encontrou com 0.3, tenta com 0.45 (padrão otimizado)
            if (!result.success || !result.sources || result.sources.length === 0) {
              logger.debug('🔍 [ANÁLISE] Tentando segunda vez com minScore 0.45', {
                documentId: doc.id,
                question
              });
              
              result = await queryRag(question, tenantId, { topK: 6, minScore: 0.45, maxTokens: 1000 });
              
              logger.debug('🔍 [ANÁLISE] Resultado segunda tentativa (minScore 0.45)', {
                documentId: doc.id,
                question,
                success: result.success,
                sourcesCount: result.sources?.length || 0,
                confidence: result.confidence,
                foundCurrentDoc: result.sources?.some(s => s.documentId === doc.id) || false
              });
            }
            
            // Verifica se encontrou o documento atual nos resultados
            const foundCurrentDoc = result.sources?.some(s => s.documentId === doc.id) || false;
            
            const isSuccess = result.success && result.sources && result.sources.length > 0;
            
            // Cria chave única para evitar duplicatas (documentId + question normalizada)
            const resultKey = `${doc.id}:${question.trim().toLowerCase()}`;
            
            logger.debug('✅ [ANÁLISE] Resultado final da pergunta', {
              documentId: doc.id,
              question,
              resultKey,
              isSuccess,
              foundCurrentDoc,
              sourcesCount: result.sources?.length || 0,
              confidence: result.confidence,
              hasResponse: !!result.response,
              isDuplicate: seenResults.has(resultKey)
            });
            
            // Verifica se já existe resultado idêntico
            if (seenResults.has(resultKey)) {
              logger.warn('⚠️ [ANÁLISE] Resultado duplicado detectado e ignorado', {
                documentId: doc.id,
                question,
                resultKey
              });
              // Atualiza estatísticas mas não adiciona resultado duplicado
              setAnalysisProgress(prev => ({
                ...prev,
                questionsTested: prev.questionsTested + 1,
                successfulQuestions: isSuccess ? prev.successfulQuestions + 1 : prev.successfulQuestions,
                failedQuestions: !isSuccess ? prev.failedQuestions + 1 : prev.failedQuestions,
              }));
              continue;
            }
            
            // Marca como visto
            seenResults.add(resultKey);
            
            const resultEntry = {
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
              timestamp: new Date().toISOString(),
              resultKey // Inclui chave única para referência
            };
            
            logger.debug('➕ [ANÁLISE] Adicionando resultado único', {
              documentId: doc.id,
              question,
              resultKey,
              totalResults: results.length + 1
            });
            
            results.push(resultEntry);

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
            // Se for erro de conexão, para a análise
            if (error.message?.includes('CONNECTION_REFUSED') || 
                error.message?.includes('Failed to fetch') ||
                error.message?.includes('network') ||
                error.status === 0 ||
                error.connectionRefused) {
              logger.warn('Serviço RAG indisponível durante análise', {
                question,
                documentId: doc.id,
                error: error.message
              });
              showToast('Serviço RAG ficou indisponível durante a análise. Análise interrompida.', 'error');
              setAnalyzing(false);
              return;
            }

            // Cria chave única para evitar duplicatas
            const resultKey = `${doc.id}:${question.trim().toLowerCase()}`;
            
            logger.debug('❌ [ANÁLISE] Erro ao processar pergunta', {
              documentId: doc.id,
              question,
              resultKey,
              error: error.message,
              isDuplicate: seenResults.has(resultKey)
            });
            
            // Verifica se já existe resultado idêntico
            if (seenResults.has(resultKey)) {
              logger.warn('⚠️ [ANÁLISE] Resultado duplicado (erro) detectado e ignorado', {
                documentId: doc.id,
                question,
                resultKey
              });
              setAnalysisProgress(prev => ({
                ...prev,
                questionsTested: prev.questionsTested + 1,
                failedQuestions: prev.failedQuestions + 1,
              }));
              continue;
            }
            
            // Marca como visto
            seenResults.add(resultKey);
            
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
              timestamp: new Date().toISOString(),
              resultKey
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

      // Remove duplicatas finais (caso alguma tenha passado)
      const uniqueResults = [];
      const finalSeen = new Set();
      for (const result of results) {
        const key = result.resultKey || `${result.documentId}:${result.question.trim().toLowerCase()}`;
        if (!finalSeen.has(key)) {
          finalSeen.add(key);
          uniqueResults.push(result);
        } else {
          logger.warn('⚠️ [ANÁLISE] Duplicata final removida', {
            documentId: result.documentId,
            question: result.question,
            key
          });
        }
      }
      
      const analysisSummary = {
        totalDocuments: documentsArray.length, // Total geral de documentos
        totalIndexedDocuments: indexedDocs.length, // Documentos indexados e ativos disponíveis
        documentsSelected: docsToAnalyze.length, // Documentos selecionados para análise
        documentsAnalyzed: new Set(uniqueResults.map(r => r.documentId)).size, // Documentos realmente analisados
        documentsWithoutQuestions: documentsWithoutQuestions, // Documentos que não geraram perguntas
        totalQuestions: uniqueResults.length,
        successfulQuestions: uniqueResults.filter(r => r.success).length,
        failedQuestions: uniqueResults.filter(r => !r.success).length,
        results: uniqueResults,
        duplicatesRemoved: results.length - uniqueResults.length
      };
      
      logger.info('📊 [ANÁLISE] Resumo final da análise', {
        totalDocuments: analysisSummary.totalDocuments,
        documentsSelected: analysisSummary.documentsSelected,
        documentsAnalyzed: analysisSummary.documentsAnalyzed,
        documentsWithoutQuestions: analysisSummary.documentsWithoutQuestions.length,
        totalQuestions: analysisSummary.totalQuestions,
        successfulQuestions: analysisSummary.successfulQuestions,
        failedQuestions: analysisSummary.failedQuestions,
        duplicatesRemoved: analysisSummary.duplicatesRemoved,
        successRate: analysisSummary.totalQuestions > 0 
          ? (analysisSummary.successfulQuestions / analysisSummary.totalQuestions * 100).toFixed(2) + '%'
          : '0%',
        resultsByDocument: Object.entries(
          uniqueResults.reduce((acc, r) => {
            acc[r.documentId] = (acc[r.documentId] || 0) + 1;
            return acc;
          }, {})
        ).map(([id, count]) => ({ documentId: id, questionsCount: count })),
        documentsWithoutQuestionsDetails: analysisSummary.documentsWithoutQuestions.map(d => ({
          id: d.documentId,
          title: d.title,
          reason: d.reason
        }))
      });
      
      setAnalysisResults(analysisSummary);

      // Dispara aprendizado adaptativo após análise
      logger.debug('🧠 [APRENDIZADO] Iniciando atualização do aprendizado adaptativo', {
        tenantId,
        documentsAnalyzed: docsToAnalyze.length,
        totalResults: results.length,
        successfulResults: results.filter(r => r.success).length
      });
      
      try {
        // Atualiza sinônimos baseado nos documentos analisados
        logger.debug('📚 [APRENDIZADO] Atualizando sinônimos dos documentos', {
          tenantId,
          documentsCount: indexedDocs.length
        });
        
        const { updateSynonymsFromDocuments, triggerLearning } = await import('../api/ragDocuments');
        const synonymsResult = await updateSynonymsFromDocuments(tenantId, indexedDocs);
        
        logger.debug('✅ [APRENDIZADO] Sinônimos atualizados', {
          tenantId,
          result: synonymsResult
        });
        
        // Dispara aprendizado completo para otimizar configurações
        logger.debug('🔄 [APRENDIZADO] Disparando aprendizado completo', {
          tenantId
        });
        
        const learningResult = await triggerLearning(tenantId);
        
        logger.debug('✅ [APRENDIZADO] Aprendizado completo concluído', {
          tenantId,
          result: learningResult
        });
        
        // Sempre recarrega dados de aprendizado após atualização
        // Isso garante que o modal mostre dados atualizados quando for aberto
        logger.debug('📊 [APRENDIZADO] Recarregando dados de aprendizado', {
          tenantId,
          modalAberto: showLearningModal
        });
        
        await loadLearningData();
        
        logger.debug('✅ [APRENDIZADO] Dados de aprendizado recarregados', {
          tenantId,
          hasLearningData: !!learningData
        });
        
        showToast('Aprendizado adaptativo atualizado com base na análise!', 'success');
      } catch (error) {
        // Se for erro de conexão, mostra mensagem clara
        if (error.message?.includes('CONNECTION_REFUSED') || 
            error.message?.includes('Failed to fetch') ||
            error.message?.includes('network') ||
            error.status === 0) {
          logger.warn('Serviço RAG indisponível para atualizar aprendizado adaptativo');
          showToast('Análise concluída, mas não foi possível atualizar aprendizado adaptativo (serviço indisponível)', 'warning');
        } else {
          logger.error('Erro ao atualizar aprendizado adaptativo:', error);
          // Não mostra erro para o usuário em outros casos, apenas loga
        }
      }

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

  /**
   * Valida perguntas usando IA para melhor qualidade.
   * 
   * @param {Array<string>} questions - Lista de perguntas a validar
   * @param {string} documentTitle - Título do documento para contexto
   * @param {string} documentContent - Conteúdo do documento para contexto
   * @returns {Promise<Array<string>>} Lista de perguntas válidas
   */
  const validateQuestionsWithAI = async (questions, documentTitle = '', documentContent = '') => {
    if (!questions || questions.length === 0) {
      return [];
    }

    // Validação básica primeiro (filtra óbvias)
    const basicValidated = questions.filter(q => isValidQuestionBasic(q));
    
    if (basicValidated.length === 0) {
      return [];
    }

    // Se há muitas perguntas, valida em batch
    if (basicValidated.length <= 1) {
      // Para poucas perguntas, valida individualmente
      const results = await Promise.all(
        basicValidated.map(q => validateSingleQuestionWithAI(q, documentTitle, documentContent))
      );
      return basicValidated.filter((_, i) => results[i]);
    }

    // Para múltiplas perguntas, valida em batch
    try {
      const tenantId = agent?.tenantId || null;
      if (!tenantId) {
        throw new Error('Tenant ID é obrigatório para validação com IA');
      }

      // Carrega prompt do config.json
      let promptTemplate = `Você é um especialista em análise de qualidade de perguntas para sistemas de busca e recuperação de informação.

Contexto do documento:
Título: {{documentTitle}}
Conteúdo (resumo): {{documentContent}}

Abaixo estão perguntas geradas automaticamente. Sua tarefa é identificar quais perguntas são VÁLIDAS e fazem sentido no contexto do documento.

Critérios para uma pergunta VÁLIDA:
1. Faz sentido semântico e está relacionada ao contexto do documento
2. É específica o suficiente para ser útil (não muito genérica)
3. Tem estrutura de pergunta clara
4. Não é apenas palavras soltas ou sem sentido
5. Pode ser respondida com base no conteúdo do documento

Perguntas a avaliar:
{{questionsList}}

Responda APENAS com um JSON array de números das perguntas VÁLIDAS (ex: [1, 3, 5]).
Se nenhuma for válida, retorne [].
Não inclua explicações, apenas o JSON array.`;

      // Tenta carregar prompt do config.json
      try {
        const configResponse = await fetch('/config');
        if (configResponse.ok) {
          const config = await configResponse.json();
          const ragConfig = config?.rag?.service?.adaptiveLearning?.prompts?.questionValidation?.batch;
          if (ragConfig) {
            promptTemplate = ragConfig;
          }
        }
      } catch (e) {
        logger.debug('Não foi possível carregar prompt do config.json, usando padrão', { error: e.message });
      }

      // Substitui placeholders no prompt
      const questionsList = basicValidated.map((q, i) => `${i + 1}. ${q}`).join('\n');
      const prompt = promptTemplate
        .replace(/\{\{documentTitle\}\}/g, documentTitle)
        .replace(/\{\{documentContent\}\}/g, documentContent.substring(0, 500))
        .replace(/\{\{questionsList\}\}/g, questionsList);

      const response = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          tenantId,
          executionId: `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          sessionId: 'rag-question-validation',
          flowId: 'rag-analysis',
          nodeId: 'question-validator',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Erro desconhecido');
        logger.error('Erro ao validar perguntas com IA', { 
          status: response.status,
          error: errorText
        });
        throw new Error(`Serviço de IA retornou erro ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      const aiResponse = result.text || result.response || '';

      // Tenta extrair array de números da resposta
      let validIndices = [];
      try {
        // Procura por JSON array na resposta
        const jsonMatch = aiResponse.match(/\[[\d,\s]+\]/);
        if (jsonMatch) {
          validIndices = JSON.parse(jsonMatch[0]).map(n => n - 1); // Converte para índice 0-based
        } else {
          // Tenta parsear a resposta inteira como JSON
          validIndices = JSON.parse(aiResponse);
          if (Array.isArray(validIndices)) {
            validIndices = validIndices.map(n => n - 1);
          }
        }
      } catch (e) {
        logger.error('Erro ao parsear resposta da IA', { error: e.message, response: aiResponse });
        throw new Error(`Erro ao processar resposta da IA: ${e.message}`);
      }

      // Filtra perguntas válidas baseado nos índices retornados pela IA
      const aiValidated = basicValidated.filter((_, index) => validIndices.includes(index));
      
      // Retorna apenas perguntas validadas pela IA
      return aiValidated;
    } catch (error) {
      logger.error('Erro ao validar perguntas com IA', { error: error.message });
      throw error; // Propaga o erro - sem fallback
    }
  };

  /**
   * Valida uma única pergunta usando IA.
   * 
   * @param {string} question - Pergunta a validar
   * @param {string} documentTitle - Título do documento
   * @param {string} documentContent - Conteúdo do documento
   * @returns {Promise<boolean>} true se válida
   */
  const validateSingleQuestionWithAI = async (question, documentTitle = '', documentContent = '') => {
    const tenantId = agent?.tenantId || null;
    if (!tenantId) {
      throw new Error('Tenant ID é obrigatório para validação com IA');
    }

      // Carrega prompt do config.json
      let promptTemplate = `Você é um especialista em análise de qualidade de perguntas.

Contexto do documento:
Título: {{documentTitle}}
Conteúdo (resumo): {{documentContent}}

Pergunta a avaliar: "{{question}}"

Esta pergunta é VÁLIDA para um sistema de busca baseado no contexto do documento?
Critérios:
- Faz sentido semântico e está relacionada ao contexto
- É específica o suficiente (não muito genérica)
- Tem estrutura de pergunta clara
- Pode ser respondida com base no conteúdo

Responda APENAS com "SIM" ou "NÃO" (sem aspas, sem explicações).`;

      // Tenta carregar prompt do config.json
      try {
        const configResponse = await fetch('/config');
        if (configResponse.ok) {
          const config = await configResponse.json();
          const ragConfig = config?.rag?.service?.adaptiveLearning?.prompts?.questionValidation?.single;
          if (ragConfig) {
            promptTemplate = ragConfig;
          }
        }
      } catch (e) {
        logger.debug('Não foi possível carregar prompt do config.json, usando padrão', { error: e.message });
      }

      // Substitui placeholders no prompt
      const prompt = promptTemplate
        .replace(/\{\{documentTitle\}\}/g, documentTitle)
        .replace(/\{\{documentContent\}\}/g, documentContent.substring(0, 500))
        .replace(/\{\{question\}\}/g, question);

      const response = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          tenantId,
          executionId: `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          sessionId: 'rag-question-validation',
          flowId: 'rag-analysis',
          nodeId: 'question-validator',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Erro desconhecido');
        logger.error('Erro ao validar pergunta com IA', { 
          status: response.status,
          error: errorText,
          question 
        });
        throw new Error(`Serviço de IA retornou erro ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      const aiResponse = (result.text || result.response || '').trim().toUpperCase();
      
      return aiResponse.includes('SIM') || aiResponse === 'YES' || aiResponse === 'TRUE';
  };

  /**
   * Validação básica de pergunta (usada apenas internamente para pré-filtro).
   * 
   * @param {string} question - Pergunta a validar
   * @returns {boolean} true se a pergunta passa na validação básica
   */
  const isValidQuestionBasic = (question) => {
    if (!question || typeof question !== 'string') {
      return false;
    }

    const q = question.trim();

    // Muito curta ou muito longa
    if (q.length < 10 || q.length > 200) {
      return false;
    }

    // Apenas espaços ou caracteres especiais
    if (!/[a-záàâãéêíóôõúç]/i.test(q)) {
      return false;
    }

    // É um UUID ou código
    const uuidPattern = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
    if (uuidPattern.test(q)) {
      return false;
    }

    // Apenas números ou caracteres especiais
    if (/^[^a-záàâãéêíóôõúç]+$/i.test(q)) {
      return false;
    }

    // Muitos caracteres especiais (mais de 30% do texto)
    const specialChars = (q.match(/[^a-záàâãéêíóôõúç0-9\s]/gi) || []).length;
    if (specialChars / q.length > 0.3) {
      return false;
    }

    // Menos de 3 palavras significativas
    const words = q.split(/\s+/).filter(w => w.length >= 3 && /[a-záàâãéêíóôõúç]/i.test(w));
    if (words.length < 3) {
      return false;
    }

    // Não tem estrutura de pergunta (sem palavras interrogativas ou pontuação)
    const hasQuestionWord = /\b(como|quando|onde|qual|quais|por que|porque|o que|quem|qual|quais)\b/i.test(q);
    const hasQuestionMark = q.includes('?');
    const hasQuestionStructure = hasQuestionWord || hasQuestionMark || q.toLowerCase().startsWith('como') || q.toLowerCase().startsWith('qual');
    
    // Se não tem estrutura de pergunta, verifica se é uma frase completa
    if (!hasQuestionStructure) {
      // Deve ter pelo menos um verbo e fazer sentido como pergunta
      const hasVerb = /\b(é|são|fazer|faz|funciona|funcionam|tem|têm|pode|podem|deve|devem|quer|querem|precisa|precisam)\b/i.test(q);
      if (!hasVerb) {
        return false;
      }
    }

    // Palavras muito repetidas (mais de 50% do texto)
    const wordCounts = {};
    words.forEach(w => {
      const wLower = w.toLowerCase();
      wordCounts[wLower] = (wordCounts[wLower] || 0) + 1;
    });
    const maxRepetition = Math.max(...Object.values(wordCounts));
    if (maxRepetition / words.length > 0.5) {
      return false;
    }

    // Detecta repetição de palavras consecutivas (ex: "Studio Studio studio")
    const allWords = q.toLowerCase().split(/\s+/);
    let consecutiveRepetition = 1;
    let lastWord = '';
    for (const word of allWords) {
      if (word === lastWord && word.length > 2) {
        consecutiveRepetition++;
        if (consecutiveRepetition >= 2) { // Duas ou mais repetições consecutivas
          return false;
        }
      } else {
        consecutiveRepetition = 1;
      }
      lastWord = word;
    }

    // Detecta padrão "O que é X? X" (pergunta genérica seguida de palavra solta)
    const genericQuestionPattern = /^(o que é|como funciona|quem é|onde está)\s+([^?]+)\?+\s*\1$/i;
    if (genericQuestionPattern.test(q)) {
      return false;
    }

    // Detecta palavra repetida após ponto de interrogação (ex: "O que é Studio? studio")
    const questionWithRepeat = /^(.+\?)\s+(\w+)\s*$/i;
    const match = q.match(questionWithRepeat);
    if (match) {
      const questionPart = match[1].toLowerCase();
      const repeatedWord = match[2].toLowerCase();
      // Verifica se a palavra repetida aparece na pergunta
      if (questionPart.includes(repeatedWord)) {
        return false;
      }
    }

    // Pergunta muito genérica ou sem sentido
    const genericPatterns = [
      /^(o que|como|qual|quais|quem|onde|quando)\s*$/i,
      /^(o que|como|qual|quais|quem|onde|quando)\s+(é|são|faz|fazem)\s*$/i,
      /^[a-z]+\s+[a-z]+\s*$/i, // Apenas duas palavras
    ];
    if (genericPatterns.some(pattern => pattern.test(q))) {
      return false;
    }

    // Detecta textos de OCR mal formatados ou placeholders
    const invalidPrefixes = [
      /^jpeg\]/i,
      /^\[imagem:/i,
      /^imagem:/i,
      /^texto extraído/i,
      /^ocr:/i,
      /^\[imagem/i,
    ];
    if (invalidPrefixes.some(pattern => pattern.test(q))) {
      return false;
    }

    // Detecta textos que são claramente placeholders ou metadados
    if (/\[imagem:.*?\]/i.test(q)) {
      return false;
    }
    if (/texto extraído.*ocr/i.test(q)) {
      return false;
    }
    if (/jpeg.*texto extraído/i.test(q)) {
      return false;
    }

    // Detecta UUIDs no meio do texto (placeholders de arquivo)
    const uuidInTextPattern = /[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/i;
    if (uuidInTextPattern.test(q)) {
      // Se o texto é principalmente um UUID ou contém muito UUID, é inválido
      const uuidMatches = q.match(new RegExp(uuidInTextPattern.source, 'gi'));
      if (uuidMatches && uuidMatches.length > 0 && q.length < 50) {
        return false;
      }
    }

    // Detecta textos com muitos caracteres especiais ou símbolos estranhos
    const alphanumericCount = (q.match(/[a-záàâãéêíóôõúç0-9]/gi) || []).length;
    const totalChars = q.replace(/\s/g, '').length;
    if (totalChars > 0 && alphanumericCount / totalChars < 0.6) {
      return false;
    }

    // Detecta textos que são claramente metadados ou placeholders
    const metadataPatterns = [
      /^\w+\]\s*texto/i,
      /^\w+\]\s*imagem/i,
      /extraído.*ocr/i,
      /ace.*friday.*r\$/i,
    ];
    if (metadataPatterns.some(pattern => pattern.test(q))) {
      return false;
    }

    return true;
  };

  const generateQuestionsFromContent = (title, content) => {
    const questions = [];
    const titleLower = title.toLowerCase();
    const contentLower = content.toLowerCase();

    // Usa regras do JSON se disponíveis, senão usa padrão hardcoded
    const rules = questionGenerationRules || getDefaultRules();

    // Perguntas baseadas no título
    if (rules.titleBased?.enabled && title) {
      const excludedWords = rules.titleBased.excludedWords || ['como', 'para', 'sobre', 'guia', 'manual', 'documento', 'arquivo'];
      const minTitleLength = rules.titleBased.minTitleLength || 3;
      
      const titleWords = title.split(/\s+/).filter(w => 
        w.length >= minTitleLength && !excludedWords.includes(w.toLowerCase())
      );
      
      if (titleWords.length > 0) {
        const mainTopic = titleWords[0];
        const templates = rules.titleBased.templates || ['O que é {{mainTopic}}?', 'Como funciona {{mainTopic}}?'];
        const maxFromTitle = rules.titleBased.maxQuestionsFromTitle || 2;
        
        templates.slice(0, maxFromTitle).forEach(template => {
          const question = template.replace(/\{\{mainTopic\}\}/g, mainTopic);
          if (isValidQuestionBasic(question)) {
            questions.push(question);
          }
        });
      }
    }

    // Perguntas baseadas em palavras-chave
    if (rules.keywordPatterns?.enabled && rules.keywordPatterns.patterns) {
      const maxFromKeywords = rules.limits?.maxQuestionsFromKeywords || 10;
      let keywordQuestionsCount = 0;
      
      for (const patternConfig of rules.keywordPatterns.patterns) {
        if (keywordQuestionsCount >= maxFromKeywords) break;
        
        const regex = new RegExp(patternConfig.pattern, 'i');
        if (regex.test(contentLower) || regex.test(titleLower)) {
          patternConfig.questions.forEach(q => {
            if (keywordQuestionsCount < maxFromKeywords && isValidQuestionBasic(q)) {
              questions.push(q);
              keywordQuestionsCount++;
            }
          });
        }
      }
    }

    // Perguntas baseadas no conteúdo
    if (rules.contentBased?.enabled) {
      const minContentLength = rules.contentBased.minContentLength || 50;
      const maxFromContent = rules.limits?.maxQuestionsFromContent || 5;
      
      if (content.length >= minContentLength) {
        const actionVerbs = rules.contentBased.actionVerbs || ['acesse', 'clique', 'selecione', 'digite', 'insira', 'configure', 'ativar', 'desativar'];
        const filters = rules.contentBased.sentenceFilters || { minLength: 20, maxLength: 150 };
        const maxSentences = rules.contentBased.maxSentencesToProcess || 3;
        const questionTemplate = rules.contentBased.questionTemplate || 'Como {{action}}?';
        
        const sentences = content.split(/[.!?]/).filter(s => {
          const trimmed = s.trim();
          return trimmed.length >= filters.minLength && trimmed.length <= filters.maxLength;
        });
        
        let contentQuestionsCount = 0;
        for (const sentence of sentences.slice(0, maxSentences)) {
          if (contentQuestionsCount >= maxFromContent) break;
          
          const sentenceLower = sentence.toLowerCase().trim();
          for (const verb of actionVerbs) {
            if (sentenceLower.startsWith(verb)) {
              const question = sentence.replace(/^[^\w]*\w+\s+/, '').trim();
              if (question.length > 10 && question.length < 80) {
                const fullQuestion = questionTemplate.replace(/\{\{action\}\}/g, question);
                if (isValidQuestionBasic(fullQuestion)) {
                  questions.push(fullQuestion);
                  contentQuestionsCount++;
                }
              }
              break;
            }
          }
        }

        // Fallback: tenta criar perguntas baseadas em frases importantes
        if (rules.contentBased.fallbackEnabled && questions.length < 3 && sentences.length > 0) {
          const fallbackMax = rules.contentBased.fallbackMaxSentences || 2;
          const fallbackMin = rules.contentBased.fallbackMinLength || 20;
          const fallbackMaxLen = rules.contentBased.fallbackMaxLength || 100;
          
          for (const sentence of sentences.slice(0, fallbackMax)) {
            const trimmed = sentence.trim();
            if (trimmed.length >= fallbackMin && trimmed.length <= fallbackMaxLen) {
              let potentialQuestion = trimmed;
              if (!trimmed.includes('?')) {
                const actionVerbsRegex = new RegExp(`^(${actionVerbs.join('|')})`, 'i');
                if (actionVerbsRegex.test(trimmed)) {
                  potentialQuestion = `Como ${trimmed}?`;
                } else {
                  potentialQuestion = `${trimmed}?`;
                }
              }
              if (isValidQuestionBasic(potentialQuestion)) {
                questions.push(potentialQuestion);
              }
            }
          }
        }
      }
    }

    // Remove duplicatas
    if (rules.deduplication?.enabled) {
      const uniqueQuestions = [];
      const seen = new Set();
      const similarityThreshold = rules.deduplication.similarityThreshold || 0.8;
      
      for (const q of questions) {
        const qLower = q.toLowerCase().trim();
        const normalized = rules.deduplication.normalizeForComparison 
          ? qLower.replace(/[^\w\s]/g, '').replace(/\s+/g, ' ')
          : qLower;
        
        let isDuplicate = false;
        for (const seenQ of seen) {
          const similarity = calculateSimilarity(normalized, seenQ);
          if (similarity > similarityThreshold) {
            isDuplicate = true;
            break;
          }
        }
        
        if (!isDuplicate && isValidQuestionBasic(q)) {
          uniqueQuestions.push(q);
          seen.add(normalized);
        }
      }
      
      const maxQuestions = rules.limits?.maxQuestionsPerDocument || 5;
      return uniqueQuestions.slice(0, maxQuestions);
    }
    
    const maxQuestions = rules.limits?.maxQuestionsPerDocument || 5;
    return questions.filter(q => isValidQuestionBasic(q)).slice(0, maxQuestions);
  };

  // Função auxiliar para regras padrão (fallback)
  const getDefaultRules = () => ({
    titleBased: {
      enabled: true,
      minTitleLength: 3,
      excludedWords: ['como', 'para', 'sobre', 'guia', 'manual', 'documento', 'arquivo'],
      templates: ['O que é {{mainTopic}}?', 'Como funciona {{mainTopic}}?'],
      maxQuestionsFromTitle: 2
    },
    keywordPatterns: {
      enabled: true,
      patterns: [
        { pattern: 'senha|password', questions: ['Como resetar minha senha?', 'Como alterar minha senha?', 'Esqueci minha senha'] },
        { pattern: 'conta|account', questions: ['Como criar uma conta?', 'Como cancelar minha conta?', 'Como fechar minha conta?'] },
        { pattern: 'pagamento|payment|pagar', questions: ['Como fazer um pagamento?', 'Quais são as formas de pagamento?', 'Como pagar?'] },
        { pattern: 'suporte|support|ajuda|help', questions: ['Como entrar em contato com o suporte?', 'Onde posso obter ajuda?', 'Preciso de ajuda'] },
        { pattern: 'produto|product', questions: ['Quais produtos estão disponíveis?', 'Como comprar um produto?', 'Informações sobre produtos'] },
        { pattern: 'ticket|chamado', questions: ['Como abrir um ticket?', 'Como acompanhar meu ticket?', 'Abrir chamado'] },
        { pattern: 'configuração|config|settings', questions: ['Como configurar?', 'Onde estão as configurações?', 'Configurações do sistema'] },
        { pattern: 'resetar|reset', questions: ['Como resetar?', 'Resetar configurações'] },
        { pattern: 'instalar|instalação', questions: ['Como instalar?', 'Instruções de instalação'] },
        { pattern: 'erro|error|problema', questions: ['Como resolver este problema?', 'O que fazer quando ocorre erro?'] }
      ]
    },
    contentBased: {
      enabled: true,
      minContentLength: 50,
      actionVerbs: ['acesse', 'clique', 'selecione', 'digite', 'insira', 'configure', 'ativar', 'desativar'],
      sentenceFilters: { minLength: 20, maxLength: 150 },
      maxSentencesToProcess: 3,
      questionTemplate: 'Como {{action}}?',
      fallbackEnabled: true,
      fallbackMaxSentences: 2,
      fallbackMinLength: 20,
      fallbackMaxLength: 100
    },
    deduplication: {
      enabled: true,
      similarityThreshold: 0.8,
      normalizeForComparison: true
    },
    limits: {
      maxQuestionsPerDocument: 5,
      maxQuestionsFromTitle: 2,
      maxQuestionsFromKeywords: 10,
      maxQuestionsFromContent: 5
    }
  });

  /**
   * Calcula similaridade simples entre duas strings (0-1).
   * 
   * @param {string} str1 - Primeira string
   * @param {string} str2 - Segunda string
   * @returns {number} Similaridade entre 0 e 1
   */
  const calculateSimilarity = (str1, str2) => {
    const words1 = str1.split(/\s+/);
    const words2 = str2.split(/\s+/);
    
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
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
    // Se há "db_ahead", preferimos um reindex completo do tenant (zera chunks e reprocessa)
    const hasInconsistency = stats?.syncStatus === 'db_ahead' && stats?.syncDifference > 0;
    const totalToReindex = hasInconsistency ? (stats?.total || 0) : (stats?.notIndexed || 0);
    
    const confirmed = await confirm({
      title: hasInconsistency ? 'Confirmar reindexação completa' : 'Confirmar reindexação em lote',
      message: hasInconsistency
        ? `Há inconsistência detectada. Deseja reindexar TODOS os documentos do tenant (isso apaga todos os chunks/embeddings do tenant e recria do zero)? Esta operação pode demorar alguns minutos.`
        : `Tem certeza que deseja reindexar todos os documentos não indexados? Esta operação pode demorar alguns minutos.`,
    });

    if (!confirmed) return;

    // Abre o modal de progresso
    setShowReindexModal(true);
    setReindexProgress({
      status: 'processing',
      message: hasInconsistency ? 'Iniciando sincronização...' : 'Iniciando reindexação...',
      total: totalToReindex,
      indexed: 0,
      failed: 0,
      errors: [],
    });

    try {
      setLoading(true);
      const tenantId = agent?.tenantId || null;
      const result = hasInconsistency
        ? await reindexAllTenant(tenantId)
        : await reindexAllNotIndexed(tenantId, false);
      
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
          // Verifica consistência se disponível
          let message = `Reindexação concluída! ${result.indexed} documentos indexados, ${result.failed} falharam.`;
          let toastType = result.failed > 0 ? 'warning' : 'success';
          
          if (result.consistencyCheck) {
            const { isConsistent, message: consistencyMessage } = result.consistencyCheck;
            if (isConsistent === true) {
              message += `\n\n${consistencyMessage}`;
              toastType = 'success';
            } else if (isConsistent === false) {
              message += `\n\n${consistencyMessage}`;
              toastType = 'warning';
            } else {
              message += `\n\n${consistencyMessage}`;
            }
          }
          
          setReindexProgress({
            status: 'completed',
            message: message,
            total: result.total,
            indexed: result.indexed,
            failed: result.failed,
            errors: result.errors || [],
            consistencyCheck: result.consistencyCheck || null,
          });
          
          showToast(message, toastType, result.consistencyCheck ? 8000 : 5000);
          
          if (result.errors && result.errors.length > 0) {
            logger.warn('Erros durante reindexação em lote:', result.errors);
          }
          
          if (result.consistencyCheck) {
            logger.info('Verificação de consistência após reindexação', result.consistencyCheck);
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
      
      // Recarrega dados para atualizar estatísticas após reindexação
      // Aguarda um pouco para garantir que o vector store foi atualizado
      setTimeout(() => {
        loadData();
      }, 1000);
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

  // Função helper para determinar qual domínio um documento pertence
  const getDocumentDomain = (doc) => {
    if (!domainsConfig?.domains) return null;
    
    const docSource = doc.metadata?.source || '';
    if (!docSource) return null;
    
    // Mapeamento de sources para compatibilidade:
    // - "upload" é equivalente a "chat_upload" 
    // - "web_scraping" é atribuído ao Chatbot por padrão (conteúdo raspado geralmente enriquece o chatbot)
    const normalizedSource = docSource === 'upload' ? 'chat_upload' : docSource;
    
    // Verifica se a fonte está nas fontes permitidas do domínio chatbot
    if (domainsConfig.domains.chatbot?.enabled && 
        domainsConfig.domains.chatbot.sources &&
        Array.isArray(domainsConfig.domains.chatbot.sources) &&
        (domainsConfig.domains.chatbot.sources.includes(docSource) || 
         domainsConfig.domains.chatbot.sources.includes(normalizedSource))) {
      return 'chatbot';
    }
    
    // Atribui "web_scraping" ao Chatbot por padrão (se Chatbot estiver habilitado)
    if (docSource === 'web_scraping' && 
        domainsConfig.domains.chatbot?.enabled) {
      return 'chatbot';
    }
    
    // Verifica se a fonte está nas fontes permitidas do domínio rpa
    if (domainsConfig.domains.rpa?.enabled && 
        domainsConfig.domains.rpa.sources &&
        Array.isArray(domainsConfig.domains.rpa.sources) &&
        (domainsConfig.domains.rpa.sources.includes(docSource) || 
         domainsConfig.domains.rpa.sources.includes(normalizedSource))) {
      return 'rpa';
    }
    
    return null;
  };

  // Garante que documents seja sempre um array antes de usar filter/map
  const documentsArray = Array.isArray(documents) ? documents : [];
  
  // Filtro apenas por domínio no frontend (os outros filtros já são aplicados pelo backend)
  // O filtro de domínio é específico do frontend e não está implementado no backend
  const filteredDocs = documentsArray.filter(doc => {
    // Filtro por domínio: verifica se o documento pertence ao domínio selecionado
    if (filters.domain) {
      // Se não há configuração de domínios carregada ainda, não filtra
      if (!domainsConfig?.domains) {
        return true; // Mostra todos enquanto carrega
      }
      
      const docDomain = getDocumentDomain(doc);
      // Se o documento não tem domínio definido e estamos filtrando por um domínio específico, exclui
      // Se o documento tem domínio, verifica se corresponde ao filtro
      if (docDomain !== filters.domain) {
        return false;
      }
    }
    return true;
  });

  // Usa as sources carregadas separadamente para o dropdown
  // Isso garante que todas as sources apareçam mesmo quando um filtro está ativo
  // Se não houver sources carregadas, combina sources conhecidas com sources dos documentos atuais
  const sources = allSources.length > 0 
    ? allSources 
    : [...new Set([...KNOWN_SOURCES, ...documentsArray.map(doc => doc.metadata?.source).filter(Boolean)])].sort();

  return (
    <div className="support-page w-full h-screen" style={{ paddingTop: '60px' }}>
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
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <Button
                onClick={async () => {
                  logger.debug('🖱️ [BOTÃO] Clique no botão "Analisar (10 docs)"', {
                    timestamp: new Date().toISOString(),
                    analyzing,
                    loading
                  });
                  
                  // NUNCA abre o modal antes do confirm
                  // Calcula valores primeiro
                  const indexedDocs = documents?.filter(doc => doc.indexed && doc.status === 'active' && doc.content) || [];
                  const total = indexedDocs.length;
                  const docsToAnalyze = Math.min(10, total);
                  const estimatedMinutes = Math.ceil((docsToAnalyze * 12) / 60);
                  
                  logger.debug('📊 [BOTÃO] Valores calculados antes do confirm', {
                    total,
                    docsToAnalyze,
                    estimatedMinutes
                  });
                  
                  // IMPORTANTE: Mostra confirmação ANTES de qualquer outra ação
                  // O confirm() retorna uma Promise, precisa usar await
                  logger.debug('💬 [BOTÃO] Mostrando diálogo de confirmação...', {
                    message: `Analisar ${docsToAnalyze} documento(s)?`
                  });
                  
                  try {
                    // confirm() retorna Promise, precisa await
                    const confirmed = await confirm({
                      title: `Analisar ${docsToAnalyze} documento(s)?`,
                      message: `Tempo estimado: ~${estimatedMinutes} minuto(s)\n\nDeseja continuar?`,
                      variant: 'warning'
                    });
                    
                    logger.debug('✅ [BOTÃO] Resposta do confirm recebida', {
                      confirmed,
                      timestamp: new Date().toISOString()
                    });
                    
                    // Só executa se confirmou
                    if (confirmed) {
                      logger.debug('✅ [BOTÃO] Usuário confirmou, abrindo modal e iniciando análise', {
                        docsToAnalyze,
                        estimatedMinutes
                      });
                      
                      // Agora sim, abre o modal
                      setShowAnalysisModal(true);
                      logger.debug('📂 [BOTÃO] Modal aberto, aguardando 200ms antes de iniciar análise');
                      
                      // Delay para garantir que o modal abra antes de iniciar análise
                      setTimeout(() => {
                        logger.debug('🚀 [BOTÃO] Iniciando análise após confirmação', {
                          maxDocuments: 10,
                          timestamp: new Date().toISOString()
                        });
                        analyzeDocuments(10);
                      }, 200);
                    } else {
                      logger.debug('❌ [BOTÃO] Usuário cancelou, nada será executado', {
                        timestamp: new Date().toISOString()
                      });
                    }
                  } catch (error) {
                    logger.error('❌ [BOTÃO] Erro ao mostrar confirmação', {
                      error: error.message,
                      timestamp: new Date().toISOString()
                    });
                  }
                  // Se não confirmou, nada acontece (não abre modal, não inicia análise)
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
                title="Analisa até 10 documentos (recomendado, ~2 minutos)"
              >
                {analyzing ? '🔍 Analisando...' : '📊 Analisar (10 docs)'}
              </Button>
              {(() => {
                const indexedDocs = documents?.filter(doc => doc.indexed && doc.status === 'active' && doc.content) || [];
                if (indexedDocs.length > 10) {
                  return (
                    <Button
                      onClick={async () => {
                        logger.debug('🖱️ [BOTÃO] Clique no botão "Analisar Todos"', {
                          timestamp: new Date().toISOString(),
                          analyzing,
                          loading,
                          totalDocuments: indexedDocs.length
                        });
                        
                        // NUNCA abre o modal antes do confirm
                        const total = indexedDocs.length;
                        const estimatedMinutes = Math.ceil((total * 12) / 60);
                        
                        logger.debug('📊 [BOTÃO] Valores calculados antes do confirm (Todos)', {
                          total,
                          estimatedMinutes
                        });
                        
                        // IMPORTANTE: Mostra confirmação ANTES de qualquer outra ação
                        // O confirm() retorna uma Promise, precisa usar await
                        logger.debug('💬 [BOTÃO] Mostrando diálogo de confirmação (Todos)...', {
                          message: `Analisar TODOS os ${total} documentos?`
                        });
                        
                        try {
                          // confirm() retorna Promise, precisa await
                          const confirmed = await confirm({
                            title: `Analisar TODOS os ${total} documentos?`,
                            message: `Tempo estimado: ~${estimatedMinutes} minutos\n\nIsso pode demorar bastante. Deseja continuar?`,
                            variant: 'danger'
                          });
                          
                          logger.debug('✅ [BOTÃO] Resposta do confirm recebida (Todos)', {
                            confirmed,
                            timestamp: new Date().toISOString()
                          });
                          
                          // Só executa se confirmou
                          if (confirmed) {
                            logger.debug('✅ [BOTÃO] Usuário confirmou (Todos), abrindo modal e iniciando análise', {
                              total,
                              estimatedMinutes
                            });
                            
                            // Agora sim, abre o modal
                            setShowAnalysisModal(true);
                            logger.debug('📂 [BOTÃO] Modal aberto (Todos), aguardando 200ms antes de iniciar análise');
                            
                            // Delay para garantir que o modal abra antes de iniciar análise
                            setTimeout(() => {
                              logger.debug('🚀 [BOTÃO] Iniciando análise após confirmação (Todos)', {
                                maxDocuments: 'all',
                                timestamp: new Date().toISOString()
                              });
                              analyzeDocuments('all');
                            }, 200);
                          } else {
                            logger.debug('❌ [BOTÃO] Usuário cancelou (Todos), nada será executado', {
                              timestamp: new Date().toISOString()
                            });
                          }
                        } catch (error) {
                          logger.error('❌ [BOTÃO] Erro ao mostrar confirmação (Todos)', {
                            error: error.message,
                            timestamp: new Date().toISOString()
                          });
                        }
                        // Se não confirmou, nada acontece (não abre modal, não inicia análise)
                      }}
                      disabled={analyzing || loading}
                      style={{ 
                        backgroundColor: 'var(--status-error)', 
                        color: 'white',
                        padding: '10px 20px',
                        borderRadius: '8px',
                        border: 'none',
                        cursor: analyzing || loading ? 'not-allowed' : 'pointer',
                        opacity: analyzing || loading ? 0.6 : 1,
                        whiteSpace: 'nowrap',
                      }}
                      title={`Analisa todos os ${indexedDocs.length} documentos (~${Math.ceil((indexedDocs.length * 12) / 60)} min)`}
                    >
                      {analyzing ? '🔍 Analisando...' : `📊 Analisar Todos (${indexedDocs.length})`}
                    </Button>
                  );
                }
                return null;
              })()}
            </div>
            <Button
              onClick={() => setShowLearningModal(true)}
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
              🧠 Aprendizado Adaptativo
            </Button>
            {/* Botão de Reindexar/Sincronizar */}
            {stats && (() => {
              // Verifica condições para exibir o botão
              const hasNotIndexed = stats.notIndexed > 0;
              const hasInconsistency = stats.syncStatus === 'db_ahead' && stats.syncDifference > 0;
              const hasOrphans = stats.syncStatus === 'vector_ahead' && stats.syncDifference > 0;
              // Se não há stats do vector store mas há docs indexados, pode haver inconsistência
              const possibleInconsistency = !stats.vectorStoreStats && stats.indexed > 0;
              
              const shouldShow = hasNotIndexed || hasInconsistency || hasOrphans || possibleInconsistency;
              
              logger.info('[RAGDocumentsPage] Condições do botão - RENDER', {
                hasNotIndexed,
                hasInconsistency,
                possibleInconsistency,
                shouldShow,
                willRender: shouldShow,
                stats: {
                  indexed: stats.indexed,
                  notIndexed: stats.notIndexed,
                  syncStatus: stats.syncStatus,
                  syncDifference: stats.syncDifference,
                  hasVectorStoreStats: !!stats.vectorStoreStats
                }
              });
              
              if (!shouldShow) {
                logger.debug('[RAGDocumentsPage] Botão NÃO será renderizado', { shouldShow });
                return null;
              }
              
              // Determina texto e cor do botão
              const isSync = hasInconsistency || (possibleInconsistency && stats.indexed > 0);
              const isCleanOrphans = hasOrphans;
              const count = hasInconsistency
                ? stats.syncDifference
                : (hasOrphans ? stats.syncDifference : (possibleInconsistency ? stats.indexed : stats.notIndexed));
              
              logger.info('[RAGDocumentsPage] Botão SERÁ renderizado', {
                isSync,
                count,
                loading,
                buttonText: isSync ? `🔄 Sincronizar (${count})` : `🔄 Reindexar Todos (${count})`
              });
              
              const buttonElement = (
                <Button
                  key={`reindex-button-${count}-${isSync}-${isCleanOrphans}`}
                  onClick={isCleanOrphans ? handleCleanOrphans : handleReindexAll}
                  disabled={loading}
                  style={{ 
                    backgroundColor: (isCleanOrphans || isSync) ? 'var(--status-warning)' : 'var(--accent-primary)', 
                    color: 'white',
                    padding: '10px 20px',
                    borderRadius: '8px',
                    border: 'none',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.6 : 1,
                    whiteSpace: 'nowrap',
                    position: 'relative',
                    zIndex: 10,
                    display: 'inline-block',
                    minWidth: '150px',
                  }}
                  title={
                    isCleanOrphans
                      ? `Limpar documentos órfãos do vector store (${count})`
                      : (isSync
                        ? `Sincronizar ${count} documento(s) marcado(s) como indexado(s) mas não encontrado(s) no vector store`
                        : `Reindexar ${count} documento(s) não indexado(s)`)
                  }
                >
                  {loading ? 'Reindexando...' : (
                    isCleanOrphans
                      ? `🧹 Limpar Órfãos (${count})`
                      : (isSync
                        ? `🔄 Sincronizar (${count})`
                        : `🔄 Reindexar Todos (${count})`)
                  )}
                </Button>
              );
              
              logger.info('[RAGDocumentsPage] Botão criado, retornando elemento', {
                hasButton: !!buttonElement,
                buttonType: buttonElement?.type
              });
              
              return buttonElement;
            })()}
            {/* Debug: Força renderização do botão se houver inconsistência */}
            {stats && stats.syncStatus === 'db_ahead' && stats.syncDifference > 0 && (
              <Button
                key="reindex-button-debug"
                onClick={handleReindexAll}
                disabled={loading}
                style={{ 
                  backgroundColor: 'var(--status-warning)', 
                  color: 'white',
                  padding: '10px 20px',
                  borderRadius: '8px',
                  border: '2px solid red',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.6 : 1,
                  whiteSpace: 'nowrap',
                  position: 'relative',
                  zIndex: 100,
                  display: 'block',
                  minWidth: '150px',
                  marginTop: '10px',
                }}
                title={`DEBUG: Sincronizar ${stats.syncDifference} documento(s)`}
              >
                {loading ? 'Reindexando...' : `🔄 Sincronizar (${stats.syncDifference}) [DEBUG]`}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Estatísticas Gerais */}
      {stats && (
        <>
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
          
          {/* Alerta de Inconsistência */}
          {stats.syncStatus && stats.syncStatus !== 'synced' && (
            <div className="mb-6 p-4 rounded-lg border-2" style={{
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              borderColor: '#ef4444'
            }}>
              <div className="flex items-start gap-3">
                <span className="text-2xl">⚠️</span>
                <div className="flex-1">
                  <div className="font-semibold text-status-error mb-1">
                    Inconsistência Detectada
                  </div>
                  <div className="text-sm text-text-secondary mb-2">
                    {stats.syncStatus === 'db_ahead' ? (
                      <>
                        Há {stats.syncDifference} documento(s) marcado(s) como indexado(s) no banco de dados, 
                        mas não encontrado(s) no vector store. Isso pode indicar que:
                        <ul className="list-disc list-inside mt-2 ml-2">
                          <li>Os documentos foram marcados como indexados mas a indexação falhou</li>
                          <li>O vector store foi limpo/resetado</li>
                          <li>Há um problema de sincronização entre tenants</li>
                        </ul>
                        <div className="mt-2">
                          <strong>Solução:</strong> Use o botão "Reindexar Todos" para sincronizar os documentos.
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            onClick={handleReindexAll}
                            disabled={loading}
                            style={{
                              backgroundColor: 'var(--accent-primary)',
                              color: 'white',
                              padding: '8px 14px',
                              borderRadius: '8px',
                              border: 'none',
                              cursor: loading ? 'not-allowed' : 'pointer',
                              opacity: loading ? 0.65 : 1,
                              whiteSpace: 'nowrap',
                            }}
                            title="Reindexar/sincronizar documentos para alinhar BD e vector store"
                          >
                            {loading ? 'Processando...' : `🔄 Reindexar Todos (${(stats.notIndexed || 0) + (stats.syncDifference || 0)})`}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        O vector store tem {stats.syncDifference} documento(s) a mais que o banco de dados (indexados no BD).
                        Isso pode indicar dados órfãos no vector store <strong>ou</strong> estado de indexação desatualizado no BD.
                        <div className="mt-2">
                          <strong>Solução:</strong> Use o botão abaixo para tentar limpar órfãos e/ou reconciliar o estado do BD.
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            onClick={handleCleanOrphans}
                            disabled={loading}
                            style={{
                              backgroundColor: 'var(--status-warning)',
                              color: 'white',
                              padding: '8px 14px',
                              borderRadius: '8px',
                              border: 'none',
                              cursor: loading ? 'not-allowed' : 'pointer',
                              opacity: loading ? 0.65 : 1,
                              whiteSpace: 'nowrap',
                            }}
                            title="Remover do vector store documentos/chunks que não existem mais no BD"
                          >
                            {loading ? 'Processando...' : `🧹 Limpar Órfãos (${stats.syncDifference || 0})`}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                  {stats.vectorStoreStats && (
                    <div className="text-xs text-text-tertiary mt-2">
                      Vector Store: {stats.vectorStoreStats.indexedDocuments} docs, {stats.vectorStoreStats.indexedChunks} chunks
                      {stats.vectorStoreStats.aggregated && ` (agregado de ${stats.vectorStoreStats.tenantsCount} tenant(s))`}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Totais por Fonte */}
      {stats && stats.bySource && Object.keys(stats.bySource).length > 0 && (
        <div className="mb-6">
          <h3 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
            <span>📊</span>
            <span>Totais por Fonte</span>
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {Object.entries(stats.bySource)
              .sort((a, b) => b[1] - a[1]) // Ordena por quantidade (maior primeiro)
              .map(([source, count]) => {
                // Cores diferentes para cada fonte
                const sourceColors = {
                  'web_scraping': 'bg-status-info/20 border-status-info/30 text-status-info',
                  'knowledge_base': 'bg-status-success/20 border-status-success/30 text-status-success',
                  'product_docs': 'bg-status-warning/20 border-status-warning/30 text-status-warning',
                  'tickets': 'bg-accent-light border-accent-primary/30 text-accent-primary',
                  'upload': 'bg-bg-secondary border-border-default text-text-primary',
                  'manual': 'bg-text-tertiary/20 border-text-tertiary/30 text-text-secondary',
                };
                const colorClass = sourceColors[source] || 'bg-bg-secondary border-border-default text-text-primary';
                
                return (
                  <div
                    key={source}
                    className={`bg-bg-elevated rounded-xl border p-4 shadow-lg cursor-pointer hover:shadow-xl transition-all ${colorClass}`}
                    onClick={() => setFilters({ ...filters, source })}
                  >
                    <div className="text-2xl font-bold mb-1">{count}</div>
                    <div className="text-xs font-medium capitalize truncate" title={source}>
                      {source.replace(/_/g, ' ')}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Totais por Domínio */}
      {stats && documentsArray.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
            <span>🔒</span>
            <span>Totais por Domínio</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(() => {
              // Calcula totais por domínio
              const domainStats = {
                chatbot: 0,
                rpa: 0,
                none: 0,
              };

              documentsArray.forEach(doc => {
                const domain = getDocumentDomain(doc);
                if (domain === 'chatbot') {
                  domainStats.chatbot++;
                } else if (domain === 'rpa') {
                  domainStats.rpa++;
                } else {
                  domainStats.none++;
                }
              });

              return (
                <>
                  {domainStats.chatbot > 0 && (
                    <div
                      className="bg-bg-elevated rounded-xl border border-status-info/30 p-6 shadow-lg cursor-pointer hover:shadow-xl transition-all bg-status-info/10"
                      onClick={() => setFilters({ ...filters, domain: 'chatbot' })}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-2xl font-bold text-status-info">{domainStats.chatbot}</div>
                        <span className="text-sm font-semibold text-status-info">🤖 Chatbot</span>
                      </div>
                      <div className="text-xs text-text-secondary">Documentos do domínio Chatbot</div>
                    </div>
                  )}
                  {domainStats.rpa > 0 && (
                    <div
                      className="bg-bg-elevated rounded-xl border border-status-warning/30 p-6 shadow-lg cursor-pointer hover:shadow-xl transition-all bg-status-warning/10"
                      onClick={() => setFilters({ ...filters, domain: 'rpa' })}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-2xl font-bold text-status-warning">{domainStats.rpa}</div>
                        <span className="text-sm font-semibold text-status-warning">⚙️ RPA</span>
                      </div>
                      <div className="text-xs text-text-secondary">Documentos do domínio RPA</div>
                    </div>
                  )}
                  {domainStats.none > 0 && (
                    <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-2xl font-bold text-text-secondary">{domainStats.none}</div>
                        <span className="text-sm font-semibold text-text-secondary">📄 Sem Domínio</span>
                      </div>
                      <div className="text-xs text-text-tertiary">Documentos sem domínio definido</div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Isolamento de Domínios */}
      {domainsConfig && (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
          <h3 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
            <span>🔒</span>
            <span>Isolamento de Domínios</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {domainsConfig.domains?.chatbot && (
              <div className={`rounded-lg p-4 border ${
                domainsConfig.domains.chatbot.enabled 
                  ? 'bg-status-success/10 border-status-success/30' 
                  : 'bg-status-error/10 border-status-error/30'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-lg font-semibold text-text-primary">Chatbot</h4>
                  <span className={`px-2 py-1 rounded text-xs ${
                    domainsConfig.domains.chatbot.enabled 
                      ? 'bg-status-success/20 text-status-success' 
                      : 'bg-status-error/20 text-status-error'
                  }`}>
                    {domainsConfig.domains.chatbot.enabled ? '✓ Habilitado' : '✗ Desabilitado'}
                  </span>
                </div>
                <div className="text-sm text-text-secondary mb-2">
                  <strong>Fontes permitidas:</strong>
                </div>
                <div className="flex flex-wrap gap-2">
                  {domainsConfig.domains.chatbot.sources && domainsConfig.domains.chatbot.sources.length > 0 ? (
                    domainsConfig.domains.chatbot.sources.map((source, idx) => (
                      <span key={idx} className="px-2 py-1 bg-bg-secondary text-text-primary rounded text-xs">
                        {source}
                      </span>
                    ))
                  ) : (
                    <span className="text-text-tertiary text-xs">Nenhuma fonte configurada</span>
                  )}
                </div>
                {domainsConfig.domains.chatbot.defaultCategory && (
                  <div className="mt-2 text-xs text-text-tertiary">
                    Categoria padrão: <span className="text-text-secondary">{domainsConfig.domains.chatbot.defaultCategory}</span>
                  </div>
                )}
              </div>
            )}
            {domainsConfig.domains?.rpa && (
              <div className={`rounded-lg p-4 border ${
                domainsConfig.domains.rpa.enabled 
                  ? 'bg-status-success/10 border-status-success/30' 
                  : 'bg-status-error/10 border-status-error/30'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-lg font-semibold text-text-primary">RPA</h4>
                  <span className={`px-2 py-1 rounded text-xs ${
                    domainsConfig.domains.rpa.enabled 
                      ? 'bg-status-success/20 text-status-success' 
                      : 'bg-status-error/20 text-status-error'
                  }`}>
                    {domainsConfig.domains.rpa.enabled ? '✓ Habilitado' : '✗ Desabilitado'}
                  </span>
                </div>
                <div className="text-sm text-text-secondary mb-2">
                  <strong>Fontes permitidas:</strong>
                </div>
                <div className="flex flex-wrap gap-2">
                  {domainsConfig.domains.rpa.sources && domainsConfig.domains.rpa.sources.length > 0 ? (
                    domainsConfig.domains.rpa.sources.map((source, idx) => (
                      <span key={idx} className="px-2 py-1 bg-bg-secondary text-text-primary rounded text-xs">
                        {source}
                      </span>
                    ))
                  ) : (
                    <span className="text-text-tertiary text-xs">Nenhuma fonte configurada</span>
                  )}
                </div>
                {domainsConfig.domains.rpa.defaultCategory && (
                  <div className="mt-2 text-xs text-text-tertiary">
                    Categoria padrão: <span className="text-text-secondary">{domainsConfig.domains.rpa.defaultCategory}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          {domainsConfig.tenantId && (
            <div className="mt-4 pt-4 border-t border-border-default text-xs text-text-tertiary">
              Tenant ID: <span className="text-text-secondary font-mono">{domainsConfig.tenantId}</span>
            </div>
          )}
        </div>
      )}

      {/* Filtros */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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
              Domínio
            </label>
            <select
              value={filters.domain}
              onChange={(e) => setFilters({ ...filters, domain: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
            >
              <option value="">Todos os domínios</option>
              {domainsConfig?.domains?.chatbot && (
                <option value="chatbot">
                  Chatbot {domainsConfig.domains.chatbot.enabled ? '✓' : '✗'}
                </option>
              )}
              {domainsConfig?.domains?.rpa && (
                <option value="rpa">
                  RPA {domainsConfig.domains.rpa.enabled ? '✓' : '✗'}
                </option>
              )}
            </select>
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
                    {getDocumentDomain(doc) && (
                      <span className={`text-xs px-2 py-1 rounded font-medium ${
                        getDocumentDomain(doc) === 'chatbot' 
                          ? 'bg-status-info/20 text-status-info border border-status-info/30' 
                          : 'bg-status-warning/20 text-status-warning border border-status-warning/30'
                      }`}>
                        {getDocumentDomain(doc) === 'chatbot' ? '🤖 Chatbot' : '⚙️ RPA'}
                      </span>
                    )}
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
                  {getDetailsText(doc) ? (
                    <p className="text-sm text-text-secondary mb-3 line-clamp-3">
                      {getDetailsText(doc).length > 200 ? `${getDetailsText(doc).substring(0, 200)}...` : getDetailsText(doc)}
                    </p>
                  ) : (
                    <div className="mb-3">
                      <p className="text-sm text-status-warning mb-2">
                        ⚠️ Documento sem conteúdo
                      </p>
                      <p className="text-xs text-text-tertiary">
                        Este documento não possui conteúdo para exibição. Ele pode estar vazio ou o conteúdo não foi carregado.
                      </p>
                    </div>
                  )}
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
                    {!doc.content && (
                      <span className="px-2 py-1 rounded bg-status-warning/20 text-status-warning">
                        ⚠️ Sem conteúdo
                      </span>
                    )}
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
                {(doc.metadata?.url || doc.metadata?.filePath || doc.metadata?.file || doc.metadata?.sourceUrl) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const originalUrl = doc.metadata?.url || doc.metadata?.sourceUrl || doc.metadata?.filePath || doc.metadata?.file;
                      if (originalUrl && (originalUrl.startsWith('http://') || originalUrl.startsWith('https://'))) {
                        window.open(originalUrl, '_blank', 'noopener,noreferrer');
                      } else if (originalUrl) {
                        // Se for um caminho de arquivo, tenta abrir ou fazer download
                        window.open(originalUrl, '_blank', 'noopener,noreferrer');
                      }
                    }}
                    className="text-status-info hover:text-status-info/80"
                    title="Ver documento original"
                  >
                    🔗
                  </button>
                )}
                {(doc.metadata?.source === 'file' || doc.metadata?.fileName || doc.metadata?.filename || doc.metadata?.originalBinary?.stored) && (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      const filenameHint =
                        doc.metadata?.originalBinary?.filename ||
                        doc.metadata?.fileName ||
                        doc.metadata?.filename ||
                        doc.title ||
                        doc.id;
                      await downloadFromUrlBestEffort(
                        `/rag/documents/${encodeURIComponent(doc.id)}/download`,
                        filenameHint,
                        { headers: getAuthHeaders() }
                      );
                    }}
                    className="text-text-secondary hover:text-text-primary"
                    title="Baixar arquivo original (DB)"
                  >
                    ⬇️
                  </button>
                )}
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
                  disabled={loading || !!deletingById[String(doc.id)]}
                  className="text-status-error hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
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

          {/* Verificação de Consistência */}
          {reindexProgress.status === 'completed' && reindexProgress.consistencyCheck && (
            <div className={`mb-4 p-4 rounded-lg border-2 ${
              reindexProgress.consistencyCheck.isConsistent === true 
                ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' 
                : reindexProgress.consistencyCheck.isConsistent === false
                ? 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800'
                : 'bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700'
            }`}>
              <div className="flex items-start gap-2">
                <span className="text-xl">
                  {reindexProgress.consistencyCheck.isConsistent === true ? '✅' : 
                   reindexProgress.consistencyCheck.isConsistent === false ? '⚠️' : 'ℹ️'}
                </span>
                <div className="flex-1">
                  <div className="font-semibold mb-1 text-text-primary">
                    {reindexProgress.consistencyCheck.isConsistent === true ? 'Consistência Verificada' :
                     reindexProgress.consistencyCheck.isConsistent === false ? 'Inconsistência Detectada' :
                     'Verificação de Consistência'}
                  </div>
                  <div className="text-sm text-text-secondary mb-2">
                    {reindexProgress.consistencyCheck.message}
                  </div>
                  {reindexProgress.consistencyCheck.isConsistent === false && (
                    <div className="text-xs text-text-tertiary mt-2 space-y-1">
                      <div>Banco de Dados: <span className="font-semibold">{reindexProgress.consistencyCheck.dbIndexed}</span> documentos indexados</div>
                      <div>Vector Store: <span className="font-semibold">{reindexProgress.consistencyCheck.vectorIndexed}</span> documentos indexados</div>
                      <div className="mt-1 font-semibold text-status-warning">Diferença: {reindexProgress.consistencyCheck.difference} documento(s)</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

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

            {/* Documento original (URL) */}
            {(selectedDocument.metadata?.url ||
              selectedDocument.metadata?.filePath ||
              selectedDocument.metadata?.file ||
              selectedDocument.metadata?.sourceUrl) && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Documento Original</label>
                <div className="flex items-center gap-2 flex-wrap">
                  {(() => {
                    const raw =
                      selectedDocument.metadata?.url ||
                      selectedDocument.metadata?.sourceUrl ||
                      selectedDocument.metadata?.filePath ||
                      selectedDocument.metadata?.file ||
                      '';
                    const href = raw && raw.startsWith('/') ? buildApiUrl(raw) : raw;
                    if (href) {
                      return (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent-primary hover:text-accent-hover underline flex items-center gap-2 break-all"
                        >
                          <span>🔗</span>
                          <span>{href}</span>
                          <span className="text-xs text-text-tertiary">(abrir em nova aba)</span>
                        </a>
                      );
                    }
                    return null;
                  })()}
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded bg-bg-tertiary text-text-secondary hover:text-text-primary"
                    onClick={async () => {
                      const originalUrl =
                        selectedDocument.metadata?.url ||
                        selectedDocument.metadata?.sourceUrl ||
                        selectedDocument.metadata?.filePath ||
                        selectedDocument.metadata?.file;
                      const filenameHint =
                        selectedDocument.metadata?.fileName ||
                        selectedDocument.metadata?.filename ||
                        selectedDocument.title ||
                        selectedDocument.id;
                      await downloadFromUrlBestEffort(originalUrl, filenameHint);
                    }}
                    title="Tentar baixar o documento original"
                  >
                    ⬇️ Download
                  </button>
                </div>
              </div>
            )}

            {/* Binário original (armazenado no BD) - para uploads */}
            {(selectedDocument?.metadata?.fileName || selectedDocument?.metadata?.filename || selectedDocument?.metadata?.originalBinary?.stored) && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Arquivo Original (binário)</label>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded bg-bg-tertiary text-text-secondary hover:text-text-primary"
                    onClick={async () => {
                      const filenameHint =
                        selectedDocument.metadata?.originalBinary?.filename ||
                        selectedDocument.metadata?.fileName ||
                        selectedDocument.metadata?.filename ||
                        selectedDocument.title ||
                        selectedDocument.id;
                      await downloadFromUrlBestEffort(
                        `/rag/documents/${encodeURIComponent(selectedDocument.id)}/download`,
                        filenameHint,
                        { headers: getAuthHeaders() }
                      );
                    }}
                    title="Baixar o arquivo original salvo no banco"
                  >
                    ⬇️ Baixar arquivo (DB)
                  </button>
                  {selectedDocument.metadata?.originalBinary?.mimeType && (
                    <span className="text-xs text-text-tertiary">
                      {selectedDocument.metadata.originalBinary.mimeType}
                    </span>
                  )}
                  {!selectedDocument?.metadata?.originalBinary?.stored && (
                    <span className="text-xs text-text-tertiary">
                      (Obs.: este documento não tem a flag `originalBinary.stored`; se o download acima retornar 404, o binário não está salvo no BD.)
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Texto extraído (preferencial) */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Texto extraído</label>
              <div className="bg-bg-secondary rounded-lg p-4 max-h-96 overflow-y-auto">
                <p className="text-text-primary text-sm whitespace-pre-wrap break-words">
                  {getDetailsText(selectedDocument) || 'Sem texto extraído'}
                </p>
              </div>
              {getDetailsText(selectedDocument) && (
                <p className="text-text-tertiary text-xs mt-1">
                  {getDetailsText(selectedDocument).length} caractere{getDetailsText(selectedDocument).length !== 1 ? 's' : ''}
                </p>
              )}
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded bg-bg-tertiary text-text-secondary hover:text-text-primary"
                  onClick={() => {
                    const filename =
                      selectedDocument.metadata?.fileName ||
                      selectedDocument.metadata?.filename ||
                      selectedDocument.title ||
                      selectedDocument.id ||
                      'texto-extraido';
                    downloadTextAsFile(filename, getDetailsText(selectedDocument));
                  }}
                  title="Baixar o texto extraído como .txt"
                >
                  ⬇️ Baixar texto (.txt)
                </button>
                {selectedDocument.metadata?.fileName && (
                  <span className="text-xs text-text-tertiary">
                    (Obs.: este download é do texto extraído; quando disponível, o binário original pode ser baixado acima)
                  </span>
                )}
              </div>

              {(() => {
                const extracted = getExtractedText(selectedDocument);
                const indexable = (selectedDocument?.content && typeof selectedDocument.content === 'string')
                  ? selectedDocument.content
                  : '';
                const showIndexable = extracted && indexable && extracted.trim() !== indexable.trim();
                if (!showIndexable) return null;
                return (
                  <details className="mt-3 cursor-pointer">
                    <summary className="text-xs text-text-tertiary select-none">
                      Ver conteúdo indexável (o que vai para o vector store)
                    </summary>
                    <div className="bg-bg-secondary rounded-lg p-3 mt-2 max-h-64 overflow-y-auto">
                      <p className="text-text-secondary text-xs whitespace-pre-wrap break-words">
                        {indexable}
                      </p>
                    </div>
                  </details>
                );
              })()}
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
                disabled={loading || (selectedDocument?.id && !!deletingById[String(selectedDocument.id)])}
                style={{
                  backgroundColor: 'var(--status-error)',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: (loading || (selectedDocument?.id && !!deletingById[String(selectedDocument.id)])) ? 'not-allowed' : 'pointer',
                  opacity: (loading || (selectedDocument?.id && !!deletingById[String(selectedDocument.id)])) ? 0.6 : 1,
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
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div>
                    <div className="text-2xl font-bold text-text-primary">{analysisResults.totalDocuments}</div>
                    <div className="text-sm text-text-secondary">Total de Documentos</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-text-primary">
                      {analysisResults.totalIndexedDocuments !== undefined 
                        ? analysisResults.totalIndexedDocuments 
                        : analysisResults.documentsAnalyzed}
                    </div>
                    <div className="text-sm text-text-secondary">
                      {analysisResults.totalIndexedDocuments !== undefined 
                        ? 'Disponíveis para Análise' 
                        : 'Documentos Analisados'}
                    </div>
                    {analysisResults.totalIndexedDocuments !== undefined && 
                     analysisResults.documentsSelected < analysisResults.totalIndexedDocuments && (
                      <div className="text-xs text-status-warning mt-1">
                        (limite: {analysisResults.documentsSelected})
                      </div>
                    )}
                    {analysisResults.totalIndexedDocuments !== undefined && 
                     analysisResults.documentsSelected === analysisResults.totalIndexedDocuments &&
                     analysisResults.documentsAnalyzed < analysisResults.documentsSelected && (
                      <div className="text-xs text-text-secondary mt-1">
                        ({analysisResults.documentsAnalyzed} com perguntas)
                      </div>
                    )}
                  </div>
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
                {analysisResults.totalIndexedDocuments !== undefined && 
                 analysisResults.totalIndexedDocuments > analysisResults.documentsAnalyzed && (
                  <div className="mt-3 pt-3 border-t border-border-default">
                    <div className="text-xs text-text-secondary">
                      {analysisResults.documentsSelected < analysisResults.totalIndexedDocuments ? (
                        <>
                          <span className="font-semibold">Nota:</span> Apenas {analysisResults.documentsSelected} de {analysisResults.totalIndexedDocuments} documentos disponíveis foram selecionados para análise (limite padrão). Desses, {analysisResults.documentsAnalyzed} documentos geraram perguntas e foram analisados. Use "Analisar Todos" para processar todos os documentos disponíveis.
                          {analysisResults.documentsWithoutQuestions && analysisResults.documentsWithoutQuestions.length > 0 && (
                            <> Veja a seção "Documentos Não Analisados" abaixo para detalhes sobre os {analysisResults.documentsWithoutQuestions.length} documento(s) que não geraram perguntas.</>
                          )}
                        </>
                      ) : (
                        <>
                          <span className="font-semibold">Nota:</span> {analysisResults.documentsSelected} documentos foram selecionados para análise, mas apenas {analysisResults.documentsAnalyzed} documentos geraram perguntas e foram analisados.
                          {analysisResults.documentsWithoutQuestions && analysisResults.documentsWithoutQuestions.length > 0 ? (
                            <> Veja a seção "Documentos Não Analisados" abaixo para ver quais documentos não foram analisados e os motivos ({analysisResults.documentsWithoutQuestions.length} documento(s)).</>
                          ) : (
                            <> Alguns documentos podem não ter conteúdo suficiente para gerar perguntas de teste.</>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
                <div className="mt-4 pt-4 border-t border-border-default">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-secondary">Taxa de sucesso:</span>
                    <span className="text-lg font-semibold text-text-primary">
                      {Math.round((analysisResults.successfulQuestions / analysisResults.totalQuestions) * 100)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Cards de Detalhes */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                {/* Card: Taxa de Sucesso */}
                <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-text-secondary">Taxa de Sucesso</span>
                    <span className="text-xs px-2 py-1 rounded bg-status-success/20 text-status-success">
                      {analysisResults.totalQuestions > 0 
                        ? Math.round((analysisResults.successfulQuestions / analysisResults.totalQuestions) * 100)
                        : 0}%
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-text-primary">
                    {analysisResults.successfulQuestions}/{analysisResults.totalQuestions}
                  </div>
                  <div className="text-xs text-text-secondary mt-1">
                    Perguntas respondidas com sucesso
                  </div>
                </div>

                {/* Card: Média de Perguntas por Documento */}
                <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-text-secondary">Média por Documento</span>
                    <span className="text-xs px-2 py-1 rounded bg-bg-tertiary text-text-secondary">
                      Perguntas
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-text-primary">
                    {analysisResults.documentsAnalyzed > 0
                      ? (analysisResults.totalQuestions / analysisResults.documentsAnalyzed).toFixed(1)
                      : '0'}
                  </div>
                  <div className="text-xs text-text-secondary mt-1">
                    Perguntas por documento analisado
                  </div>
                </div>

                {/* Card: Documentos Não Indexados */}
                {analysisResults.totalIndexedDocuments !== undefined && (
                  <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-text-secondary">Não Indexados</span>
                      <span className="text-xs px-2 py-1 rounded bg-status-warning/20 text-status-warning">
                        {analysisResults.totalDocuments - analysisResults.totalIndexedDocuments}
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-text-primary">
                      {analysisResults.totalDocuments - analysisResults.totalIndexedDocuments}
                    </div>
                    <div className="text-xs text-text-secondary mt-1">
                      Documentos não disponíveis para análise
                    </div>
                  </div>
                )}

                {/* Card: Duplicatas Removidas */}
                {analysisResults.duplicatesRemoved > 0 && (
                  <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-text-secondary">Duplicatas Removidas</span>
                      <span className="text-xs px-2 py-1 rounded bg-bg-tertiary text-text-secondary">
                        Limpeza
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-text-primary">
                      {analysisResults.duplicatesRemoved}
                    </div>
                    <div className="text-xs text-text-secondary mt-1">
                      Resultados duplicados removidos
                    </div>
                  </div>
                )}

                {/* Card: Documentos Sem Perguntas ou Não Analisados */}
                {analysisResults.totalIndexedDocuments !== undefined && 
                 analysisResults.totalIndexedDocuments > analysisResults.documentsAnalyzed && (
                  <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-text-secondary">
                        {analysisResults.documentsSelected < analysisResults.totalIndexedDocuments
                          ? 'Documentos Não Analisados'
                          : 'Documentos Sem Perguntas'}
                      </span>
                      <span className="text-xs px-2 py-1 rounded bg-status-warning/20 text-status-warning">
                        {analysisResults.documentsSelected < analysisResults.totalIndexedDocuments
                          ? 'Limite'
                          : 'Sem conteúdo'}
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-text-primary">
                      {analysisResults.documentsSelected - analysisResults.documentsAnalyzed}
                    </div>
                    <div className="text-xs text-text-secondary mt-1">
                      {analysisResults.documentsSelected < analysisResults.totalIndexedDocuments
                        ? `Documentos disponíveis não analisados (de ${analysisResults.totalIndexedDocuments} disponíveis)`
                        : 'Documentos selecionados que não geraram perguntas'}
                    </div>
                  </div>
                )}

                {/* Card: Taxa de Cobertura */}
                {analysisResults.totalIndexedDocuments !== undefined && (
                  <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-text-secondary">Cobertura de Análise</span>
                      <span className="text-xs px-2 py-1 rounded bg-status-success/20 text-status-success">
                        {Math.round((analysisResults.documentsAnalyzed / analysisResults.documentsSelected) * 100)}%
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-text-primary">
                      {analysisResults.documentsAnalyzed}/{analysisResults.documentsSelected}
                    </div>
                    <div className="text-xs text-text-secondary mt-1">
                      {analysisResults.documentsSelected < analysisResults.totalIndexedDocuments
                        ? `Documentos analisados dos ${analysisResults.totalIndexedDocuments} disponíveis`
                        : 'Documentos que geraram perguntas dos selecionados'}
                    </div>
                  </div>
                )}

                {/* Card: Taxa de Falha */}
                {analysisResults.failedQuestions > 0 && (
                  <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-text-secondary">Taxa de Falha</span>
                      <span className="text-xs px-2 py-1 rounded bg-status-error/20 text-status-error">
                        {analysisResults.totalQuestions > 0
                          ? Math.round((analysisResults.failedQuestions / analysisResults.totalQuestions) * 100)
                          : 0}%
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-status-error">
                      {analysisResults.failedQuestions}
                    </div>
                    <div className="text-xs text-text-secondary mt-1">
                      Perguntas sem resposta encontrada
                    </div>
                  </div>
                )}

                {/* Card: Eficiência da Análise */}
                <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-text-secondary">Eficiência</span>
                    <span className="text-xs px-2 py-1 rounded bg-status-success/20 text-status-success">
                      {analysisResults.totalQuestions > 0 && analysisResults.successfulQuestions > 0
                        ? Math.round((analysisResults.successfulQuestions / analysisResults.totalQuestions) * 100)
                        : 0}%
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-text-primary">
                    {analysisResults.totalQuestions > 0
                      ? ((analysisResults.successfulQuestions / analysisResults.totalQuestions) * 100).toFixed(1)
                      : '0'}%
                  </div>
                  <div className="text-xs text-text-secondary mt-1">
                    Taxa de respostas bem-sucedidas
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
                          <h4 className="text-text-primary font-semibold mb-1" title={result.documentTitle || result.documentId}>
                            {(() => {
                              const title = result.documentTitle || '';
                              // Se título é UUID ou muito curto, tenta usar preview da resposta
                              if (/^[0-9a-f-]{36}$/i.test(title) || (title.length < 10 && result.response)) {
                                return result.response?.substring(0, 80) || title || result.documentId.substring(0, 30);
                              }
                              return title || result.documentId.substring(0, 30);
                            })()}
                          </h4>
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
                {analysisResults.duplicatesRemoved > 0 && (
                  <div className="mb-3 p-2 bg-status-warning/10 border border-status-warning/30 rounded text-sm text-text-secondary">
                    ⚠️ {analysisResults.duplicatesRemoved} resultado(s) duplicado(s) removido(s)
                  </div>
                )}
                <div className="space-y-2">
                  {Array.from(
                    new Map(
                      analysisResults.results.map(r => [r.documentId, r.documentTitle])
                    ).entries()
                  ).map(([docId, docTitle]) => {
                    const docResults = analysisResults.results.filter(r => r.documentId === docId);
                    const successCount = docResults.filter(r => r.success).length;
                    // Melhora título se for muito curto ou for UUID
                    const displayTitle = docTitle.length > 50 || /^[0-9a-f-]{36}$/i.test(docTitle)
                      ? (docResults[0]?.response?.substring(0, 80) || docTitle || docId.substring(0, 30))
                      : docTitle;
                    
                    return (
                      <div key={docId} className="bg-bg-secondary rounded-lg p-3">
                        <div className="flex justify-between items-center">
                          <span className="text-text-primary font-medium" title={docTitle || docId}>
                            {displayTitle}
                          </span>
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

              {/* Documentos Não Analisados */}
              {analysisResults.documentsWithoutQuestions && analysisResults.documentsWithoutQuestions.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-lg font-semibold text-text-primary mb-4">
                    Documentos Não Analisados ({analysisResults.documentsWithoutQuestions.length})
                  </h3>
                  <div className="bg-status-warning/10 border border-status-warning/30 rounded-lg p-4 mb-4">
                    <p className="text-sm text-text-secondary mb-3">
                      Os seguintes documentos foram selecionados para análise, mas não geraram perguntas válidas:
                    </p>
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {analysisResults.documentsWithoutQuestions.map((doc, index) => (
                        <div key={doc.documentId || index} className="bg-bg-secondary rounded-lg p-3 border border-border-default">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex-1">
                              <p className="text-text-primary font-medium text-sm mb-1" title={doc.title || doc.documentId}>
                                {doc.title || doc.documentId || `Documento ${index + 1}`}
                              </p>
                              <p className="text-status-warning text-xs font-medium">
                                {doc.reason}
                              </p>
                            </div>
                          </div>
                          <div className="mt-2 pt-2 border-t border-border-default text-xs text-text-tertiary space-y-1">
                            {doc.contentLength !== undefined && (
                              <div className="flex justify-between">
                                <span>Tamanho do conteúdo:</span>
                                <span>{doc.contentLength} caracteres</span>
                              </div>
                            )}
                            {doc.rawQuestionsCount !== undefined && (
                              <div className="flex justify-between">
                                <span>Perguntas geradas (antes da validação):</span>
                                <span>{doc.rawQuestionsCount}</span>
                              </div>
                            )}
                            {doc.hasContent !== undefined && (
                              <div className="flex justify-between">
                                <span>Tem conteúdo:</span>
                                <span className={doc.hasContent ? 'text-status-success' : 'text-status-error'}>
                                  {doc.hasContent ? 'Sim' : 'Não'}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {!analyzing && !analysisResults && (
            <div className="text-center py-8">
              <p className="text-text-secondary">Clique em "Analisar Documentos" para começar</p>
            </div>
          )}
        </div>
      </Dialog>

      {/* Modal de Aprendizado Adaptativo */}
      <Dialog
        isOpen={showLearningModal}
        onClose={() => {
          setShowLearningModal(false);
          setLearningData(null);
          setEditingSynonym(null);
          setEditingQuestion(null);
        }}
        title="🧠 Aprendizado Adaptativo"
        size="xl"
      >
        <div className="space-y-6">
          {loadingLearning ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-accent-primary border-t-transparent mb-4"></div>
              <p className="text-text-secondary">Carregando dados de aprendizado...</p>
            </div>
          ) : learningData ? (
            <>
              {/* Estatísticas Gerais */}
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6">
                <h3 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
                  <span>📊</span>
                  <span>Estatísticas de Aprendizado</span>
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-2xl font-bold text-text-primary">
                      {learningData.learningCycles?.total || learningData.metrics?.learningCycles || 0}
                    </div>
                    <div className="text-sm text-text-secondary">Ciclos de Aprendizado</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-status-success">
                      {learningData.metrics?.successfulQueries || learningData.successfulQueries || 0}
                    </div>
                    <div className="text-sm text-text-secondary">Queries Bem-sucedidas</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-status-error">
                      {learningData.metrics?.failedQueries || learningData.failedQueries || 0}
                    </div>
                    <div className="text-sm text-text-secondary">Queries Falhadas</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-text-primary">
                      {learningData.metrics?.successRate ? `${Math.round(learningData.metrics.successRate * 100)}%` : 
                       learningData.successRate ? `${Math.round(learningData.successRate * 100)}%` : '0%'}
                    </div>
                    <div className="text-sm text-text-secondary">Taxa de Sucesso</div>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-border-default grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <div className="text-lg font-semibold text-text-primary">
                      {learningData.synonyms ? Object.keys(learningData.synonyms).length : learningData.metrics?.synonymsCount || 0}
                    </div>
                    <div className="text-xs text-text-secondary">Sinônimos Aprendidos</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-text-primary">
                      {learningData.queryPatterns?.successful?.length || learningData.metrics?.successfulPatterns || 0}
                    </div>
                    <div className="text-xs text-text-secondary">Padrões Bem-sucedidos</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-text-primary">
                      {learningData.queryPatterns?.failed?.length || learningData.metrics?.failedPatterns || 0}
                    </div>
                    <div className="text-xs text-text-secondary">Padrões Falhados</div>
                  </div>
                </div>
                {(learningData.learningCycles?.lastCycle || learningData.metrics?.lastCycle) && (
                  <div className="mt-4 pt-4 border-t border-border-default">
                    <div className="text-sm text-text-secondary">
                      Último ciclo: {new Date(learningData.learningCycles?.lastCycle || learningData.metrics?.lastCycle).toLocaleString('pt-BR')}
                    </div>
                  </div>
                )}
              </div>

              {/* Sinônimos Aprendidos */}
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                    <span>📚</span>
                    <span>Sinônimos Aprendidos ({learningData.synonyms ? Object.keys(learningData.synonyms).length : 0})</span>
                  </h3>
                  <Button
                    onClick={async () => {
                      try {
                        const tenantId = agent?.tenantId || null;
                        if (!tenantId) return;
                        
                        const indexedDocs = documents.filter(doc => doc.indexed && doc.status === 'active');
                        await updateSynonymsFromDocuments(tenantId, indexedDocs);
                        await loadLearningData();
                        showToast('Sinônimos atualizados!', 'success');
                      } catch (error) {
                        logger.error('Erro ao atualizar sinônimos:', error);
                        showToast('Erro ao atualizar sinônimos', 'error');
                      }
                    }}
                    style={{
                      backgroundColor: 'var(--accent-primary)',
                      color: 'white',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    🔄 Atualizar
                  </Button>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {learningData.synonyms && Object.keys(learningData.synonyms).length > 0 ? (
                    Object.entries(learningData.synonyms).map(([term, synonyms]) => (
                      <div key={term} className="bg-bg-secondary rounded-lg p-3 flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-semibold text-text-primary mb-1">{term}</div>
                          <div className="flex flex-wrap gap-2">
                            {Array.isArray(synonyms) ? synonyms.map((syn, idx) => (
                              <span key={idx} className="px-2 py-1 bg-bg-tertiary text-text-secondary rounded text-xs">
                                {syn}
                              </span>
                            )) : (
                              <span className="px-2 py-1 bg-bg-tertiary text-text-secondary rounded text-xs">
                                {synonyms}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEditingSynonym({ term, synonyms: Array.isArray(synonyms) ? synonyms : [synonyms] })}
                            className="text-accent-primary hover:text-accent-hover"
                            title="Editar"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={async () => {
                              const confirmed = window.confirm(`Tem certeza que deseja remover o sinônimo "${term}"?`);
                              
                              if (!confirmed) return;
                              
                              try {
                                const tenantId = agent?.tenantId || null;
                                if (!tenantId) return;
                                
                                await deleteSynonym(tenantId, term);
                                await loadLearningData();
                                showToast('Sinônimo removido!', 'success');
                              } catch (error) {
                                logger.error('Erro ao remover sinônimo:', error);
                                showToast('Erro ao remover sinônimo', 'error');
                              }
                            }}
                            className="text-status-error hover:text-status-error/80"
                            title="Remover"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-text-secondary text-sm text-center py-4">
                      Nenhum sinônimo aprendido ainda. Execute uma análise de documentos para começar.
                    </p>
                  )}
                </div>
              </div>

              {/* Perguntas Bem-sucedidas */}
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                    <span>✅</span>
                    <span>Perguntas Bem-sucedidas ({learningData.queryPatterns?.successful?.length || 0})</span>
                  </h3>
                  {learningData.queryPatterns?.successful && learningData.queryPatterns.successful.length > 0 && (
                    <Button
                      onClick={async () => {
                        try {
                          const confirmed = window.confirm('Tem certeza que deseja remover todas as perguntas inválidas e duplicadas do histórico?');
                          if (!confirmed) return;
                          
                          const tenantId = agent?.tenantId || null;
                          if (!tenantId) return;
                          
                          const result = await cleanInvalidQueries(tenantId);
                          await loadLearningData();
                          const duplicates = (result.removedDuplicatesSuccessful || 0) + (result.removedDuplicatesFailed || 0);
                          const invalid = result.totalRemoved - duplicates;
                          let message = `${result.totalRemoved || 0} perguntas removidas`;
                          if (invalid > 0 && duplicates > 0) {
                            message += ` (${invalid} inválidas, ${duplicates} duplicadas)`;
                          } else if (invalid > 0) {
                            message += ` (${invalid} inválidas)`;
                          } else if (duplicates > 0) {
                            message += ` (${duplicates} duplicadas)`;
                          }
                          showToast(message, 'success');
                        } catch (error) {
                          logger.error('Erro ao limpar perguntas inválidas:', error);
                          showToast('Erro ao limpar perguntas inválidas', 'error');
                        }
                      }}
                      style={{
                        backgroundColor: 'var(--status-warning)',
                        color: 'white',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      🧹 Limpar Inválidas
                    </Button>
                  )}
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {learningData.queryPatterns?.successful && learningData.queryPatterns.successful.length > 0 ? (
                    learningData.queryPatterns.successful.slice(-10).reverse().map((pattern, idx) => (
                      <div key={idx} className="bg-status-success/10 rounded-lg p-3 border border-status-success/30">
                        <div className="font-medium text-text-primary mb-1">{pattern.query}</div>
                        <div className="flex gap-4 text-xs text-text-secondary">
                          <span>Confiança: {Math.round((pattern.confidence || 0) * 100)}%</span>
                          <span>Chunks: {pattern.chunksFound || 0}</span>
                          {pattern.timestamp && (
                            <span>{new Date(pattern.timestamp).toLocaleDateString('pt-BR')}</span>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-text-secondary text-sm text-center py-4">
                      Nenhuma pergunta bem-sucedida registrada ainda.
                    </p>
                  )}
                </div>
              </div>

              {/* Perguntas Falhadas */}
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                    <span>❌</span>
                    <span>Perguntas Falhadas ({learningData.queryPatterns?.failed?.length || 0})</span>
                  </h3>
                  {learningData.queryPatterns?.failed && learningData.queryPatterns.failed.length > 0 && (
                    <Button
                      onClick={async () => {
                        try {
                          const confirmed = window.confirm('Tem certeza que deseja remover todas as perguntas inválidas do histórico?');
                          if (!confirmed) return;
                          
                          const tenantId = agent?.tenantId || null;
                          if (!tenantId) return;
                          
                          const result = await cleanInvalidQueries(tenantId);
                          await loadLearningData();
                          const duplicates = (result.removedDuplicatesSuccessful || 0) + (result.removedDuplicatesFailed || 0);
                          const invalid = result.totalRemoved - duplicates;
                          let message = `${result.totalRemoved || 0} perguntas removidas`;
                          if (invalid > 0 && duplicates > 0) {
                            message += ` (${invalid} inválidas, ${duplicates} duplicadas)`;
                          } else if (invalid > 0) {
                            message += ` (${invalid} inválidas)`;
                          } else if (duplicates > 0) {
                            message += ` (${duplicates} duplicadas)`;
                          }
                          showToast(message, 'success');
                        } catch (error) {
                          logger.error('Erro ao limpar perguntas inválidas:', error);
                          showToast('Erro ao limpar perguntas inválidas', 'error');
                        }
                      }}
                      style={{
                        backgroundColor: 'var(--status-warning)',
                        color: 'white',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      🧹 Limpar Inválidas
                    </Button>
                  )}
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {learningData.queryPatterns?.failed && learningData.queryPatterns.failed.length > 0 ? (
                    learningData.queryPatterns.failed.slice(-10).reverse().map((pattern, idx) => (
                      <div key={idx} className="bg-status-error/10 rounded-lg p-3 border border-status-error/30">
                        <div className="font-medium text-text-primary mb-1">{pattern.query}</div>
                        <div className="flex gap-4 text-xs text-text-secondary">
                          <span>Chunks: {pattern.chunksFound || 0}</span>
                          {pattern.timestamp && (
                            <span>{new Date(pattern.timestamp).toLocaleDateString('pt-BR')}</span>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-text-secondary text-sm text-center py-4">
                      Nenhuma pergunta falhada registrada.
                    </p>
                  )}
                </div>
              </div>

              {/* Configurações Otimizadas */}
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                    <span>⚙️</span>
                    <span>Configurações Otimizadas</span>
                  </h3>
                  <Button
                    onClick={async () => {
                      try {
                        const tenantId = agent?.tenantId || null;
                        if (!tenantId) return;
                        
                        await triggerLearning(tenantId);
                        await loadLearningData();
                        showToast('Aprendizado disparado! Configurações otimizadas.', 'success');
                      } catch (error) {
                        logger.error('Erro ao disparar aprendizado:', error);
                        showToast('Erro ao disparar aprendizado', 'error');
                      }
                    }}
                    style={{
                      backgroundColor: 'var(--accent-primary)',
                      color: 'white',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    🔄 Otimizar Agora
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-sm text-text-secondary mb-1">minScore</div>
                    <div className="text-lg font-semibold text-text-primary">
                      {learningData.config?.minScore || learningData.metrics?.config?.minScore || 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-text-secondary mb-1">topK</div>
                    <div className="text-lg font-semibold text-text-primary">
                      {learningData.config?.topK || learningData.metrics?.config?.topK || 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-text-secondary mb-1">chunkOverlap</div>
                    <div className="text-lg font-semibold text-text-primary">
                      {learningData.config?.chunkOverlap || learningData.metrics?.config?.chunkOverlap || 'N/A'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Histórico de Ciclos */}
              {learningData.learningCycles?.cycles && learningData.learningCycles.cycles.length > 0 && (
                <div className="bg-bg-elevated rounded-xl border border-border-default p-6">
                  <h3 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
                    <span>🔄</span>
                    <span>Histórico de Ciclos (últimos {Math.min(10, learningData.learningCycles.cycles.length)})</span>
                  </h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {learningData.learningCycles.cycles.slice(-10).reverse().map((cycle, idx) => (
                      <div key={idx} className="bg-bg-secondary rounded-lg p-3 border border-border-default">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="font-semibold text-text-primary">
                              Ciclo #{cycle.cycle} - {cycle.type === 'synonym_update' ? 'Atualização de Sinônimos' : 'Otimização de Config'}
                            </div>
                            <div className="text-xs text-text-secondary mt-1">
                              {new Date(cycle.timestamp).toLocaleString('pt-BR')}
                            </div>
                          </div>
                        </div>
                        {cycle.type === 'synonym_update' && (
                          <div className="text-sm text-text-secondary">
                            Sinônimos adicionados: {cycle.synonymsAdded || 0} | Total: {cycle.totalSynonyms || 0}
                          </div>
                        )}
                        {cycle.type === 'config_optimization' && cycle.newConfig && (
                          <div className="text-sm text-text-secondary space-y-1">
                            <div>minScore: {cycle.previousConfig?.minScore || 'N/A'} → {cycle.newConfig.minScore}</div>
                            <div>topK: {cycle.previousConfig?.topK || 'N/A'} → {cycle.newConfig.topK}</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Status */}
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6">
                <h3 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
                  <span>📈</span>
                  <span>Status do Aprendizado</span>
                </h3>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded text-sm font-medium ${
                    (learningData.metrics?.status || learningData.status) === 'good' 
                      ? 'bg-status-success/20 text-status-success' 
                      : (learningData.metrics?.status || learningData.status) === 'needs_improvement'
                      ? 'bg-status-warning/20 text-status-warning'
                      : 'bg-status-error/20 text-status-error'
                  }`}>
                    {(learningData.metrics?.status || learningData.status) === 'good' ? '✅ Bom' : 
                     (learningData.metrics?.status || learningData.status) === 'needs_improvement' ? '⚠️ Precisa Melhorar' : 
                     '❌ Ruim'}
                  </span>
                  {(learningData.metrics?.avgConfidence || learningData.avgConfidence) > 0 && (
                    <span className="text-text-secondary text-sm">
                      Confiança média: {Math.round((learningData.metrics?.avgConfidence || learningData.avgConfidence) * 100)}%
                    </span>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-8">
              <p className="text-text-secondary">Nenhum dado de aprendizado disponível ainda.</p>
              <p className="text-text-tertiary text-sm mt-2">
                Execute análises de documentos para começar o aprendizado.
              </p>
            </div>
          )}
        </div>
      </Dialog>

      {/* Modal de Edição de Sinônimo */}
      {editingSynonym && (
        <Dialog
          isOpen={!!editingSynonym}
          onClose={() => setEditingSynonym(null)}
          title="Editar Sinônimos"
          size="md"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Termo Principal
              </label>
              <input
                type="text"
                value={editingSynonym.term}
                readOnly
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Sinônimos (um por linha)
              </label>
              <textarea
                value={editingSynonym.synonyms.join('\n')}
                onChange={(e) => setEditingSynonym({
                  ...editingSynonym,
                  synonyms: e.target.value.split('\n').filter(s => s.trim())
                })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
                rows={6}
                placeholder="Digite um sinônimo por linha"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                onClick={() => setEditingSynonym(null)}
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-default)',
                  cursor: 'pointer',
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={async () => {
                  try {
                    const tenantId = agent?.tenantId || null;
                    if (!tenantId) return;
                    
                    await updateSynonym(tenantId, editingSynonym.term, editingSynonym.synonyms);
                    await loadLearningData();
                    setEditingSynonym(null);
                    showToast('Sinônimos atualizados!', 'success');
                  } catch (error) {
                    logger.error('Erro ao atualizar sinônimos:', error);
                    showToast('Erro ao atualizar sinônimos', 'error');
                  }
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
                Salvar
              </Button>
              <Button
                onClick={async () => {
                  try {
                    const confirmed = window.confirm(`Tem certeza que deseja remover o sinônimo "${editingSynonym.term}"?`);
                    
                    if (!confirmed) return;
                    
                    const tenantId = agent?.tenantId || null;
                    if (!tenantId) return;
                    
                    await deleteSynonym(tenantId, editingSynonym.term);
                    await loadLearningData();
                    setEditingSynonym(null);
                    showToast('Sinônimo removido!', 'success');
                  } catch (error) {
                    logger.error('Erro ao remover sinônimo:', error);
                    showToast('Erro ao remover sinônimo', 'error');
                  }
                }}
                style={{
                  backgroundColor: 'var(--status-error)',
                  color: 'white',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                🗑️ Remover
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
