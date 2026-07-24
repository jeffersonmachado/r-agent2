import React, { useState, useEffect, useRef } from 'react';
import { scrapeUrl, scrapeUrls } from '../api/webScraping';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { toastError, toastWarn } from '../utils/toastHelpers';
import { Button } from '../styles/Button';
import logger from '../utils/logger';
import { CrudPageBase } from '../modules/crud-base';

export function WebScrapingPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

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

  const [url, setUrl] = useState('');
  const [urls, setUrls] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [mode, setMode] = useState('single'); // 'single' ou 'batch'
  
  // Estado de progresso em tempo real
  const [progress, setProgress] = useState({
    total: 0,
    completed: 0,
    success: 0,
    failed: 0,
    current: null,
    startTime: null,
    elapsedTime: 0,
  });
  
  const [options, setOptions] = useState({
    autoIndex: true,
    source: 'web_scraping',
    category: '',
    tags: '',
    contentSelector: '',
    removeSelectors: 'nav, header, footer, .sidebar, .menu, .advertisement, .ads',
    timeout: 30000,
    concurrency: 3,
  });
  
  const progressIntervalRef = useRef(null);
  const startTimeRef = useRef(null);

  // Formata tempo em segundos para formato legível
  const formatTime = (seconds) => {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  };

  const formatDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('pt-BR');
  };

  // Atualiza tempo decorrido
  useEffect(() => {
    if (loading && startTimeRef.current) {
      progressIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setProgress(prev => ({ ...prev, elapsedTime: elapsed }));
      }, 1000);
    } else {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    }
    
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, [loading]);

  const handleScrape = async () => {
    if (mode === 'single') {
      if (!url.trim()) {
        showToast('Digite uma URL', 'error');
        return;
      }

      setLoading(true);
      setResults([]); // Limpa resultados anteriores
      setProgress({
        total: 1,
        completed: 0,
        success: 0,
        failed: 0,
        current: url.trim(),
        startTime: Date.now(),
        elapsedTime: 0,
      });
      startTimeRef.current = Date.now();
      
      try {
        const tagsArray = options.tags.split(',').map(t => t.trim()).filter(Boolean);
        const removeSelectorsArray = options.removeSelectors.split(',').map(s => s.trim()).filter(Boolean);
        
        const result = await scrapeUrl({
          url: url.trim(),
          contentSelector: options.contentSelector || undefined,
          removeSelectors: removeSelectorsArray.length > 0 ? removeSelectorsArray : undefined,
          timeout: options.timeout,
          autoIndex: options.autoIndex,
          source: options.source,
          category: options.category || undefined,
          tags: tagsArray,
        });

        setProgress(prev => ({
          ...prev,
          completed: 1,
          success: result.success ? 1 : 0,
          failed: result.success ? 0 : 1,
          current: null,
        }));

        showToast(`URL raspada com sucesso! ${result.indexed ? `${result.chunksCreated} chunks criados.` : ''}`, 'success');
        if (Array.isArray(result?.warnings) && result.warnings.length > 0) {
          toastWarn(
            showToast,
            'Extração parcial no web scraping',
            'Houve avisos durante a extração. Continuamos com o melhor conteúdo disponível.',
            { warnings: result.warnings, url: result.url }
          );
        }
        setResults([result]);
        setUrl('');
      } catch (error) {
        logger.error('Erro ao raspar URL:', error);
        setProgress(prev => ({
          ...prev,
          completed: 1,
          failed: 1,
          current: null,
        }));
        toastError(showToast, 'Erro ao raspar URL', error.message, { error });
        setResults([{
          success: false,
          url: url.trim(),
          error: error.message,
        }]);
      } finally {
        setLoading(false);
        startTimeRef.current = null;
      }
    } else {
      if (!urls.trim()) {
        showToast('Digite pelo menos uma URL', 'error');
        return;
      }

      const urlList = urls.split('\n').map(u => u.trim()).filter(Boolean);
      if (urlList.length === 0) {
        showToast('Digite pelo menos uma URL válida', 'error');
        return;
      }

      setLoading(true);
      setResults([]); // Limpa resultados anteriores
      setProgress({
        total: urlList.length,
        completed: 0,
        success: 0,
        failed: 0,
        current: null,
        startTime: Date.now(),
        elapsedTime: 0,
      });
      startTimeRef.current = Date.now();

      try {
        const tagsArray = options.tags.split(',').map(t => t.trim()).filter(Boolean);
        const removeSelectorsArray = options.removeSelectors.split(',').map(s => s.trim()).filter(Boolean);
        
        // Processa URLs em lotes para feedback em tempo real
        const allResults = [];
        const concurrency = options.concurrency || 3;
        
        for (let i = 0; i < urlList.length; i += concurrency) {
          const batch = urlList.slice(i, i + concurrency);
          
          // Atualiza URL atual sendo processada
          setProgress(prev => ({
            ...prev,
            current: batch[0] || null,
          }));
          
          const batchPromises = batch.map(async (url) => {
            try {
              const result = await scrapeUrl({
                url: url,
                contentSelector: options.contentSelector || undefined,
                removeSelectors: removeSelectorsArray.length > 0 ? removeSelectorsArray : undefined,
                timeout: options.timeout,
                autoIndex: options.autoIndex,
                source: options.source,
                category: options.category || undefined,
                tags: tagsArray,
              });
              
              return { success: true, ...result };
            } catch (error) {
              logger.error(`Erro ao raspar URL ${url}:`, error);
              return {
                success: false,
                url: url,
                error: error.message,
              };
            }
          });
          
          const batchResults = await Promise.all(batchPromises);
          allResults.push(...batchResults);
          
          // Atualiza progresso após cada lote
          const completed = allResults.length;
          const success = allResults.filter(r => r.success).length;
          const failed = completed - success;
          
          setProgress(prev => ({
            ...prev,
            completed,
            success,
            failed,
            current: i + concurrency < urlList.length ? urlList[i + concurrency] : null,
          }));
          
          // Atualiza resultados em tempo real
          setResults([...allResults]);
        }

        const successCount = allResults.filter(r => r.success).length;
        const failCount = allResults.length - successCount;
        
        setProgress(prev => ({
          ...prev,
          current: null,
        }));
        
        showToast(
          `Raspagem concluída! ${successCount} sucesso, ${failCount} falhas.`,
          successCount > 0 ? 'success' : 'error'
        );
        try {
          const allWarnings = allResults.flatMap(r => (Array.isArray(r?.warnings) ? r.warnings : []));
          if (allWarnings.length > 0) {
            toastWarn(
              showToast,
              'Extração parcial no web scraping',
              'Algumas URLs retornaram avisos durante a extração. Continuamos com o melhor conteúdo disponível.',
              { warnings: allWarnings.slice(0, 30) }
            );
          }
        } catch {
          // ignora
        }
        setUrls('');
      } catch (error) {
        logger.error('Erro ao raspar URLs:', error);
        toastError(showToast, 'Erro ao raspar URLs', error.message, { error });
        setProgress(prev => ({
          ...prev,
          current: null,
        }));
      } finally {
        setLoading(false);
        startTimeRef.current = null;
      }
    }
  };

  return (
    <CrudPageBase>
      <div className="support-header">
        <div className="page-header">
          <h1>🕷️ Raspagem de Sites</h1>
        </div>
        <p className="text-text-secondary" style={{ marginBottom: '20px' }}>
          Extraia conteúdo de sites e indexe automaticamente no RAG
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

      {/* Modo de raspagem */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setMode('single')}
            className={`px-4 py-2 rounded-lg transition-all ${
              mode === 'single'
                ? 'bg-accent-primary text-white'
                : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            URL Única
          </button>
          <button
            onClick={() => setMode('batch')}
            className={`px-4 py-2 rounded-lg transition-all ${
              mode === 'batch'
                ? 'bg-accent-primary text-white'
                : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            Múltiplas URLs
          </button>
        </div>

        {mode === 'single' ? (
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              URL *
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://exemplo.com/pagina"
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>
        ) : (
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              URLs (uma por linha) *
            </label>
            <textarea
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder="https://exemplo.com/pagina1&#10;https://exemplo.com/pagina2&#10;https://exemplo.com/pagina3"
              rows={6}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all resize-y font-mono text-sm"
            />
          </div>
        )}
      </div>

      {/* Botão de ação */}
      <div className="mb-6">
        <Button
          onClick={handleScrape}
          disabled={loading}
          style={{ backgroundColor: '#25D366', color: 'white' }}
        >
          {loading ? '⏳ Raspando...' : '🚀 Iniciar Raspagem'}
        </Button>
      </div>

      {/* Opções avançadas */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>⚙️</span>
          <span>Opções</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Categoria
            </label>
            <input
              type="text"
              value={options.category}
              onChange={(e) => setOptions({ ...options, category: e.target.value })}
              placeholder="Ex: Documentação, Blog, FAQ"
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Tags (separadas por vírgula)
            </label>
            <input
              type="text"
              value={options.tags}
              onChange={(e) => setOptions({ ...options, tags: e.target.value })}
              placeholder="Ex: scraping, web, documentação"
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Seletor de Conteúdo (CSS)
            </label>
            <input
              type="text"
              value={options.contentSelector}
              onChange={(e) => setOptions({ ...options, contentSelector: e.target.value })}
              placeholder="Ex: .content, #main, article"
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all font-mono text-sm"
            />
            <p className="text-xs text-text-tertiary mt-1">Deixe vazio para detecção automática</p>
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Seletores para Remover (separados por vírgula)
            </label>
            <input
              type="text"
              value={options.removeSelectors}
              onChange={(e) => setOptions({ ...options, removeSelectors: e.target.value })}
              placeholder="nav, header, footer, .sidebar"
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all font-mono text-sm"
            />
          </div>
          {mode === 'batch' && (
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">
                Concorrência
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={options.concurrency}
                onChange={(e) => setOptions({ ...options, concurrency: parseInt(e.target.value) || 3 })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
              />
              <p className="text-xs text-text-tertiary mt-1">Número de URLs processadas simultaneamente</p>
            </div>
          )}
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">
              Timeout (ms)
            </label>
            <input
              type="number"
              min="5000"
              max="120000"
              step="1000"
              value={options.timeout}
              onChange={(e) => setOptions({ ...options, timeout: parseInt(e.target.value) || 30000 })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
            />
          </div>
        </div>
        <div className="mt-4">
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={options.autoIndex}
              onChange={(e) => setOptions({ ...options, autoIndex: e.target.checked })}
              className="w-4 h-4"
            />
            Indexar automaticamente no RAG após raspar
          </label>
        </div>
      </div>

      {/* Mensagem de conclusão */}
      {!loading && progress.total > 0 && progress.completed === progress.total && results.length > 0 && (
        <div className="bg-status-success/10 border-2 border-status-success rounded-xl p-6 mb-6 shadow-lg transition-all duration-300">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full bg-status-success/20 flex items-center justify-center animate-pulse">
              <span className="text-status-success text-2xl">✓</span>
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-status-success mb-1">
                🎉 Raspagem Concluída!
              </h3>
              <p className="text-sm text-text-secondary">
                Todas as {progress.total} página{progress.total > 1 ? 's' : ''} foram processadas com sucesso
              </p>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-status-success/30">
            <div className="text-center">
              <div className="text-3xl font-bold text-status-success">
                {progress.success}
              </div>
              <div className="text-sm text-text-secondary mt-1">Sucessos</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-status-error">
                {progress.failed}
              </div>
              <div className="text-sm text-text-secondary mt-1">Falhas</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-accent-primary">
                {formatTime(progress.elapsedTime)}
              </div>
              <div className="text-sm text-text-secondary mt-1">Tempo Total</div>
            </div>
          </div>
          
          {results.some(r => r.indexed) && (
            <div className="mt-4 pt-4 border-t border-status-success/30">
              <div className="flex items-center justify-center gap-2 text-accent-primary">
                <span className="text-lg">📚</span>
                <span className="font-semibold">
                  {results.reduce((sum, r) => sum + (r.chunksCreated || 0), 0)} chunks criados e indexados no RAG
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Feedback de progresso em tempo real */}
      {loading && (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                <span className="animate-spin">⏳</span>
                <span>Processando Raspagem</span>
              </h3>
              {progress.startTime && (
                <span className="text-sm text-text-secondary">
                  {formatTime(progress.elapsedTime)}
                </span>
              )}
            </div>

            {/* Barra de progresso geral */}
            {progress.total > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-text-primary font-medium">
                    Progresso Geral
                  </span>
                  <span className="text-text-secondary">
                    {progress.completed} / {progress.total} URLs
                  </span>
                </div>
                <div className="w-full bg-bg-tertiary rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-accent-primary h-3 rounded-full transition-all duration-300 ease-out"
                    style={{
                      width: `${(progress.completed / progress.total) * 100}%`,
                    }}
                  />
                </div>
                <div className="flex gap-4 text-xs text-text-secondary">
                  <span className="flex items-center gap-1">
                    <span className="text-status-success">✓</span>
                    {progress.success} sucesso
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="text-status-error">✗</span>
                    {progress.failed} falhas
                  </span>
                  {progress.total > 0 && (
                    <span>
                      {Math.round((progress.completed / progress.total) * 100)}% concluído
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* URL atual sendo processada */}
            {progress.current && (
              <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                <div className="flex items-start gap-3">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-accent-primary border-t-transparent mt-0.5"></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary mb-1">
                      Processando URL atual:
                    </p>
                    <p className="text-xs text-text-secondary break-all font-mono">
                      {progress.current}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Estatísticas em tempo real */}
            {progress.total > 1 && (
              <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border-default">
                <div className="text-center">
                  <div className="text-2xl font-bold text-status-success">
                    {progress.success}
                  </div>
                  <div className="text-xs text-text-secondary mt-1">Sucessos</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-status-error">
                    {progress.failed}
                  </div>
                  <div className="text-xs text-text-secondary mt-1">Falhas</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-accent-primary">
                    {progress.total - progress.completed}
                  </div>
                  <div className="text-xs text-text-secondary mt-1">Pendentes</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Resultados */}
      {results.length > 0 && (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-semibold text-text-primary">
              Resultados ({results.length})
            </h3>
            {!loading && (
              <div className="flex gap-4 text-sm">
                <span className="flex items-center gap-1 text-status-success">
                  <span>✓</span>
                  <span>{results.filter(r => r.success).length} sucesso</span>
                </span>
                <span className="flex items-center gap-1 text-status-error">
                  <span>✗</span>
                  <span>{results.filter(r => !r.success).length} falhas</span>
                </span>
                {results.some(r => r.indexed) && (
                  <span className="flex items-center gap-1 text-accent-primary">
                    <span>📚</span>
                    <span>
                      {results.reduce((sum, r) => sum + (r.chunksCreated || 0), 0)} chunks
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>
          
          <div className="space-y-4">
            {results.map((result, index) => (
              <div
                key={index}
                className={`p-5 rounded-lg border transition-all duration-200 ${
                  result.success
                    ? 'bg-status-success/10 border-status-success/30 hover:bg-status-success/15'
                    : 'bg-status-error/10 border-status-error/30 hover:bg-status-error/15'
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Ícone de status */}
                  <div className="flex-shrink-0 mt-1">
                    {result.success ? (
                      <div className="w-8 h-8 rounded-full bg-status-success/20 flex items-center justify-center">
                        <span className="text-status-success text-lg">✓</span>
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-status-error/20 flex items-center justify-center">
                        <span className="text-status-error text-lg">✗</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Conteúdo */}
                  <div className="flex-1 min-w-0">
                    {/* Header com status e badges */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <span className={`text-sm font-semibold ${
                            result.success ? 'text-status-success' : 'text-status-error'
                          }`}>
                            {result.success ? 'Sucesso' : 'Erro'}
                          </span>
                          {result.indexed && (
                            <span className="text-xs bg-accent-light text-accent-primary px-2 py-1 rounded font-medium">
                              📚 Indexado ({result.chunksCreated || 0} chunks)
                            </span>
                          )}
                          {result.documentId && (
                            <span className="text-xs bg-bg-secondary text-text-secondary px-2 py-1 rounded font-mono">
                              ID: {result.documentId.substring(0, 8)}...
                            </span>
                          )}
                        </div>
                        
                        {/* URL */}
                        <p className="text-sm text-text-secondary break-all font-mono mb-2">
                          {result.url || 'URL desconhecida'}
                        </p>
                      </div>
                    </div>
                    
                    {/* Título */}
                    {result.title && (
                      <p className="text-base font-semibold text-text-primary mb-2">
                        {result.title}
                      </p>
                    )}
                    
                    {/* Descrição */}
                    {result.metadata?.description && (
                      <p className="text-sm text-text-secondary mb-2 line-clamp-2">
                        {result.metadata.description}
                      </p>
                    )}
                    
                    {/* Preview do conteúdo */}
                    {result.content && (
                      <div className="bg-bg-secondary rounded p-3 mb-2">
                        <p className="text-xs text-text-tertiary line-clamp-3">
                          {result.content}
                        </p>
                      </div>
                    )}
                    
                    {/* Estatísticas e metadados */}
                    <div className="flex flex-wrap gap-4 text-xs text-text-tertiary mt-3 pt-3 border-t border-border-default">
                      {result.contentLength && (
                        <span className="flex items-center gap-1">
                          <span>📄</span>
                          <span>{result.contentLength.toLocaleString('pt-BR')} caracteres</span>
                        </span>
                      )}
                      {result.metadata?.scrapedAt && (
                        <span className="flex items-center gap-1">
                          <span>🕐</span>
                          <span>
                            {formatDateTime(result.metadata.scrapedAt)}
                          </span>
                        </span>
                      )}
                      {result.metadata?.category && (
                        <span className="flex items-center gap-1">
                          <span>📁</span>
                          <span>{result.metadata.category}</span>
                        </span>
                      )}
                      {result.metadata?.tags && result.metadata.tags.length > 0 && (
                        <span className="flex items-center gap-1">
                          <span>🏷️</span>
                          <span>{result.metadata.tags.join(', ')}</span>
                        </span>
                      )}
                    </div>
                    
                    {/* Mensagem de erro */}
                    {result.error && (
                      <div className="mt-3 p-3 bg-status-error/10 border border-status-error/30 rounded">
                        <p className="text-sm text-status-error font-medium">Erro:</p>
                        <p className="text-xs text-status-error mt-1">
                          {typeof result.error === 'string'
                            ? result.error
                            : (result.error?.message || 'Erro desconhecido')}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ToastContainer />
    </CrudPageBase>
  );
}












