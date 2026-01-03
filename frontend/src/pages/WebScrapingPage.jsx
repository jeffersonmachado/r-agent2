import React, { useState, useEffect } from 'react';
import { scrapeUrl, scrapeUrls } from '../api/webScraping';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import logger from '../utils/logger';

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

  const [url, setUrl] = useState('');
  const [urls, setUrls] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [mode, setMode] = useState('single'); // 'single' ou 'batch'
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

  const handleScrape = async () => {
    if (mode === 'single') {
      if (!url.trim()) {
        showToast('Digite uma URL', 'error');
        return;
      }

      setLoading(true);
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

        showToast(`URL raspada com sucesso! ${result.indexed ? `${result.chunksCreated} chunks criados.` : ''}`, 'success');
        setResults([result]);
        setUrl('');
      } catch (error) {
        logger.error('Erro ao raspar URL:', error);
        showToast(`Erro ao raspar URL: ${error.message}`, 'error');
      } finally {
        setLoading(false);
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
      try {
        const tagsArray = options.tags.split(',').map(t => t.trim()).filter(Boolean);
        const removeSelectorsArray = options.removeSelectors.split(',').map(s => s.trim()).filter(Boolean);
        
        const response = await scrapeUrls({
          urls: urlList,
          contentSelector: options.contentSelector || undefined,
          removeSelectors: removeSelectorsArray.length > 0 ? removeSelectorsArray : undefined,
          timeout: options.timeout,
          concurrency: options.concurrency,
          autoIndex: options.autoIndex,
          source: options.source,
          category: options.category || undefined,
          tags: tagsArray,
        });

        const successCount = response.results.filter(r => r.success).length;
        const failCount = response.results.length - successCount;
        
        showToast(
          `Raspagem concluída! ${successCount} sucesso, ${failCount} falhas.`,
          successCount > 0 ? 'success' : 'error'
        );
        setResults(response.results);
        setUrls('');
      } catch (error) {
        logger.error('Erro ao raspar URLs:', error);
        showToast(`Erro ao raspar URLs: ${error.message}`, 'error');
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>Raspagem de Sites</h1>
        </div>
        <p className="text-text-secondary" style={{ marginBottom: '20px' }}>
          Extraia conteúdo de sites e indexe automaticamente no RAG
        </p>
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

      {/* Resultados */}
      {results.length > 0 && (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <h3 className="text-xl font-semibold text-text-primary mb-6">
            Resultados ({results.length})
          </h3>
          <div className="space-y-4">
            {results.map((result, index) => (
              <div
                key={index}
                className={`p-4 rounded-lg border ${
                  result.success
                    ? 'bg-status-success/10 border-status-success/30'
                    : 'bg-status-error/10 border-status-error/30'
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-sm font-semibold ${
                        result.success ? 'text-status-success' : 'text-status-error'
                      }`}>
                        {result.success ? '✓ Sucesso' : '✗ Erro'}
                      </span>
                      {result.indexed && (
                        <span className="text-xs bg-accent-light text-accent-primary px-2 py-1 rounded">
                          Indexado ({result.chunksCreated} chunks)
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-text-secondary break-all">{result.url || 'URL desconhecida'}</p>
                    {result.title && (
                      <p className="text-sm font-medium text-text-primary mt-2">{result.title}</p>
                    )}
                    {result.content && (
                      <p className="text-xs text-text-tertiary mt-2 line-clamp-2">
                        {result.content}
                      </p>
                    )}
                    {result.contentLength && (
                      <p className="text-xs text-text-tertiary mt-1">
                        {result.contentLength} caracteres extraídos
                      </p>
                    )}
                    {result.error && (
                      <p className="text-sm text-status-error mt-2">{result.error}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ToastContainer />
    </div>
  );
}












