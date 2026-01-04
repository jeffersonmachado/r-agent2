import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { Input, Textarea } from '../styles/Input';
import { validateFlowRpaPayload } from '../utils/flowRpaValidator';
import { generateFlowWithOrchestrator } from '../api/flows';
import { uploadDocument } from '../api/ragDocuments';
import logger from '../utils/logger';

/**
 * Página oficial e única para geração de fluxo e teste RPA por IA.
 * Esta é a fonte da verdade das decisões humanas.
 * 
 * Funcionalidades:
 * - Interface completa para configurar geração de fluxo e RPA
 * - Suporte ao modo Bootstrap (geração do zero com validação)
 * - Validação em tempo real do payload
 * - Execução real da geração via orquestrador
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
  const [uploadedDocuments, setUploadedDocuments] = useState([]);
  const [uploadingDocuments, setUploadingDocuments] = useState(false);

  // Seção 3: Geração de Teste RPA
  const [generateRpaTest, setGenerateRpaTest] = useState(false);
  const [rpaMode, setRpaMode] = useState('infer');

  // Seção 4: Modo Bootstrap (Gerar tudo do zero)
  const [bootstrap, setBootstrap] = useState(false);

  // Validação e payload
  const [validationErrors, setValidationErrors] = useState({});
  const [payload, setPayload] = useState({});

  // Estados para geração
  const [generating, setGenerating] = useState(false);
  const [generationResult, setGenerationResult] = useState(null);
  const [generationError, setGenerationError] = useState(null);

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
      ragSources: effectiveRagSources.length > 0 ? effectiveRagSources : undefined,
      useWebScraping,
      scrapingTargets: useWebScraping ? scrapingTargets.filter(url => url.trim()) : undefined,
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

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setUploadingDocuments(true);
    const newDocuments = [];

    try {
      for (const file of files) {
        try {
          const result = await uploadDocument(file, {
            metadata: {
              source: 'flow_generator_upload',
            },
            autoIndex: true,
          });
          
          newDocuments.push({
            id: result.id,
            title: result.title,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
          });
          
          showToast(`Documento "${file.name}" carregado com sucesso!`, 'success');
        } catch (error) {
          logger.error('Erro ao fazer upload de documento', error);
          showToast(`Erro ao carregar "${file.name}": ${error.message}`, 'error');
        }
      }

      setUploadedDocuments([...uploadedDocuments, ...newDocuments]);
      
      // Ativa RAG automaticamente se documentos foram carregados
      if (newDocuments.length > 0 && !useRag) {
        setUseRag(true);
        if (!ragSources.includes('docs')) {
          setRagSources([...ragSources, 'docs']);
        }
      }
    } finally {
      setUploadingDocuments(false);
      // Limpa o input
      event.target.value = '';
    }
  };

  const removeUploadedDocument = (documentId) => {
    setUploadedDocuments(uploadedDocuments.filter(doc => doc.id !== documentId));
  };

  const handleSubmit = async () => {
    if (!isValid) {
      showToast('Por favor, preencha todos os campos obrigatórios corretamente', 'error');
      return;
    }

    try {
      setGenerating(true);
      setGenerationError(null);
      setGenerationResult(null);

      if (bootstrap) {
        showToast('Iniciando geração em modo Bootstrap... Isso pode levar alguns minutos.', 'info');
      } else {
        showToast('Gerando fluxo e teste RPA...', 'info');
      }

      // Chama o orquestrador com o payload completo
      const result = await generateFlowWithOrchestrator(payload);

      setGenerationResult(result);

      if (result.success) {
        if (bootstrap && result.validation?.bootstrap?.success) {
          showToast('✅ Bootstrap concluído com sucesso! Fluxo, seed e RPA foram gerados e validados.', 'success', 5000);
        } else if (bootstrap) {
          showToast('⚠️ Bootstrap executado, mas a validação RPA falhou. Nada foi persistido.', 'warning', 5000);
        } else {
          showToast('✅ Fluxo e teste RPA gerados com sucesso!', 'success', 5000);
        }
      } else {
        throw new Error(result.error || 'Erro desconhecido na geração');
      }

    } catch (error) {
      logger.error('Erro ao gerar fluxo', error);
      setGenerationError(error.message || 'Erro ao gerar fluxo e teste RPA. Tente novamente.');
      
      if (bootstrap) {
        showToast(`❌ Erro no Bootstrap: ${error.message}. Nada foi persistido.`, 'error', 5000);
      } else {
        showToast(`❌ Erro: ${error.message}`, 'error', 5000);
      }
    } finally {
      setGenerating(false);
    }
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
          <h1>🚀 Flow & RPA Generator</h1>
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

                  {/* Upload de Documentos */}
                  <div className="mt-4 pt-4 border-t border-border-default">
                    <div className="text-xs text-text-tertiary mb-2">
                      Upload de documentos:
                    </div>
                    <div className="space-y-2">
                      <label className="flex items-center justify-center w-full p-3 border-2 border-dashed border-border-default rounded-lg cursor-pointer hover:border-accent-primary transition-colors">
                        <input
                          type="file"
                          multiple
                          accept=".txt,.md,.json,.csv,.pdf,.doc,.docx"
                          onChange={handleFileUpload}
                          disabled={uploadingDocuments || bootstrap}
                          className="hidden"
                        />
                        <div className="text-center">
                          <div className="text-sm text-text-primary">
                            {uploadingDocuments ? '📤 Carregando...' : '📄 Clique para fazer upload de documentos'}
                          </div>
                          <div className="text-xs text-text-tertiary mt-1">
                            Formatos: TXT, MD, JSON, CSV, PDF, DOC, DOCX
                          </div>
                        </div>
                      </label>

                      {uploadedDocuments.length > 0 && (
                        <div className="space-y-1 mt-2">
                          {uploadedDocuments.map((doc) => (
                            <div key={doc.id} className="flex items-center justify-between p-2 bg-bg-primary rounded border border-border-default text-xs">
                              <div className="flex items-center space-x-2 flex-1 min-w-0">
                                <span>📄</span>
                                <span className="text-text-primary truncate">{doc.fileName}</span>
                                <span className="text-text-tertiary">
                                  ({(doc.fileSize / 1024).toFixed(1)} KB)
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeUploadedDocument(doc.id)}
                                className="ml-2 px-2 py-1 text-status-error hover:bg-status-error/10 rounded transition-colors"
                                disabled={bootstrap}
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Opção B: Fontes Externas (Raspagem de Sites) */}
            <div className="space-y-3">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useWebScraping}
                  onChange={(e) => {
                    setUseWebScraping(e.target.checked);
                    if (!e.target.checked) {
                      setScrapingTargets(['']);
                    } else if (scrapingTargets.length === 0) {
                      setScrapingTargets(['']);
                    }
                  }}
                  className="rounded border-border-default w-4 h-4"
                />
                <span className="text-sm font-medium text-text-primary">
                  Usar fontes externas (Raspagem de sites)
                  {bootstrap && <span className="text-xs text-text-tertiary ml-2">(obrigatório no modo Bootstrap)</span>}
                </span>
              </label>
              
              {useWebScraping && (
                <div className="ml-6 space-y-2 p-4 bg-bg-secondary rounded-lg border border-border-default">
                  <div className="text-xs text-text-tertiary mb-2">
                    URLs de sites para raspagem:
                  </div>
                  <div className="space-y-2">
                    {scrapingTargets.map((url, index) => (
                      <div key={index} className="flex gap-2 items-start">
                        <div className="flex-1">
                          <Input
                            type="url"
                            value={url}
                            onChange={(e) => handleScrapingTargetChange(index, e.target.value)}
                            placeholder="https://exemplo.com/documentacao"
                            className="w-full font-mono text-xs"
                            disabled={generating}
                          />
                          {url.trim() && !validateUrl(url) && (
                            <p className="text-xs text-status-error mt-1">
                              URL inválida. Use formato: https://exemplo.com
                            </p>
                          )}
                          {url.trim() && validateUrl(url) && (
                            <p className="text-xs text-status-success mt-1">
                              ✓ URL válida
                            </p>
                          )}
                        </div>
                        {scrapingTargets.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeScrapingTarget(index)}
                            disabled={generating}
                            className="px-3 py-2 text-xs text-status-error hover:bg-status-error/10 rounded transition-colors"
                          >
                            Remover
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  
                  <button
                    type="button"
                    onClick={addScrapingTarget}
                    disabled={generating}
                    className="text-sm text-accent-primary hover:text-accent-hover transition-colors flex items-center gap-1"
                  >
                    <span>+</span>
                    <span>Adicionar mais uma URL</span>
                  </button>
                  
                  {useWebScraping && scrapingTargets.filter(url => validateUrl(url)).length === 0 && (
                    <p className="text-xs text-status-error mt-2">
                      {bootstrap 
                        ? '⚠️ No modo Bootstrap, pelo menos uma URL válida é obrigatória'
                        : '⚠️ Adicione pelo menos uma URL válida para raspagem'
                      }
                    </p>
                  )}
                  
                  {useWebScraping && scrapingTargets.filter(url => validateUrl(url)).length > 0 && (
                    <div className="text-xs text-status-success bg-status-success/10 p-2 rounded mt-2">
                      ✓ {scrapingTargets.filter(url => validateUrl(url)).length} URL(s) válida(s) configurada(s)
                    </div>
                  )}
                  
                  <div className="text-xs text-status-warning bg-status-warning/10 p-2 rounded mt-2">
                    ⚠️ <strong>Atenção:</strong> Raspagem de sites requer aprovação e será auditada.
                    Certifique-se de ter permissão para acessar os sites informados.
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
            disabled={!isValid || generating}
            title={!isValid ? 'Preencha todos os campos obrigatórios' : generating ? 'Gerando...' : 'Gerar fluxo e teste RPA'}
          >
            {generating 
              ? (bootstrap ? '🔄 Executando Bootstrap...' : '🔄 Gerando...') 
              : (isValid 
                  ? (bootstrap ? '🚀 Executar Bootstrap' : '✅ Gerar Fluxo e RPA')
                  : '⚠️ Preencha os campos obrigatórios'
                )
            }
          </Button>
        </div>

        {/* Resultado da Geração */}
        {generationResult && (
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <h2 className="text-xl font-semibold text-text-primary mb-4">
              Resultado da Geração
            </h2>
            
            <div className="space-y-4">
              {generationResult.flowDefinition && (
                <div className="p-4 bg-bg-secondary rounded-lg">
                  <div className="text-sm font-medium text-text-primary mb-2">
                    ✅ Fluxo Gerado
                  </div>
                  <div className="text-xs text-text-secondary space-y-1">
                    <div><strong>ID:</strong> {generationResult.flowDefinition.id}</div>
                    <div><strong>Nome:</strong> {generationResult.flowDefinition.name}</div>
                    <div><strong>Nós:</strong> {generationResult.flowDefinition.nodes?.length || 0}</div>
                  </div>
                </div>
              )}

              {generationResult.rpaTest && (
                <div className="p-4 bg-bg-secondary rounded-lg">
                  <div className="text-sm font-medium text-text-primary mb-2">
                    ✅ Teste RPA Gerado
                  </div>
                  <div className="text-xs text-text-secondary space-y-1">
                    <div><strong>ID:</strong> {generationResult.rpaTest.id}</div>
                    <div><strong>Passos:</strong> {generationResult.rpaTest.steps?.length || 0}</div>
                    <div><strong>Asserts:</strong> {generationResult.rpaTest.asserts?.length || 0}</div>
                  </div>
                </div>
              )}

              {bootstrap && generationResult.validation?.bootstrap && (
                <div className={`p-4 rounded-lg ${
                  generationResult.validation.bootstrap.success 
                    ? 'bg-status-success/10 border border-status-success/20' 
                    : 'bg-status-error/10 border border-status-error/20'
                }`}>
                  <div className={`text-sm font-medium mb-2 ${
                    generationResult.validation.bootstrap.success 
                      ? 'text-status-success' 
                      : 'text-status-error'
                  }`}>
                    {generationResult.validation.bootstrap.success 
                      ? '✅ Validação Bootstrap: PASSOU' 
                      : '❌ Validação Bootstrap: FALHOU'
                    }
                  </div>
                  {generationResult.validation.bootstrap.error && (
                    <div className="text-xs text-text-secondary">
                      {generationResult.validation.bootstrap.error}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                {generationResult.flowDefinition && (
                  <Button
                    variant="secondary"
                    onClick={() => navigate(`/editor?flowId=${generationResult.flowDefinition.id}`)}
                  >
                    Abrir no Editor
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setGenerationResult(null);
                    setGenerationError(null);
                  }}
                >
                  Limpar Resultado
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Erro da Geração */}
        {generationError && (
          <div className="bg-bg-elevated rounded-xl border border-status-error/20 p-6 shadow-lg">
            <h2 className="text-xl font-semibold text-status-error mb-4">
              Erro na Geração
            </h2>
            <div className="p-4 bg-status-error/10 rounded-lg text-text-primary text-sm">
              {generationError}
            </div>
            <div className="mt-4">
              <Button
                variant="ghost"
                onClick={() => {
                  setGenerationError(null);
                }}
              >
                Fechar
              </Button>
            </div>
          </div>
        )}

        {/* Aviso importante */}
        <div className="bg-bg-tertiary rounded-lg border border-border-default p-4">
          <div className="text-sm text-text-secondary">
            <strong>ℹ️ Informação:</strong> Esta interface gera fluxos e testes RPA usando IA.
            {bootstrap && ' No modo Bootstrap, o sistema valida o RPA antes de persistir qualquer dado.'}
            {' O payload gerado também pode ser copiado e usado em outros sistemas.'}
          </div>
        </div>
      </div>

      <ToastContainer />
    </div>
  );
}

