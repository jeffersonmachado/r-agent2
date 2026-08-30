import React, { useEffect, useMemo, useState } from 'react';
import { generateFlowFromDescription, previewFlowGenerationPrompt } from '../api/flows';
import { fetchJson } from '../api/client';
import { getTenantId } from '../api/auth';
import { Button } from '../styles/Button';
import { Input } from '../styles/Input';
import { Dialog } from './Dialog';
import logger from '../utils/logger';
import { loadFlowGenerationPrefs, saveFlowGenerationPrefs } from '../utils/flowGenerationPreferences.js';
import { useAuth } from '../context/authContext';
import { getAgentClassification } from '../utils/classification';

function parsePromptIndicatorFromFinalPrompt(finalPrompt) {
  const raw = String(finalPrompt || '');
  if (!raw) return null;
  const idx = raw.indexOf('## Indicador de Prompt');
  if (idx < 0) return null;

  const after = raw.slice(idx);
  // Bloco termina no primeiro parágrafo em branco após o header.
  const end = after.search(/\n\s*\n/);
  const block = (end >= 0 ? after.slice(0, end) : after).trim();
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  const kv = {};
  for (const line of lines.slice(1)) {
    // Aceita "key=value" e linhas “marker” (ex.: PROMPT_SUMMARY_MODE=1).
    if (!line.includes('=')) continue;
    const [k, ...rest] = line.split('=');
    const key = String(k || '').trim();
    const val = rest.join('=').trim();
    if (!key) continue;
    kv[key] = val;
  }

  const summarized = String(kv.summarized || '').toLowerCase() === 'true';
  const reason = kv.reason ? String(kv.reason) : null;
  const promptChars = kv.promptChars ? Number(kv.promptChars) : null;
  const originalPromptChars = kv.originalPromptChars ? Number(kv.originalPromptChars) : null;
  const summarizedPromptChars = kv.summarizedPromptChars ? Number(kv.summarizedPromptChars) : null;

  return {
    summarized,
    reason,
    promptChars: Number.isFinite(promptChars) ? promptChars : null,
    originalPromptChars: Number.isFinite(originalPromptChars) ? originalPromptChars : null,
    summarizedPromptChars: Number.isFinite(summarizedPromptChars) ? summarizedPromptChars : null,
  };
}

/**
 * Diálogo para gerar fluxos a partir de descrições em linguagem natural.
 */
