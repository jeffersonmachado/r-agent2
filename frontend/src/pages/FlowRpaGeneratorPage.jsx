import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { Input, Textarea } from '../styles/Input';
import { validateFlowRpaPayload } from '../utils/flowRpaValidator';

/**
 * Página oficial e única para geração de fluxo e teste RPA por IA.
 * Esta é a fonte da verdade das decisões humanas.
 * 
 * REGRAS ABSOLUTAS:
 * - NÃO conecta IA
 * - NÃO executa scraping
 * - NÃO chama backend produtivo
 * - Apenas UI + payload + validação
 */
export function FlowRpaGeneratorPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  // Seção 1: Dados do Fluxo
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Seção 2: Fonte de Conhecimento da IA
  const [useRag, setUseRag] = useState(false);
  const [ragSources, setRagSources] = useState([]);
  const [useWebScraping, setUseWebScraping] = useState(false);
  const [scrapingTargets, setScrapingTargets] = useState(['']);

  // Seção 3: Geração de Teste RPA
  const [generateRpaTest, setGenerateRpaTest] = useState(false);
  const [rpaMode, setRpaMode] = useState('infer');

  // Seção 4: Modo Bootstrap (Gerar tudo do zero)
  const [bootstrap, setBootstrap] = useState(false);

  // Validação e payload
  const [validationErrors, setValidationErrors] = useState({});
  const [payload, setPayload] = useState({});

  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  // Lógica automática do modo Bootstrap
  useEffect(() => {
    if (bootstrap) {
      // Força desativação de RAG
      setUseRag(false);
      setRagSources([]);
      // Força ativação de geração completa
      setGenerateRpaTest(true);
      // Scraping é recomendado mas ainda opcional
    }
  }, [bootstrap]);

  // Gera payload sempre que os dados mudarem
  useEffect(() => {
    // Se bootstrap está ativo, ajusta valores automaticamente
    const effectiveUseRag = bootstrap ? false : useRag;
    const effectiveRagSources = bootstrap ? [] : (useRag ? ragSources : []);
    const effectiveGenerateRpaTest = bootstrap ? true : generateRpaTest;

    const newPayload = {
      name: name.trim(),
      description: description.trim(),
      useRag: effectiveUseRag,
      ragSources: effectiveRagSources,
      useWebScraping,
      scrapingTargets: useWebScraping ? scrapingTargets.filter(url => url.trim()) : [],
      generateRpaTest: effectiveGenerateRpaTest,
      rpaMode: effectiveGenerateRpaTest ? rpaMode : undefined,
    };

    // Adiciona campos do modo Bootstrap se ativo
    if (bootstrap) {
      newPayload.bootstrap = true;
      newPayload.generate = {
        flow: true,
        seed: true,
        rpa: true,
      };
    }

    // Remove campos undefined
    Object.keys(newPayload).forEach(key => {
      if (newPayload[key] === undefined) {
        delete newPayload[key];
      }
    });

    setPayload(newPayload);
  }, [name, description, useRag, ragSources, useWebScraping, scrapingTargets, generateRpaTest, rpaMode, bootstrap]);

  // Validação em tempo real
  useEffect(() => {
    if (payload && Object.keys(payload).length > 0) {
      const validation = validateFlowRpaPayload(payload);
      setValidationErrors(validation.errors || {});
    } else {
      setValidationErrors({});
    }
  }, [payload]);

  // Verifica se o formulário é válido
  const isValid = useMemo(() => {
    if (!name.trim() || name.trim().length < 3) return false;
    if (!description.trim() || description.trim().length < 10) return false;
    
    // No modo bootstrap, scraping é obrigatório
    if (bootstrap) {
      if (!useWebScraping) return false;
      const validUrls = scrapingTargets.filter(url => {
        try {
          new URL(url.trim());
          return url.trim().length > 0;
        } catch {
          return false;
        }
      });
      if (validUrls.length === 0) return false;
      return true;
    }
    
    // Modo normal: pelo menos uma fonte de conhecimento deve estar ativa
    if (!useRag && !useWebScraping) return false;
    
    // Se RAG está ativo, pelo menos uma fonte deve ser selecionada
    if (useRag && ragSources.length === 0) return false;
    
    // Se scraping está ativo, pelo menos uma URL válida deve existir
    if (useWebScraping) {
      const validUrls = scrapingTargets.filter(url => {
        try {
          new URL(url.trim());
          return url.trim().length > 0;
        } catch {
          return false;
        }
      });
      if (validUrls.length === 0) return false;
    }

    return true;
  }, [name, description, useRag, ragSources, useWebScraping, scrapingTargets, bootstrap]);

  const handleRagSourceToggle = (source) => {
    if (ragSources.includes(source)) {
      setRagSources(ragSources.filter(s => s !== source));
    } else {
      setRagSources([...ragSources, source]);
    }
  };

  const handleScrapingTargetChange = (index, value) => {
    const newTargets = [...scrapingTargets];
    newTargets[index] = value;
    setScrapingTargets(newTargets);
  };

  const addScrapingTarget = () => {
    setScrapingTargets([...scrapingTargets, '']);
  };

  const removeScrapingTarget = (index) => {
    if (scrapingTargets.length > 1) {
      setScrapingTargets(scrapingTargets.filter((_, i) => i !== index));
    }
  };

  const validateUrl = (url) => {
    if (!url.trim()) return null;
    try {
      new URL(url.trim());
      return true;
    } catch {
      return false;
    }
  };

  const copyPayload = () => {
    if (!payload) return;
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    showToast('Payload copiado para a área de transferência!', 'success');
  };

  const handleSubmit = () => {
    if (!isValid) {
      showToast('Por favor, preencha todos os campos obrigatórios corretamente', 'error');
      return;
    }

    // NÃO executa nada - apenas mostra o payload
    showToast('Payload gerado! Use o botão "Copiar payload" para copiar.', 'info');
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
          <h1>Criar Fluxo / Gerar Teste RPA por IA</h1>
        </div>
        <p className="text-text-secondary" style={{ marginBottom: '20px' }}>
          Interface oficial para geração de fluxo e teste RPA. Esta é a fonte da verdade das decisões humanas.
        </p>
      </div>

      <div className="space-y-6">
        {/* Seção 1: Dados do Fluxo */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <h2 className="text-xl font-semibold text-text-primary mb-4">
            Dados do Fluxo
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">
                Nome do fluxo <span className="text-status-error">*</span>
              </label>
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Fluxo de Atendimento ao Cliente"
                className="w-full"
              />
              {name.trim() && name.trim().length < 3 && (
                <p className="text-xs text-status-error mt-1">
                  O nome deve ter pelo menos 3 caracteres
                </p>
              )}
            </div>

            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">
                Descrição funcional <span className="text-status-error">*</span>
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descreva o fluxo que deseja criar em linguagem natural..."
                rows={6}
                className="w-full"
              />
              {description.trim() && description.trim().length < 10 && (
                <p className="text-xs text-status-error mt-1">
                  A descrição deve ter pelo menos 10 caracteres
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Seção 2: Fonte de Conhecimento da IA */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <h2 className="text-xl font-semibold text-text-primary mb-4">
            Fonte de Conhecimento da IA
          </h2>
          
          <div className="space-y-6">
            {/* Opção A: Conhecimento Interno (RAG) */}
            <div className="space-y-3">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useRag}
                  onChange={(e) => {
                    if (!bootstrap) {
                      setUseRag(e.target.checked);
                      if (!e.target.checked) {
                        setRagSources([]);
                      }
                    }
                  }}
                  disabled={bootstrap}
                  className="rounded border-border-default w-4 h-4"
                />
                <span className="text-sm font-medium text-text-primary">
                  Usar conhecimento interno (RAG)
                  {bootstrap && <span className="text-xs text-text-tertiary ml-2">(desativado no modo Bootstrap)</span>}
                </span>
              </label>
              
              {useRag && (
                <div className="ml-6 space-y-2 p-4 bg-bg-secondary rounded-lg border border-border-default">
                  <div className="text-xs text-text-tertiary mb-2">
                    Selecione pelo menos uma fonte:
                  </div>
                  {[
                    { value: 'flows', label: 'Fluxos existentes' },
                    { value: 'qa', label: 'Base de QA' },
                    { value: 'docs', label: 'Documentação' },
                  ].map((source) => (
                    <label key={source.value} className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ragSources.includes(source.value)}
                        onChange={() => handleRagSourceToggle(source.value)}
                        className="rounded border-border-default w-4 h-4"
                      />
                      <span className="text-sm text-text-secondary">{source.label}</span>
                    </label>
                  ))}
                  {useRag && ragSources.length === 0 && (
                    <p className="text-xs text-status-error mt-2">
                      Selecione pelo menos uma fonte de conhecimento
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Opção B: Fontes Externas (Raspagem) */}
            <div className="space-y-3">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useWebScraping}
                  onChange={(e) => {
                    setUseWebScraping(e.target.checked);
                    if (!e.target.checked) {
                      setScrapingTargets(['']);
                    }
                  }}
                  className="rounded border-border-default w-4 h-4"
                />
                <span className="text-sm font-medium text-text-primary">
                  Usar fontes externas (Raspagem de sites)
                </span>
              </label>
              
              {useWebScraping && (
                <div className="ml-6 space-y-2 p-4 bg-bg-secondary rounded-lg border border-border-default">
                  <div className="text-xs text-text-tertiary mb-2">
                    URLs autorizadas:
                  </div>
                  {scrapingTargets.map((url, index) => (
                    <div key={index} className="flex gap-2 items-start">
                      <div className="flex-1">
                        <Input
                          type="url"
                          value={url}
                          onChange={(e) => handleScrapingTargetChange(index, e.target.value)}
                          placeholder="https://sistema-cliente.com/login"
                          className="w-full font-mono text-xs"
                        />
                        {url.trim() && !validateUrl(url) && (
                          <p className="text-xs text-status-error mt-1">
                            URL inválida
                          </p>
                        )}
                      </div>
                      {scrapingTargets.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeScrapingTarget(index)}
                          className="px-3 py-2 text-xs text-status-error hover:bg-status-error/10 rounded transition-colors"
                        >
                          Remover
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addScrapingTarget}
                    className="text-sm text-accent-primary hover:text-accent-hover transition-colors flex items-center gap-1"
                  >
                    <span>+</span>
                    <span>Adicionar URL</span>
                  </button>
                  {useWebScraping && scrapingTargets.filter(url => validateUrl(url)).length === 0 && (
                    <p className="text-xs text-status-error mt-2">
                      Adicione pelo menos uma URL válida
                    </p>
                  )}
                  <div className="text-xs text-status-warning bg-status-warning/10 p-2 rounded mt-2">
                    ⚠️ Raspagem de sites requer aprovação e será auditada.
                  </div>
                </div>
              )}
            </div>

            {/* Validação: pelo menos uma fonte deve estar ativa */}
            {!bootstrap && !useRag && !useWebScraping && (
              <div className="p-3 rounded-md bg-status-error/10 border border-status-error/20 text-status-error text-sm">
                ⚠️ Selecione pelo menos uma fonte de conhecimento (RAG ou Raspagem)
              </div>
            )}
            {bootstrap && !useWebScraping && (
              <div className="p-3 rounded-md bg-status-error/10 border border-status-error/20 text-status-error text-sm">
                ⚠️ No modo Bootstrap, pelo menos uma URL de scraping deve ser informada
              </div>
            )}
          </div>
        </div>

        {/* Seção 3: Modo Bootstrap (Gerar tudo do zero) */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <h2 className="text-xl font-semibold text-text-primary mb-4">
            Modo Bootstrap (Gerar tudo do zero)
          </h2>
          
          <div className="space-y-4">
            <label className="flex items-start space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={bootstrap}
                onChange={(e) => {
                  setBootstrap(e.target.checked);
                }}
                className="rounded border-border-default w-4 h-4 mt-1"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-text-primary block">
                  Gerar tudo do zero (Bootstrap)
                </span>
                <div className="mt-2 p-3 rounded-md bg-status-warning/10 border border-status-warning/20 text-status-warning text-xs">
                  ⚠️ <strong>Aviso obrigatório:</strong> Este modo cria a base do sistema.
                  Nada será salvo se o teste RPA falhar.
                </div>
              </div>
            </label>
            
            {bootstrap && (
              <div className="ml-6 space-y-2 p-4 bg-bg-secondary rounded-lg border border-border-default">
                <div className="text-xs text-text-tertiary mb-2">
                  No modo Bootstrap:
                </div>
                <ul className="text-xs text-text-secondary space-y-1 list-disc list-inside">
                  <li>RAG é automaticamente desativado</li>
                  <li>Fluxo base será gerado</li>
                  <li>Seed base será gerado</li>
                  <li>Teste RPA base será gerado e validado</li>
                  <li>Scraping é recomendado (pelo menos uma URL obrigatória)</li>
                  <li>Nada será persistido antes do RPA passar</li>
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Seção 4: Geração de Teste RPA */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <h2 className="text-xl font-semibold text-text-primary mb-4">
            Geração de Teste RPA
          </h2>
          
          <div className="space-y-4">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={bootstrap ? true : generateRpaTest}
                onChange={(e) => {
                  if (!bootstrap) {
                    setGenerateRpaTest(e.target.checked);
                    if (!e.target.checked) {
                      setRpaMode('infer');
                    }
                  }
                }}
                disabled={bootstrap}
                className="rounded border-border-default w-4 h-4"
              />
              <span className="text-sm font-medium text-text-primary">
                Gerar teste RPA automaticamente
                {bootstrap && <span className="text-xs text-text-tertiary ml-2">(obrigatório no modo Bootstrap)</span>}
              </span>
            </label>
            
            {(bootstrap || generateRpaTest) && (
              <div className="ml-6 space-y-2">
                <label className="block text-sm font-medium text-text-primary">
                  Modo:
                </label>
                <div className="space-y-2">
                  {[
                    { value: 'infer', label: 'Inferido pela IA' },
                    { value: 'record', label: 'Gravação assistida' },
                    { value: 'hybrid', label: 'Híbrido' },
                  ].map((mode) => (
                    <label key={mode.value} className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="radio"
                        name="rpaMode"
                        value={mode.value}
                        checked={rpaMode === mode.value}
                        onChange={(e) => setRpaMode(e.target.value)}
                        className="rounded border-border-default"
                      />
                      <span className="text-sm text-text-secondary">{mode.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Payload Gerado */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-text-primary">
              Payload gerado (somente leitura)
            </h2>
            <Button
              variant="secondary"
              onClick={copyPayload}
              disabled={!payload}
            >
              📋 Copiar payload
            </Button>
          </div>
          
          <div className="bg-bg-secondary rounded-lg border border-border-default p-4 max-h-96 overflow-y-auto">
            <pre className="text-xs text-text-primary font-mono whitespace-pre-wrap">
              {payload && Object.keys(payload).length > 0 ? JSON.stringify(payload, null, 2) : 'Preencha o formulário para gerar o payload...'}
            </pre>
          </div>

          {/* Mensagens de validação */}
          {Object.keys(validationErrors).length > 0 && (
            <div className="mt-4 p-3 rounded-md bg-status-error/10 border border-status-error/20 text-status-error text-sm">
              <strong>Erros de validação:</strong>
              <ul className="list-disc list-inside mt-2 space-y-1">
                {Object.entries(validationErrors).map(([field, error]) => (
                  <li key={field}>
                    <strong>{field}:</strong> {error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Botão de Submit */}
        <div className="flex justify-end gap-3">
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={true}
            title="Este botão está desabilitado. Esta interface é apenas para visualização e validação do payload."
          >
            {isValid ? '✅ Payload válido (apenas visualização)' : '⚠️ Preencha os campos obrigatórios'}
          </Button>
        </div>

        {/* Aviso importante */}
        <div className="bg-bg-tertiary rounded-lg border border-border-default p-4">
          <div className="text-sm text-text-secondary">
            <strong>⚠️ Importante:</strong> Esta interface é apenas para visualização e validação do payload.
            Nenhuma ação real será executada (sem chamadas de IA, scraping ou backend).
            O payload gerado pode ser copiado e usado em outros sistemas.
          </div>
        </div>
      </div>

      <ToastContainer />
    </div>
  );
}