export function FlowGeneratorDialog({ onFlowGenerated, onCancel }) {
  const { agent } = useAuth();
  // Geração de teste automatizado é superfície de engenharia: apenas DEVELOPMENT.
  const isDevelopment = getAgentClassification(agent) === 'DEVELOPMENT';
  const [description, setDescription] = useState('');
  const [flowName, setFlowName] = useState('');
  const [flowId, setFlowId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);
  const [promptPreview, setPromptPreview] = useState(null);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Critérios (mesmo espírito do modo tenant)
  const [rememberOptions, setRememberOptions] = useState(true);
  const [useRag, setUseRag] = useState(true);
  const [ragSourcesFlags, setRagSourcesFlags] = useState({ flows: true, qa: true, docs: true });
  const [useWebScraping, setUseWebScraping] = useState(false);
  const [scrapingTargets, setScrapingTargets] = useState(['']);
  const [includeQuestions, setIncludeQuestions] = useState(false);
  const [questionsText, setQuestionsText] = useState(''); // input manual (1 por linha)
  const [questionsList, setQuestionsList] = useState([]); // lista efetiva (manual + sugerida)
  const [faqGroups, setFaqGroups] = useState(null);
  const [faqCoverage, setFaqCoverage] = useState(null);
  const [faqCoverageMeta, setFaqCoverageMeta] = useState(null);
  const [faqExclusions, setFaqExclusions] = useState(null);
  const [showFaqExclusions, setShowFaqExclusions] = useState(false);

  // Teste automatizado de UI (engenharia)
  const [generateRpaTest, setGenerateRpaTest] = useState(false);
  const [rpaMode, setRpaMode] = useState('infer');

  // Performance/arquitetura
  const [requestTimeoutSec, setRequestTimeoutSec] = useState(300);
  const [maxFixAttempts, setMaxFixAttempts] = useState(3);
  const [subflowMax, setSubflowMax] = useState(0);

  useEffect(() => {
    const prefs = loadFlowGenerationPrefs();
    if (!prefs) return;
    setRememberOptions(prefs.rememberOptions !== false);
    setUseRag(prefs.useRag !== false);
    setRagSourcesFlags(prefs.ragSourcesFlags || { flows: true, qa: true, docs: true });
    setUseWebScraping(prefs.useWebScraping === true);
    setScrapingTargets(Array.isArray(prefs.scrapingTargets) && prefs.scrapingTargets.length ? prefs.scrapingTargets : ['']);
    setIncludeQuestions(prefs.includeQuestions === true);
    setQuestionsText(typeof prefs.questionsText === 'string' ? prefs.questionsText : '');
    setShowAdvanced(prefs.showAdvanced === true);
    setGenerateRpaTest(prefs.generateRpaTest === true);
    setRpaMode((prefs.rpaMode === 'infer' || prefs.rpaMode === 'record' || prefs.rpaMode === 'hybrid') ? prefs.rpaMode : 'infer');
    setRequestTimeoutSec(Number.isFinite(Number(prefs.requestTimeoutSec)) ? Math.max(30, Math.min(600, Number(prefs.requestTimeoutSec))) : 300);
    setMaxFixAttempts(Number.isFinite(Number(prefs.maxFixAttempts)) ? Math.max(1, Math.min(10, Number(prefs.maxFixAttempts))) : 3);
    setSubflowMax(Number.isFinite(Number(prefs.subflowMax)) ? Math.max(0, Math.min(5, Number(prefs.subflowMax))) : 0);
  }, []);

  const ragSources = useMemo(() => {
    if (!useRag) return [];
    return ['flows', 'qa', 'docs'].filter((k) => ragSourcesFlags?.[k] === true);
  }, [useRag, ragSourcesFlags]);

  const parseQuestionsFromText = (raw) => {
    return String(raw || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.slice(0, 220))
      .filter((l) => l.length > 0);
  };

  const mergeUniqueQuestions = (a, b, max = 50) => {
    const base = Array.isArray(a) ? a : [];
    const incoming = Array.isArray(b) ? b : [];
    const out = [];
    const seen = new Set();
    for (const q of [...base, ...incoming]) {
      const s = typeof q === 'string' ? q.trim() : '';
      if (!s) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s.slice(0, 220));
      if (out.length >= max) break;
    }
    return out;
  };

  const effectiveQuestions = useMemo(() => {
    if (!includeQuestions) return [];
    return mergeUniqueQuestions(questionsList, parseQuestionsFromText(questionsText), 50);
  }, [includeQuestions, questionsList, questionsText]);

  const promptIndicator = useMemo(() => {
    return parsePromptIndicatorFromFinalPrompt(promptPreview?.finalPrompt);
  }, [promptPreview?.finalPrompt]);

  const promptIndicatorTitle = useMemo(() => {
    if (!promptIndicator) return null;
    const parts = [];
    parts.push(promptIndicator.summarized ? 'Prompt sumarizado' : 'Prompt completo (não sumarizado)');
    if (promptIndicator.reason) parts.push(`reason=${promptIndicator.reason}`);
    if (promptIndicator.promptChars !== null) parts.push(`promptChars=${promptIndicator.promptChars}`);
    if (promptIndicator.originalPromptChars !== null) parts.push(`originalPromptChars=${promptIndicator.originalPromptChars}`);
    if (promptIndicator.summarizedPromptChars !== null) parts.push(`summarizedPromptChars=${promptIndicator.summarizedPromptChars}`);
    return parts.join(' · ');
  }, [promptIndicator]);

  const validateUrl = (url) => {
    try {
      const u = new URL(String(url || '').trim());
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const handleAddQuestionsFromText = () => {
    const parsed = parseQuestionsFromText(questionsText);
    if (parsed.length === 0) return;
    setQuestionsList((prev) => mergeUniqueQuestions(prev, parsed, 50));
    setQuestionsText('');
    // Se o usuário mexeu manualmente, o agrupamento do “Sugerir” pode ficar desatualizado
    setFaqGroups(null);
    setFaqCoverage(null);
    setFaqCoverageMeta(null);
    setFaqExclusions(null);
    setShowFaqExclusions(false);
  };

  const handleRemoveQuestion = (index) => {
    setQuestionsList((prev) => (Array.isArray(prev) ? prev.filter((_, i) => i !== index) : []));
    setFaqGroups(null);
    setFaqCoverage(null);
    setFaqCoverageMeta(null);
    setFaqExclusions(null);
    setShowFaqExclusions(false);
  };

  const handleSuggestQuestions = async () => {
    const tenantId = getTenantId();
    const validUrls = useWebScraping
      ? (Array.isArray(scrapingTargets) ? scrapingTargets : []).filter(validateUrl).slice(0, 5)
      : [];

    if (!description.trim() && !flowName.trim()) {
      setError('Preencha a descrição (ou ao menos o nome) antes de sugerir perguntas.');
      return;
    }

    try {
      setSuggesting(true);
      setError(null);

      const resp = await fetchJson('/system/generate-faq', {
        method: 'POST',
        body: JSON.stringify({
          ...(tenantId ? { tenantId } : {}),
          name: flowName?.trim() || null,
          description: description?.trim() || null,
          urls: validUrls,
          fileNames: [],
          pipelineStage: 'questionsGenerated',
          // Importante: NÃO usar dryRun aqui (você pediu persistência das exclusões como no gerador de tenants)
        }),
        timeoutMs: 60000,
        silent: true,
      });

      const data = (resp && typeof resp === 'object' && resp.data && typeof resp.data === 'object')
        ? resp.data
        : resp;
      const groups = Array.isArray(data?.faq) ? data.faq : null;
      const flat = Array.isArray(data?.flatQuestions) ? data.flatQuestions : null;
      const exclusions = Array.isArray(data?.exclusions) ? data.exclusions : null;
      const coverage = (typeof data?.coverage === 'number') ? data.coverage : null;
      const meta = (data?.meta && typeof data.meta === 'object') ? data.meta : null;

      setFaqGroups(groups && groups.length ? groups : null);
      setFaqCoverage(coverage);
      setFaqCoverageMeta(meta);
      setFaqExclusions(exclusions && exclusions.length ? exclusions : null);
      setShowFaqExclusions(false);

      const fromFlat = Array.isArray(flat) && flat.length
        ? flat
        : (Array.isArray(groups) ? groups.flatMap((g) => (Array.isArray(g?.questions) ? g.questions : [])) : []);
      setQuestionsList((prev) => mergeUniqueQuestions(Array.isArray(prev) && prev.length ? prev : [], fromFlat, 50));
    } catch (err) {
      setError(err?.message || 'Falha ao sugerir perguntas.');
    } finally {
      setSuggesting(false);
    }
  };

  const handleGenerate = async () => {
    if (!description.trim()) {
      setError('Por favor, descreva o fluxo que deseja criar.');
      return;
    }

    try {
      setGenerating(true);
      setError(null);

      // Validações do contrato (frontend) – best-effort
      if (useRag && ragSources.length === 0) {
        setError('Selecione ao menos 1 fonte de RAG (Fluxos, QA ou Docs), ou desative o RAG.');
        return;
      }
      if (useWebScraping) {
        const urls = (Array.isArray(scrapingTargets) ? scrapingTargets : [])
          .map((u) => (typeof u === 'string' ? u.trim() : ''))
          .filter(Boolean);
        if (urls.length === 0) {
          setError('Informe ao menos 1 URL para Web Scraping, ou desative o Web Scraping.');
          return;
        }
      }
      if (includeQuestions && effectiveQuestions.length === 0) {
        setError('Informe ao menos 1 pergunta (1 por linha), ou desative a opção de FAQ/perguntas.');
        return;
      }

      logger.info('Iniciando geração de fluxo', { 
        description: description.substring(0, 100),
        flowName,
        flowId,
        useRag,
        ragSources,
        useWebScraping,
        scrapingTargetsCount: Array.isArray(scrapingTargets) ? scrapingTargets.filter(Boolean).length : 0,
        includeQuestions,
        questionsCount: effectiveQuestions.length,
        generateRpaTest: isDevelopment && generateRpaTest,
        rpaMode,
        maxFixAttempts,
        subflowMax,
        requestTimeoutSec,
      });

      const result = await generateFlowFromDescription(description, {
        flowName: flowName || undefined,
        flowId: flowId || undefined,
        useRag,
        ragSources,
        useWebScraping,
        scrapingTargets: useWebScraping
          ? (Array.isArray(scrapingTargets) ? scrapingTargets.map((u) => String(u || '').trim()).filter(Boolean) : [])
          : [],
        includeQuestions,
        questions: effectiveQuestions,
        generateRpaTest: isDevelopment && generateRpaTest,
        rpaMode,
        maxFixAttempts,
        subflowMax,
        timeoutMs: Math.max(30, Math.min(600, Number(requestTimeoutSec) || 120)) * 1000,
      });

      const generatedFlow = result?.flowDefinition || result;
      if (!generatedFlow || typeof generatedFlow !== 'object') {
        throw new Error('Resposta inválida ao gerar fluxo (flowDefinition ausente).');
      }

      logger.info('Fluxo gerado com sucesso', { 
        flowId: generatedFlow?.id,
        nodeCount: generatedFlow?.nodes?.length || 0,
        ragUsed: result?.ragUsed || false,
      });

      if (rememberOptions) {
        saveFlowGenerationPrefs({
          rememberOptions,
          showAdvanced,
          useRag,
          ragSourcesFlags,
          useWebScraping,
          scrapingTargets,
          includeQuestions,
          questionsText,
          generateRpaTest,
          rpaMode,
          requestTimeoutSec,
          maxFixAttempts,
          subflowMax,
        });
      }

      if (onFlowGenerated) {
        onFlowGenerated(generatedFlow, {
          validationWarnings: result?.validationWarnings || null,
          generationResult: result || null,
        });
      }
    } catch (err) {
      logger.error('Erro ao gerar fluxo', err);
      const msg = String(err?.message || '');
      const name = String(err?.name || '');
      const isTimeout =
        name === 'AbortError' ||
        /timed out/i.test(msg) ||
        /timeout/i.test(msg);
      const isConnRefused =
        /ERR_CONNECTION_REFUSED/i.test(msg) ||
        /connection refused/i.test(msg);
      const isFailedToFetch =
        /Failed to fetch/i.test(msg) ||
        /NetworkError/i.test(msg);

      // Telemetria local (debug) para explicar comportamento observado
      logger.warn('[FlowGeneratorDialog] Geração falhou (diagnóstico)', {
        name,
        message: msg,
        requestTimeoutSec,
        maxFixAttempts,
        subflowMax,
        useRag,
        ragSources,
        useWebScraping,
      });

      if (isTimeout) {
        setError(
          'A geração foi interrompida por timeout antes de retornar um rascunho read-only.\n' +
          'Sugestões:\n' +
          '- Aumente o timeout (ex.: 300s)\n' +
          '- Reduza maxFixAttempts/subflowMax\n' +
          '- Se preferências antigas estiverem ativas, limpe o localStorage (flowGenerationPreferences)\n'
        );
      } else if (isConnRefused || isFailedToFetch) {
        setError(
          'Não foi possível acessar a API para gerar o fluxo (conexão indisponível).\n' +
          'Isso costuma ocorrer quando o servidor está reiniciando (nodemon/Vite).\n' +
          'Sugestões:\n' +
          '- Aguarde a API voltar (porta 3001) e recarregue a página\n' +
          '- Tente novamente após estabilizar\n'
        );
      } else {
        setError(msg || 'Erro ao gerar fluxo. Tente novamente.');
      }
    } finally {
      setGenerating(false);
    }
  };

  const handlePreviewPrompt = async () => {
    if (!description.trim()) {
      setError('Por favor, descreva o fluxo que deseja criar.');
      return;
    }

    // Validações do contrato (frontend) – best-effort (mesmas do handleGenerate)
    if (useRag && ragSources.length === 0) {
      setError('Selecione ao menos 1 fonte de RAG (Fluxos, QA ou Docs), ou desative o RAG.');
      return;
    }
    if (useWebScraping) {
      const urls = (Array.isArray(scrapingTargets) ? scrapingTargets : [])
        .map((u) => (typeof u === 'string' ? u.trim() : ''))
        .filter(Boolean);
      if (urls.length === 0) {
        setError('Informe ao menos 1 URL para Web Scraping, ou desative o Web Scraping.');
        return;
      }
    }
    if (includeQuestions && effectiveQuestions.length === 0) {
      setError('Informe ao menos 1 pergunta (1 por linha), ou desative a opção de FAQ/perguntas.');
      return;
    }

    try {
      setPreviewing(true);
      setError(null);

      const preview = await previewFlowGenerationPrompt(description, {
        flowName: flowName || undefined,
        flowId: flowId || undefined,
        useRag,
        ragSources,
        useWebScraping,
        scrapingTargets: useWebScraping
          ? (Array.isArray(scrapingTargets) ? scrapingTargets.map((u) => String(u || '').trim()).filter(Boolean) : [])
          : [],
        includeQuestions,
        questions: effectiveQuestions,
        tenantId: getTenantId() || undefined,
      });

      const normalizedPreview = (preview && typeof preview === 'object') ? preview : null;
      const objective = String(normalizedPreview?.objective || '').trim();
      const finalPrompt = String(normalizedPreview?.finalPrompt || '').trim();
      if (!objective || !finalPrompt) {
        setPromptPreview(null);
        setConfirmStep(false);
        setError('Não foi possível montar o prompt enriquecido (preview incompleto). Verifique permissões e tente novamente.');
        return;
      }

      setPromptPreview(normalizedPreview);
      setConfirmStep(true);
    } catch (err) {
      logger.error('Erro ao pré-visualizar prompt', err);
      const msg = String(err?.body?.message || err?.message || '');
      const status = err?.status;
      if (status === 403) {
        setError('Sem permissão para pré-visualizar o prompt completo (requer Super Admin).');
      } else if (status === 401) {
        setError('Você precisa estar autenticado para pré-visualizar o prompt.');
      } else {
        setError(msg || 'Erro ao pré-visualizar prompt. Tente novamente.');
      }
      // Enriquecimento obrigatório: não avança sem o prompt enriquecido.
      setPromptPreview(null);
      setConfirmStep(false);
    } finally {
      setPreviewing(false);
    }
  };

  const handleCancel = () => {
    setDescription('');
    setFlowName('');
    setFlowId('');
    setQuestionsText('');
    setQuestionsList([]);
    setFaqGroups(null);
    setFaqCoverage(null);
    setFaqExclusions(null);
    setShowFaqExclusions(false);
    setError(null);
    setConfirmStep(false);
    setPromptPreview(null);
    if (onCancel) {
      onCancel();
    }
  };

  return (
    <Dialog
      isOpen={true}
      onClose={handleCancel}
      title="Gerar Fluxo com IA"
      size="lg"
    >
      <div className="h-full overflow-y-auto pr-2 space-y-6">
        {confirmStep ? (
          <div className="space-y-4">
            <div className="text-sm text-text-secondary">
              Confira o objetivo e o prompt FINAL antes de enviar ao provedor de IA.
            </div>

            <div className="p-3 rounded-md border border-border-default bg-bg-tertiary space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-text-tertiary uppercase tracking-wider font-medium">
                  Objetivo do fluxo
                </div>
                {promptIndicator && (
                  <span
                    className={`text-xs border border-border-default rounded-full px-2 py-0.5 ${
                      promptIndicator.summarized
                        ? 'bg-status-warning/10 text-status-warning'
                        : 'bg-status-success/10 text-status-success'
                    }`}
                    title={promptIndicatorTitle || undefined}
                  >
                    {promptIndicator.summarized ? 'Prompt sumarizado' : 'Prompt OK'}
                    {promptIndicator.summarized && promptIndicator.reason ? ` · ${promptIndicator.reason}` : ''}
                  </span>
                )}
              </div>
              <div className="text-sm text-text-primary whitespace-pre-wrap">
                {String(promptPreview?.objective || '').trim() || '—'}
              </div>
            </div>

            <div className="p-3 rounded-md border border-border-default bg-bg-tertiary space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-text-tertiary uppercase tracking-wider font-medium">
                  Prompt que será enviado ({promptPreview?.promptSummary || 'chatbot.generator.prompt.md'})
                </div>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    try {
                      const txt = String(promptPreview?.finalPrompt || '');
                      if (!txt) return;
                      if (navigator?.clipboard?.writeText) {
                        await navigator.clipboard.writeText(txt);
                      } else {
                        setError('Clipboard indisponível');
                      }
                    } catch {
                      setError('Falha ao copiar prompt');
                    }
                  }}
                  disabled={!promptPreview?.finalPrompt}
                >
                  Copiar
                </Button>
              </div>
              <pre className="text-xs font-mono text-text-primary whitespace-pre-wrap max-h-[45vh] overflow-y-auto p-3 rounded bg-bg-primary border border-border-default">
                {String(promptPreview?.finalPrompt || '— (preview indisponível)')}
              </pre>
              {promptPreview?.ragMeta && (
                <div className="text-xs text-text-tertiary">
                  RAG: {promptPreview.ragMeta.ragUsed ? 'sim' : 'não'}
                  {Array.isArray(promptPreview.ragMeta.ragSources) && promptPreview.ragMeta.ragSources.length
                    ? ` · fontes: ${promptPreview.ragMeta.ragSources.slice(0, 8).join(', ')}`
                    : ''}
                </div>
              )}
            </div>

            {error && (
              <div className="p-3 rounded-md bg-status-error/10 border border-status-error/20 text-status-error text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <Button
                variant="ghost"
                onClick={() => setConfirmStep(false)}
                disabled={generating || previewing}
              >
                Voltar
              </Button>
              <Button
                variant="primary"
                onClick={handleGenerate}
                disabled={generating || previewing}
              >
                {generating ? 'Enviando...' : 'Confirmar e enviar'}
              </Button>
            </div>
          </div>
        ) : (
          <>
        <div className="space-y-2">
          <div className="text-sm text-text-secondary">
            Descreva o fluxo que você deseja criar em linguagem natural. 
            Por exemplo: "Quero um fluxo que ofereça atendimento humano" ou 
            "Crie um fluxo que reconheça intenções e direcione para diferentes mensagens".
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Exemplo: Quero um fluxo que comece com uma mensagem de boas-vindas, reconheça a intenção do usuário (suporte, vendas ou financeiro) e direcione para mensagens específicas. Se não entender, deve transferir para atendimento humano."
            className="w-full p-3 border border-border-default rounded-md bg-bg-primary text-text-primary placeholder-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-accent-default focus:border-transparent"
            rows={6}
            disabled={generating}
          />
        </div>

        <div className="bg-bg-tertiary rounded-md border border-border-default p-3">
          <button
            type="button"
            className="w-full flex items-center justify-between text-sm text-text-primary"
            onClick={() => setShowAdvanced((v) => !v)}
            disabled={generating}
          >
            <span className="font-medium">Configuração de geração (critérios)</span>
            <span className="text-text-tertiary">{showAdvanced ? 'Ocultar' : 'Mostrar'}</span>
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-4">
              {/* RAG */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                  <input
                    type="checkbox"
                    checked={useRag}
                    onChange={(e) => setUseRag(e.target.checked)}
                    disabled={generating}
                    className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                  />
                  <span className="font-medium">Usar RAG (conhecimento já indexado)</span>
                </label>
                {useRag && (
                  <div className="ml-6 flex flex-col gap-2 text-sm">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ragSourcesFlags.flows === true}
                        onChange={(e) => setRagSourcesFlags((prev) => ({ ...(prev || {}), flows: e.target.checked }))}
                        disabled={generating}
                        className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                      />
                      <span>Fluxos</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ragSourcesFlags.qa === true}
                        onChange={(e) => setRagSourcesFlags((prev) => ({ ...(prev || {}), qa: e.target.checked }))}
                        disabled={generating}
                        className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                      />
                      <span>QA</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ragSourcesFlags.docs === true}
                        onChange={(e) => setRagSourcesFlags((prev) => ({ ...(prev || {}), docs: e.target.checked }))}
                        disabled={generating}
                        className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                      />
                      <span>Docs</span>
                    </label>
                    <div className="text-xs text-text-tertiary">
                      Fontes ativas: {ragSources.length ? ragSources.join(', ') : 'nenhuma'}
                    </div>
                  </div>
                )}
              </div>

              {/* Web Scraping */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                  <input
                    type="checkbox"
                    checked={useWebScraping}
                    onChange={(e) => setUseWebScraping(e.target.checked)}
                    disabled={generating}
                    className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                  />
                  <span className="font-medium">Usar Web Scraping (URLs)</span>
                </label>
                {useWebScraping && (
                  <div className="ml-6 space-y-2">
                    {(Array.isArray(scrapingTargets) ? scrapingTargets : ['']).map((url, idx) => (
                      <div key={idx} className="flex gap-2">
                        <Input
                          type="text"
                          value={url}
                          onChange={(e) => {
                            const v = e.target.value;
                            setScrapingTargets((prev) => {
                              const arr = Array.isArray(prev) ? [...prev] : [];
                              arr[idx] = v;
                              return arr;
                            });
                          }}
                          placeholder="https://site-da-empresa.com"
                          className="w-full"
                          disabled={generating}
                        />
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setScrapingTargets((prev) => {
                              const arr = Array.isArray(prev) ? [...prev] : [];
                              if (arr.length <= 1) return [''];
                              arr.splice(idx, 1);
                              return arr.length ? arr : [''];
                            });
                          }}
                          disabled={generating}
                        >
                          Remover
                        </Button>
                      </div>
                    ))}
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        onClick={() => setScrapingTargets((prev) => (Array.isArray(prev) ? [...prev, ''] : ['']))}
                        disabled={generating}
                      >
                        + Adicionar URL
                      </Button>
                    </div>
                    <div className="text-xs text-text-tertiary">
                      Dica: inclua páginas institucionais (sobre, serviços, FAQ) para melhor contexto.
                    </div>
                  </div>
                )}
              </div>

              {/* FAQ / Perguntas */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                  <input
                    type="checkbox"
                    checked={includeQuestions}
                    onChange={(e) => setIncludeQuestions(e.target.checked)}
                    disabled={generating || suggesting}
                    className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                  />
                  <span className="font-medium">Incluir perguntas (FAQ) para orientar o fluxo</span>
                </label>
                {includeQuestions && (
                  <div className="ml-6 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="ghost"
                        onClick={handleSuggestQuestions}
                        disabled={generating || suggesting || (!description.trim() && !flowName.trim())}
                        title={!description.trim() && !flowName.trim() ? 'Preencha a descrição (ou nome) para sugerir perguntas' : 'Gerar perguntas automaticamente'}
                      >
                        {suggesting ? 'Sugerindo...' : 'Sugerir'}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setQuestionsList([]);
                          setFaqGroups(null);
                          setFaqCoverage(null);
                          setFaqCoverageMeta(null);
                          setFaqExclusions(null);
                          setShowFaqExclusions(false);
                        }}
                        disabled={generating || suggesting || (Array.isArray(questionsList) ? questionsList.length === 0 : true)}
                      >
                        Limpar lista
                      </Button>
                    </div>

                    {(() => {
                      const hasExclusions = Array.isArray(faqExclusions) && faqExclusions.length > 0;
                      const count = hasExclusions ? faqExclusions.length : 0;
                      return (
                        <div className="border border-border-default rounded-lg bg-bg-secondary p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-text-primary">
                              Exclusões dinâmicas (anti-ruído)
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => (hasExclusions ? setShowFaqExclusions((v) => !v) : null)}
                                className="text-xs text-text-secondary border border-border-default rounded-full px-2 py-1 hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
                                title={hasExclusions
                                  ? 'Termos inferidos para excluir ruído técnico das perguntas'
                                  : 'Os termos serão inferidos após gerar o FAQ'}
                                disabled={!hasExclusions}
                              >
                                {count} termo(s) {showFaqExclusions && hasExclusions ? '▲' : '▼'}
                              </button>
                              <button
                                type="button"
                                className="text-xs text-accent-primary hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={!hasExclusions}
                                onClick={async () => {
                                  if (!hasExclusions) return;
                                  try {
                                    const txt = faqExclusions.join('\n');
                                    if (navigator?.clipboard?.writeText) {
                                      await navigator.clipboard.writeText(txt);
                                    } else {
                                      setError('Clipboard indisponível');
                                    }
                                  } catch {
                                    setError('Falha ao copiar exclusões');
                                  }
                                }}
                              >
                                Copiar
                              </button>
                            </div>
                          </div>

                          {!hasExclusions && (
                            <div className="mt-2 text-xs text-text-tertiary">
                              Ainda não há termos inferidos. Eles aparecem automaticamente quando você gerar o FAQ (via “Sugerir”).
                            </div>
                          )}

                          {showFaqExclusions && hasExclusions && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {faqExclusions.slice(0, 30).map((t) => (
                                <span key={t} className="text-xs border border-border-default rounded-full px-2 py-0.5 text-text-secondary">
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    <textarea
                      value={questionsText}
                      onChange={(e) => setQuestionsText(e.target.value)}
                      placeholder="Digite 1 pergunta por linha.\nEx: Qual o horário de atendimento?\nEx: Como solicito um orçamento?"
                      className="w-full p-3 border border-border-default rounded-md bg-bg-primary text-text-primary placeholder-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-accent-default focus:border-transparent"
                      rows={4}
                      disabled={generating || suggesting}
                    />

                    <div className="flex items-center justify-between gap-3">
                      <Button
                        variant="ghost"
                        onClick={handleAddQuestionsFromText}
                        disabled={generating || suggesting || !questionsText.trim()}
                      >
                        Adicionar perguntas
                      </Button>
                      <span className="text-xs text-text-tertiary">
                        {Array.isArray(questionsList) ? questionsList.length : 0} pergunta(s) na lista
                      </span>
                    </div>

                    {(Array.isArray(questionsList) && questionsList.length > 0) && (
                      <div className="border border-border-default rounded-lg bg-bg-secondary p-3">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <div className="text-sm font-semibold text-text-primary">Perguntas incluídas</div>
                          {typeof faqCoverage === 'number' && (
                            <span className="text-xs text-text-secondary border border-border-default rounded-full px-2 py-1">
                              Cobertura do conhecimento: {Math.round(Math.max(0, Math.min(1, faqCoverage)) * 100)}%
                              {Number.isFinite(Number(faqCoverageMeta?.chunkTextsEffective)) ? (
                                <span className="text-text-tertiary">
                                  {' '}
                                  ({Number(faqCoverageMeta.chunkTextsEffective)} chunks {faqCoverageMeta?.chunkCoverageMode === 'relevant' ? 'relevantes' : 'totais'})
                                </span>
                              ) : null}
                            </span>
                          )}
                        </div>
                        <div className="space-y-3 max-h-56 overflow-y-auto">
                          {Array.isArray(faqGroups) && faqGroups.length > 0 ? (
                            faqGroups.map((group, gIdx) => (
                              <div key={`${gIdx}-${group?.category || 'categoria'}`} className="border border-border-default/60 rounded-lg p-2">
                                <div className="text-xs font-semibold text-text-secondary">
                                  {group?.category || 'Outros'}
                                </div>
                                <div className="space-y-2 mt-2">
                                  {(Array.isArray(group?.questions) ? group.questions : []).map((q) => {
                                    const idx = questionsList.indexOf(q);
                                    return (
                                      <div key={q} className="flex items-start justify-between gap-3">
                                        <div className="text-sm text-text-primary whitespace-pre-wrap">{q}</div>
                                        <button
                                          type="button"
                                          onClick={() => (idx >= 0 ? handleRemoveQuestion(idx) : null)}
                                          className="text-status-error hover:opacity-80 text-sm flex-shrink-0"
                                          title="Remover"
                                          disabled={generating || suggesting}
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))
                          ) : (
                            questionsList.map((q, idx) => (
                              <div key={`${idx}-${q}`} className="flex items-start justify-between gap-3">
                                <div className="text-sm text-text-primary whitespace-pre-wrap">{q}</div>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveQuestion(idx)}
                                  className="text-status-error hover:opacity-80 text-sm flex-shrink-0"
                                  title="Remover"
                                  disabled={generating || suggesting}
                                >
                                  ✕
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Teste automatizado: superfície de engenharia (apenas DEVELOPMENT) */}
              {isDevelopment ? (
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                  <input
                    type="checkbox"
                    checked={generateRpaTest}
                    onChange={(e) => setGenerateRpaTest(e.target.checked)}
                    disabled={generating || suggesting}
                    className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                  />
                  <span className="font-medium">Gerar teste RPA (opcional)</span>
                </label>
                {generateRpaTest && (
                  <div className="ml-6 space-y-2">
                    <div className="text-xs text-text-tertiary">
                      O modo de geração deve seguir o contrato: <code className="font-mono">infer</code>, <code className="font-mono">record</code> ou <code className="font-mono">hybrid</code>.
                    </div>
                    <select
                      value={rpaMode}
                      onChange={(e) => setRpaMode(e.target.value)}
                      disabled={generating || suggesting}
                      className="w-full p-2 border border-border-default rounded-md bg-bg-primary text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-default focus:border-transparent"
                    >
                      <option value="infer">infer (padrão)</option>
                      <option value="record">record</option>
                      <option value="hybrid">hybrid</option>
                    </select>
                  </div>
                )}
              </div>
              ) : null}

              {/* Performance / Arquitetura */}
              <div className="space-y-2">
                <div className="text-sm font-semibold text-text-primary">Avançado (performance/arquitetura)</div>
                <div className="ml-0 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div className="space-y-1">
                    <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
                      Timeout (segundos)
                    </div>
                    <Input
                      type="number"
                      value={requestTimeoutSec}
                      onChange={(e) => setRequestTimeoutSec(e.target.value)}
                      min={30}
                      max={600}
                      step={10}
                      disabled={generating || suggesting}
                    />
                    <div className="text-xs text-text-tertiary">
                      Padrão: 120s.
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
                      maxFixAttempts
                    </div>
                    <Input
                      type="number"
                      value={maxFixAttempts}
                      onChange={(e) => setMaxFixAttempts(e.target.value)}
                      min={1}
                      max={10}
                      step={1}
                      disabled={generating || suggesting}
                    />
                    <div className="text-xs text-text-tertiary">
                      Menos tentativas = mais rápido; mais tentativas = melhor qualidade.
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
                      Subfluxos (máx.)
                    </div>
                    <Input
                      type="number"
                      value={subflowMax}
                      onChange={(e) => setSubflowMax(e.target.value)}
                      min={0}
                      max={5}
                      step={1}
                      disabled={generating || suggesting}
                    />
                    <div className="text-xs text-text-tertiary">
                      Padrão: 2. Use 0 para desativar subfluxos automáticos.
                    </div>
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-text-primary">
                <input
                  type="checkbox"
                  checked={rememberOptions}
                  onChange={(e) => setRememberOptions(e.target.checked)}
                  disabled={generating || suggesting}
                  className="w-4 h-4 text-accent-primary border-border-default rounded focus:ring-accent-primary"
                />
                <span className="text-sm">Lembrar estas opções (neste navegador)</span>
              </label>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
              Nome do fluxo (opcional)
            </div>
            <Input
              type="text"
              value={flowName}
              onChange={(e) => setFlowName(e.target.value)}
              placeholder="Deixe vazio para usar nome padrão"
              className="w-full"
              disabled={generating}
            />
          </div>

          <div className="space-y-2">
            <div className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
              ID do fluxo (opcional)
            </div>
            <Input
              type="text"
              value={flowId}
              onChange={(e) => setFlowId(e.target.value)}
              placeholder="Deixe vazio para gerar automaticamente"
              className="w-full font-mono text-xs"
              disabled={generating}
            />
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-md bg-status-error/10 border border-status-error/20 text-status-error text-sm">
            {error}
          </div>
        )}

        <div className="text-xs text-text-tertiary p-3 bg-bg-tertiary rounded-md">
          <strong>Dica:</strong> Seja específico na descrição. Mencione se você quer:
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>Mensagens ao usuário</li>
            <li>Reconhecimento de intenções</li>
            <li>Roteamento baseado em condições</li>
            <li>Transferência para atendimento humano</li>
            <li>Outras funcionalidades específicas</li>
          </ul>
        </div>

        <div className="flex gap-2 justify-end pt-4">
          <Button variant="ghost" onClick={handleCancel} disabled={generating}>
            Cancelar
          </Button>
          <Button 
            variant="primary" 
            onClick={handlePreviewPrompt}
            disabled={generating || previewing || suggesting || !description.trim()}
          >
            {previewing ? 'Carregando prompt...' : 'Mostrar prompt e continuar'}
          </Button>
        </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

