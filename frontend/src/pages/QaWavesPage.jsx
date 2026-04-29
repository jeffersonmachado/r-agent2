import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson } from '../api/client';
import JourneyStatusCard from '../components/qa-waves/JourneyStatusCard';
import JourneyTree from '../components/qa-waves/JourneyTree';
import StepBreakdown from '../components/qa-waves/StepBreakdown';
import ReplayDetailsModal from '../components/qa-waves/ReplayDetailsModal';
import { CoverageGapsTab } from '../components/qa-waves/CoverageGapsTab';
import { useExecutionPolling } from '../components/qa-waves/useExecutionPolling';
import { ExecutionProgress } from '../components/qa-waves/ExecutionProgress';
import '../components/qa-waves/qaWaves.css';

function toScenarioId(scenario) {
  if (!scenario) return null;
  if (typeof scenario === 'string') return scenario;
  if (typeof scenario === 'object') return scenario.id || scenario.scenarioId || null;
  return null;
}

const STEP_TYPE_LABELS = {
  send_message: 'Enviar mensagem',
  validate_intent: 'Validar intenção',
  provide_data: 'Informar dados',
  validate_response: 'Validar resposta',
  check_availability: 'Consultar disponibilidade',
  select_slot: 'Selecionar horário',
  create_booking: 'Criar agendamento',
  create_payment: 'Criar pagamento',
  validate_backend: 'Validar backend',
  validate_sla: 'Validar SLA',
  validate_context: 'Validar contexto',
  validate_fallback: 'Validar fallback',
  validate_flow_transition: 'Validar transição de fluxo',
  validate_access_release: 'Validar liberação de acesso',
  wait_for_event: 'Aguardar evento',
  trigger_channel_event: 'Disparar evento de canal',
};

function formatStepTypeLabel(stepType) {
  if (!stepType) return 'Passo sem nome';
  if (STEP_TYPE_LABELS[stepType]) return STEP_TYPE_LABELS[stepType];
  return String(stepType)
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^\w)/, (match) => match.toUpperCase());
}

export function QaWavesPage() {
  const [journeysTree, setJourneysTree] = useState([]);
  const [journeyStatus, setJourneyStatus] = useState([]);
  const [stepStatus, setStepStatus] = useState([]);
  const [scenarioItems, setScenarioItems] = useState([]);
  const [executionItems, setExecutionItems] = useState([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState('');
  const [scenarioEditor, setScenarioEditor] = useState('');
  const [inferGoal, setInferGoal] = useState('aula experimental');
  const [runReplayId, setRunReplayId] = useState('');
  const [selectedSeedId, setSelectedSeedId] = useState('');
  const [currentExecutionId, setCurrentExecutionId] = useState('');
  const [filters, setFilters] = useState({
    wave: '',
    journey: '',
    scenario: '',
    seed: '',
    status: '',
    source: '',
    dateStart: '',
    dateEnd: '',
  });
  const [selectedDomainId, setSelectedDomainId] = useState('');
  const [selectedJourneyId, setSelectedJourneyId] = useState('');
  const [activeReplayDetails, setActiveReplayDetails] = useState(null);
  const [activeTab, setActiveTab] = useState('jornadas');
  const [executionDateStart, setExecutionDateStart] = useState('');
  const [executionDateEnd, setExecutionDateEnd] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const startedPollingExecutionRef = useRef('');

  // Hook de polling para monitorar execução
  const executionPolling = useExecutionPolling(currentExecutionId, 5000);

  // Inicia polling somente uma vez por executionId para evitar loop agressivo em caso de 404
  useEffect(() => {
    if (!currentExecutionId) {
      startedPollingExecutionRef.current = '';
      return;
    }

    if (startedPollingExecutionRef.current === currentExecutionId) {
      return;
    }

    startedPollingExecutionRef.current = currentExecutionId;
    executionPolling.startPolling();
  }, [currentExecutionId, executionPolling]);

  // Auto-abre replay quando execução termina com sucesso
  useEffect(() => {
    if (executionPolling.isFinished && runReplayId) {
      setTimeout(() => {
        openReplayPage(runReplayId);
      }, 500);
    }
  }, [executionPolling.isFinished, runReplayId]);

  const selectedDomain = useMemo(
    () => journeysTree.find((domain) => domain.id === selectedDomainId) || null,
    [journeysTree, selectedDomainId]
  );

  const selectedJourney = useMemo(
    () => selectedDomain?.journeys?.find((journey) => journey.journeyId === selectedJourneyId) || null,
    [selectedDomain, selectedJourneyId]
  );

  const selectedJourneyScenarios = useMemo(
    () => (scenarioItems || []).filter((scenario) => scenario?.journeyId === selectedJourneyId),
    [scenarioItems, selectedJourneyId]
  );

  const parsedScenario = useMemo(() => {
    try {
      return scenarioEditor ? JSON.parse(scenarioEditor) : null;
    } catch {
      return null;
    }
  }, [scenarioEditor]);

  const treeForSidebar = useMemo(() => {
    const statusByJourney = new Map(journeyStatus.map((item) => [item.journeyId, item]));
    return journeysTree.map((domain) => ({
      ...domain,
      journeys: (domain.journeys || []).map((journey) => ({
        ...journey,
        status: statusByJourney.get(journey.journeyId)?.status || journey.status || 'WARNING',
      })),
    }));
  }, [journeysTree, journeyStatus]);

  const domainSummary = useMemo(() => {
    if (!selectedDomain) {
      return {
        totalItems: 0,
        criticalItems: 0,
        coverage: 0,
        scenarioIds: [],
      };
    }

    // Novo modelo: calcular totais dos steps que já vêm com stats do backend
    let totalAllDomains = 0;
    for (const domain of journeysTree) {
      for (const journey of domain?.journeys || []) {
        for (const step of journey?.steps || []) {
          totalAllDomains += step.totalScenarios || 0;
        }
      }
    }

    let totalSelectedDomain = 0;
    let criticalSelectedDomain = 0;
    const scenarioIds = [];
    
    for (const journey of selectedDomain?.journeys || []) {
      for (const step of journey?.steps || []) {
        const stepScenarios = step.totalScenarios || 0;
        totalSelectedDomain += stepScenarios;
        criticalSelectedDomain += step.criticalFailures || 0;
        // Usar scenarioItems (carregados separadamente) para IDs
        for (const scenario of scenarioItems) {
          if (scenario.journeyId === journey.journeyId && scenarioIds.indexOf(scenario.id) === -1) {
            scenarioIds.push(scenario.id);
          }
        }
      }
    }

    const coverage = totalAllDomains > 0
      ? Math.min(100, Math.round((totalSelectedDomain / totalAllDomains) * 100))
      : 0;

    return {
      totalItems: totalSelectedDomain,
      criticalItems: criticalSelectedDomain,
      coverage,
      scenarioIds,
    };
  }, [journeysTree, selectedDomain, scenarioItems]);

  async function loadJourneyStatus() {
    const response = await fetchJson('/api/qa-waves/journey-status');
    setJourneyStatus(Array.isArray(response.items) ? response.items : []);
  }

  async function loadScenarios() {
    const params = new URLSearchParams();
    if (filters.wave) params.set('waveId', filters.wave);
    if (filters.journey) params.set('journey', filters.journey);
    if (filters.status) params.set('status', filters.status);
    if (filters.source) params.set('source', filters.source);
    const suffix = params.toString();
    const response = await fetchJson(`/api/qa-waves/scenarios${suffix ? `?${suffix}` : ''}`);
    const items = Array.isArray(response.items) ? response.items : [];
    setScenarioItems(items);

    if (!selectedScenarioId && items.length > 0) {
      setSelectedScenarioId(items[0].id);
      setScenarioEditor(JSON.stringify(items[0], null, 2));
    }
  }

  async function loadStepStatus() {
    const params = new URLSearchParams();
    if (selectedJourneyId) params.set('journeyId', selectedJourneyId);
    const suffix = params.toString();
    const response = await fetchJson(`/api/qa-waves/step-status${suffix ? `?${suffix}` : ''}`);
    setStepStatus(Array.isArray(response.items) ? response.items : []);
  }

  async function loadExecutions() {
    const response = await fetchJson('/api/qa-waves/executions?limit=50');
    setExecutionItems(Array.isArray(response.items) ? response.items : []);
  }

  async function loadAll() {
    setError('');
    try {
      const [journeysData, journeyStatusData] = await Promise.all([
        fetchJson('/api/qa-waves/journeys'),
        fetchJson('/api/qa-waves/journey-status'),
        loadScenarios(),
        loadExecutions(),
      ]);

      const domains = Array.isArray(journeysData.domains) ? journeysData.domains : [];
      setJourneysTree(domains);
      setJourneyStatus(Array.isArray(journeyStatusData.items) ? journeyStatusData.items : []);

      if (!selectedDomainId && domains.length > 0) {
        const firstDomain = domains[0];
        const firstJourney = firstDomain?.journeys?.[0];
        setSelectedDomainId(firstDomain.id || '');
        setSelectedJourneyId(firstJourney?.journeyId || '');
      } else if (selectedJourneyId) {
        await loadStepStatus();
      }
    } catch (err) {
      setError(err?.message || 'Falha ao carregar QA Waves');
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      loadExecutions().catch(() => {});
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (selectedJourneyId) {
      loadStepStatus();
    }
  }, [selectedJourneyId]);

  useEffect(() => {
    if (currentExecutionId || executionPolling.isFinished) {
      loadExecutions().catch(() => {});
    }
  }, [currentExecutionId, executionPolling.isFinished]);

  useEffect(() => {
    loadScenarios().catch((err) => setError(err?.message || 'Falha ao carregar cenários'));
  }, [filters.wave, filters.journey, filters.status, filters.source]);

  async function enqueueScenarios(scenarioIds, successMessage) {
    const safeIds = Array.from(new Set((scenarioIds || []).filter(Boolean)));
    if (safeIds.length === 0) {
      setError('Nenhum cenário encontrado para execução');
      return;
    }

    await fetchJson('/api/test-executions', {
      method: 'POST',
      body: JSON.stringify({
        source: 'qa_waves',
        mode: 'real',
        scenarioIds: safeIds,
      }),
    });

    setSuccess(successMessage);
    await Promise.all([loadJourneyStatus(), loadStepStatus()]);
  }

  function updateScenarioEditor(mutator) {
    try {
      const parsed = JSON.parse(scenarioEditor);
      const updated = mutator(parsed);
      setScenarioEditor(JSON.stringify(updated, null, 2));
    } catch {
      setError('Dados do cenário inválidos para edição');
    }
  }

  function loadScenarioInEditor(scenarioId) {
    const item = scenarioItems.find((scenario) => scenario.id === scenarioId);
    if (!item) return;
    setSelectedScenarioId(item.id);
    setSelectedSeedId(item.seeds?.[0]?.id || '');
    setScenarioEditor(JSON.stringify(item, null, 2));
  }

  async function inferScenario() {
    setError('');
    setSuccess('');
    try {
      const channels = ['whatsapp', 'chat'];
      const response = await fetchJson('/api/qa-waves/infer-scenario', {
        method: 'POST',
        body: JSON.stringify({
          vertical: selectedDomain?.id || 'fitness',
          journey: selectedJourney?.journeyId || 'cliente_novo',
          goal: inferGoal,
          channels,
          constraints: {
            semanticStepsOnly: true,
            platformCompatibleOnly: true,
            generateSeeds: true,
          },
        }),
      });

      setScenarioEditor(JSON.stringify(response.scenario, null, 2));
      setSelectedScenarioId(response.scenario?.id || '');
      setSuccess('Cenário inferido por IA e normalizado para passos semânticos.');
    } catch (err) {
      setError(err?.message || 'Falha ao inferir cenário com IA');
    }
  }

  async function validateScenario() {
    setError('');
    setSuccess('');
    try {
      const scenario = JSON.parse(scenarioEditor);
      const response = await fetchJson('/api/qa-waves/validate-scenario', {
        method: 'POST',
        body: JSON.stringify({ scenario }),
      });
      setScenarioEditor(JSON.stringify(response.normalizedScenario, null, 2));
      if (!response.valid) {
        setError(`Validação falhou com ${response.errors?.length || 0} erro(s)`);
        return;
      }
      setSuccess(`Cenário válido (${response.warnings?.length || 0} aviso(s)).`);
    } catch (err) {
      setError(err?.message || 'Falha ao validar cenário');
    }
  }

  async function saveScenario() {
    setError('');
    setSuccess('');
    try {
      const scenario = JSON.parse(scenarioEditor);
      const response = await fetchJson('/api/qa-waves/save-scenario', {
        method: 'POST',
        body: JSON.stringify({ scenario, changedBy: 'manual', changes: ['edicao manual via /dev/qa-waves'] }),
      });
      setScenarioEditor(JSON.stringify(response.scenario, null, 2));
      setSelectedScenarioId(response.scenario?.id || '');
      setSuccess(`Cenário salvo com versão ${response.scenario?.version}.`);
      await loadScenarios();
    } catch (err) {
      setError(err?.message || 'Falha ao salvar cenário');
    }
  }

  async function generateSeeds() {
    setError('');
    setSuccess('');
    try {
      const scenario = JSON.parse(scenarioEditor);
      const response = await fetchJson('/api/qa-waves/generate-seeds', {
        method: 'POST',
        body: JSON.stringify({
          scenarioId: scenario.id,
          count: 5,
          variationTypes: ['persona', 'behavior', 'edge_case', 'channel'],
        }),
      });

      setScenarioEditor(JSON.stringify({ ...scenario, seeds: response.seeds || [] }, null, 2));
      setSuccess(`Seeds geradas por IA: ${(response.seeds || []).length}.`);
    } catch (err) {
      setError(err?.message || 'Falha ao gerar seeds');
    }
  }

  function updateSeedStatus(seedId, status) {
    updateScenarioEditor((scenario) => ({
      ...scenario,
      source: status === 'regression' ? 'replay_regression' : scenario.source,
      seeds: (scenario.seeds || []).map((seed) => {
        if (seed.id !== seedId) return seed;
        return {
          ...seed,
          status,
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
  }

  function moveStep(stepId, direction) {
    updateScenarioEditor((scenario) => {
      const steps = [...(scenario.steps || [])];
      const index = steps.findIndex((step) => step.id === stepId);
      if (index < 0) return scenario;
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= steps.length) return scenario;
      const tmp = steps[index];
      steps[index] = steps[target];
      steps[target] = tmp;
      const reordered = steps.map((step, i) => ({ ...step, order: i + 1 }));
      return { ...scenario, steps: reordered };
    });
  }

  function toggleStep(stepId) {
    updateScenarioEditor((scenario) => ({
      ...scenario,
      steps: (scenario.steps || []).map((step) => (
        step.id === stepId ? { ...step, enabled: step.enabled === false } : step
      )),
    }));
  }

  async function runScenarioReal(targetScenarioIds) {
    setError('');
    setSuccess('');
    setRunReplayId('');
    setCurrentExecutionId('');
    try {
      const parsed = JSON.parse(scenarioEditor);
      const seedIds = selectedSeedId ? [selectedSeedId] : [];
      const response = await fetchJson('/api/test-executions', {
        method: 'POST',
        body: JSON.stringify({
          source: 'qa_waves',
          scenarioIds: targetScenarioIds,
          seedIds,
          mode: 'real',
          replay: true,
        }),
      });

      const legacyRun = response?.compatibility || null;
      const resolvedReplayId = response.replayId || legacyRun?.replayId || '';
      setRunReplayId(resolvedReplayId);
      setCurrentExecutionId(response.executionId || '');
      setSuccess(`Execução real enfileirada. executionId=${response.executionId} replayId=${resolvedReplayId || 'n/a'}`);
      await Promise.all([loadJourneyStatus(), loadStepStatus()]);
    } catch (err) {
      setError(err?.message || 'Falha ao executar cenário real via QA Mesh');
    }
  }

  async function openReplayPage(replayId) {
    if (!replayId) {
      setError('Nenhum replay disponível para abrir.');
      return;
    }

    try {
      const filename = String(replayId).endsWith('.json') ? String(replayId) : `${replayId}.json`;
      const details = await fetchJson(`/api/test-executions/replays/${encodeURIComponent(filename)}`);
      setActiveReplayDetails(details || null);
    } catch (err) {
      setError(err?.message || 'Falha ao abrir replay');
    }
  }

  function getReplayScenarioCandidates(scenarioId) {
    const candidates = new Set();
    if (scenarioId) candidates.add(String(scenarioId));

    const selectedScenario = (scenarioItems || []).find((item) => item?.id === scenarioId);
    const platformIds = Array.isArray(selectedScenario?.platform?.platformScenarioIds)
      ? selectedScenario.platform.platformScenarioIds
      : [];

    for (const platformId of platformIds) {
      if (platformId) candidates.add(String(platformId));
    }

    return Array.from(candidates);
  }

  async function findLatestReplayIdByScenario(scenarioId) {
    const scenarioCandidates = getReplayScenarioCandidates(scenarioId);
    if (scenarioCandidates.length === 0) return null;

    const page = await fetchJson('/api/test-executions/replays?limit=200&offset=0');
    const files = Array.isArray(page?.files) ? page.files : [];

    const candidate = files.find((item) => {
      return scenarioCandidates.includes(String(item?.scenarioId || ''));
    });

    return candidate?.replayId || null;
  }

  async function handleExecuteJourney() {
    setError('');
    setSuccess('');
    try {
      // Novo modelo: extrair IDs de cenários do estado scenarioItems filtrado por journeyId
      const journeyScenarios = scenarioItems.filter(
        (scenario) => scenario.journeyId === selectedJourney?.journeyId
      );
      const scenarioIds = journeyScenarios.map((scenario) => scenario.id);

      await enqueueScenarios(scenarioIds, `Execução da jornada ${selectedJourney?.journeyName || ''} enfileirada com sucesso`);
    } catch (err) {
      setError(err?.message || 'Falha ao enfileirar execução da jornada');
    }
  }

  async function handleExecuteDomain() {
    setError('');
    setSuccess('');
    try {
      await enqueueScenarios(
        domainSummary.scenarioIds,
        `Execução do domínio ${selectedDomain?.name || ''} enfileirada com sucesso`
      );
    } catch (err) {
      setError(err?.message || 'Falha ao enfileirar execução do domínio');
    }
  }

  async function handleExecuteStep(stepId) {
    setError('');
    setSuccess('');
    try {
      // Novo modelo: extrair IDs de cenários do estado scenarioItems filtrado por journeyId
      const stepScenarios = scenarioItems.filter(
        (scenario) => scenario.journeyId === selectedJourney?.journeyId
      );
      const scenarioIds = stepScenarios.map((scenario) => scenario.id);

      const step = (selectedJourney?.steps || []).find((item) => item.stepId === stepId);
      await enqueueScenarios(scenarioIds, `Execução do passo ${step?.stepName || stepId} enfileirada com sucesso`);
    } catch (err) {
      setError(err?.message || 'Falha ao enfileirar execução do passo');
    }
  }

  async function handleExecuteScenario(scenarioId) {
    setError('');
    setSuccess('');
    try {
      await enqueueScenarios([scenarioId], `Execução do cenário ${scenarioId} enfileirada com sucesso`);
    } catch (err) {
      setError(err?.message || 'Falha ao enfileirar execução do cenário');
    }
  }

  async function handleScenarioReplayDetails(scenarioId) {
    setError('');
    try {
      const replayId = await findLatestReplayIdByScenario(scenarioId);
      if (!replayId) {
        setError('Nenhum replay encontrado para este cenário nesta jornada.');
        return;
      }
      await openReplayPage(replayId);
    } catch (err) {
      setError(err?.message || 'Falha ao abrir replay do cenário');
    }
  }

  function handleSelectJourney(domainId, journeyId) {
    setSelectedDomainId(domainId);
    setSelectedJourneyId(journeyId);
  }

  const filteredExecutionItems = (executionItems || []).filter((item) => {
    const createdAt = new Date(item.createdAt || item.startedAt || 0).getTime();
    const byDateStart = !executionDateStart || createdAt >= new Date(`${executionDateStart}T00:00:00`).getTime();
    const byDateEnd = !executionDateEnd || createdAt <= new Date(`${executionDateEnd}T23:59:59`).getTime();
    return byDateStart && byDateEnd;
  });

  return (
    <>
      <div className="qa-waves-page">
      <header className="qa-waves-header">
        <h1 className="qa-waves-title">QA Waves Integrado</h1>
        <p className="qa-waves-subtitle">
          Opera na mesma API e frontend do r-agent2, sem porta adicional.
        </p>
      </header>

      {/* Navegação de tabs */}
      <nav style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb', marginBottom: 16 }}>
        {[
          { id: 'jornadas', label: 'Jornadas e Cenários' },
          { id: 'cobertura', label: 'Cobertura e Gaps' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 20px',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #2563eb' : '2px solid transparent',
              background: 'transparent',
              fontWeight: activeTab === tab.id ? 700 : 400,
              color: activeTab === tab.id ? '#2563eb' : '#6b7280',
              cursor: 'pointer',
              fontSize: 14,
              marginBottom: -2,
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {error ? <div className="qa-waves-feedback error">{error}</div> : null}
      {success ? <div className="qa-waves-feedback success">{success}</div> : null}

      {/* Tab: Cobertura e Gaps */}
      {activeTab === 'cobertura' && <CoverageGapsTab />}

      {/* Tab: Jornadas e Cenários */}
      {activeTab === 'jornadas' && (<>
      {currentExecutionId && (
        <div style={{ marginBottom: '16px' }}>
          <ExecutionProgress
            status={executionPolling.status}
            progress={executionPolling.progress}
            currentStep={executionPolling.currentStep}
            summary={executionPolling.summary}
            durationMs={executionPolling.durationMs}
            onCancel={() => {
              setCurrentExecutionId('');
              executionPolling.stopPolling();
            }}
          />
        </div>
      )}

      <div className="qa-waves-business-main">
        <section className="qa-waves-panel qa-waves-business-sidebar">
          <h2 className="qa-waves-section-title">Domínio e Jornada</h2>
          <JourneyTree
            domains={treeForSidebar}
            selectedDomainId={selectedDomainId}
            selectedJourneyId={selectedJourneyId}
            onSelectJourney={handleSelectJourney}
          />
        </section>

        <section className="qa-waves-panel qa-waves-business-content">
          <div className="qa-journey-actions">
            <h2 className="qa-waves-section-title">Visão de Jornada</h2>
            <div className="qa-journey-actions-buttons">
              <button type="button" onClick={handleExecuteDomain} disabled={!selectedDomain || domainSummary.totalItems === 0}>
                ▶ Domínio
              </button>
              <button type="button" onClick={handleExecuteJourney} disabled={!selectedJourney}>
                ▶ Jornada
              </button>
              <button
                type="button"
                onClick={() => runScenarioReal((scenarioItems || []).map((item) => item.id))}
                disabled={scenarioItems.length === 0}
              >
                ▶ Wave real
              </button>
            </div>
          </div>
          <article className="qa-domain-summary-card">
            <h3>Resumo consolidado do domínio</h3>
            <div className="qa-domain-summary-metrics">
              <div>
                <strong>{domainSummary.totalItems}</strong>
                <span>Itens</span>
              </div>
              <div>
                <strong>{domainSummary.criticalItems}</strong>
                <span>Críticos</span>
              </div>
              <div>
                <strong>{domainSummary.coverage}%</strong>
                <span>Cobertura</span>
              </div>
            </div>
          </article>

          <article className="qa-domain-summary-card" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h3>Execuções reais QA Waves</h3>
              <div className="qa-journey-actions-buttons" style={{ marginBottom: 0 }}>
                <input
                  type="date"
                  value={executionDateStart}
                  onChange={(event) => setExecutionDateStart(event.target.value)}
                  title="Filtrar execuções a partir de"
                />
                <input
                  type="date"
                  value={executionDateEnd}
                  onChange={(event) => setExecutionDateEnd(event.target.value)}
                  title="Filtrar execuções até"
                />
                <button type="button" onClick={() => loadExecutions()}>
                  ↻ Atualizar
                </button>
              </div>
            </div>

            {filteredExecutionItems.length === 0 ? (
              <p className="qa-empty">Nenhuma execução real encontrada para o filtro atual.</p>
            ) : (
              <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                {filteredExecutionItems.map((execution) => {
                  const replayId = execution.replayArtifacts?.[0]?.replayId || '';
                  const liveStatus = execution.executionId === currentExecutionId && executionPolling.status !== 'idle'
                    ? executionPolling.status
                    : execution.status;

                  return (
                    <div
                      key={execution.executionId}
                      style={{
                        border: execution.executionId === currentExecutionId ? '2px solid #2563eb' : '1px solid #d1d5db',
                        borderRadius: 8,
                        padding: 10,
                        background: execution.executionId === currentExecutionId ? '#eff6ff' : '#fff',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        <div>
                          <strong>{execution.executionId}</strong>
                          <div style={{ fontSize: 12, color: '#6b7280' }}>
                            Status: {liveStatus} | Criado em: {execution.createdAt ? new Date(execution.createdAt).toLocaleString('pt-BR') : 'n/a'}
                          </div>
                        </div>
                        <div className="qa-journey-actions-buttons" style={{ marginBottom: 0 }}>
                          <button
                            type="button"
                            onClick={() => {
                              setCurrentExecutionId(execution.executionId);
                              executionPolling.startPolling();
                            }}
                          >
                            ⟳ Monitorar
                          </button>
                          <button
                            type="button"
                            onClick={() => openReplayPage(replayId)}
                            disabled={!replayId}
                          >
                            ↗ Abrir replay
                          </button>
                        </div>
                      </div>

                      <div style={{ fontSize: 12, marginTop: 6 }}>
                        Replays: {(execution.replayArtifacts || []).map((artifact) => artifact.replayId).filter(Boolean).join(', ') || 'n/a'}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>

          <JourneyStatusCard journey={selectedJourney} stepStatuses={selectedJourney?.steps || []} />
          <StepBreakdown
            steps={selectedJourney?.steps || []}
            scenarios={selectedJourneyScenarios}
            onExecuteStep={handleExecuteStep}
            onExecuteScenario={handleExecuteScenario}
            onReplayScenario={handleScenarioReplayDetails}
          />

          <article className="qa-domain-summary-card" style={{ marginTop: 16 }}>
            <h3>Cenários semânticos e seeds (IA + manual)</h3>

            <div className="qa-execution-quick">
              <div>
                <strong>Execução rápida</strong>
                <p>Selecione um cenário e execute aqui. O replay abre no módulo unificado.</p>
              </div>
              <div className="qa-journey-actions-buttons">
                <select value={selectedSeedId} onChange={(event) => setSelectedSeedId(event.target.value)}>
                  <option value="">Todas as seeds</option>
                  {(parsedScenario?.seeds || []).map((seed) => (
                    <option key={seed.id} value={seed.id}>{seed.id}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => runScenarioReal([selectedScenarioId])}
                  disabled={!selectedScenarioId}
                  className="qa-btn-primary"
                >
                  ▶ Executar cenário
                </button>
                <button
                  type="button"
                  onClick={() => openReplayPage(runReplayId)}
                  disabled={!runReplayId}
                >
                  ↗ Abrir replay
                </button>
              </div>
            </div>

            <div className="qa-journey-actions-buttons" style={{ marginBottom: 12 }}>
              <input
                type="text"
                value={inferGoal}
                onChange={(event) => setInferGoal(event.target.value)}
                placeholder="Objetivo para inferência IA"
              />
              <button type="button" onClick={inferScenario}>✦ IA</button>
              <button type="button" onClick={validateScenario}>✓ Validar</button>
              <button type="button" onClick={saveScenario}>⎘ Salvar</button>
              <button type="button" onClick={generateSeeds}>◎ Seeds</button>
            </div>

            <div className="qa-journey-actions-buttons" style={{ marginBottom: 12 }}>
              <input
                type="text"
                value={filters.wave}
                onChange={(event) => setFilters((prev) => ({ ...prev, wave: event.target.value }))}
                placeholder="Filtro wave"
              />
              <input
                type="text"
                value={filters.journey}
                onChange={(event) => setFilters((prev) => ({ ...prev, journey: event.target.value }))}
                placeholder="Filtro jornada"
              />
              <input
                type="text"
                value={filters.scenario}
                onChange={(event) => setFilters((prev) => ({ ...prev, scenario: event.target.value }))}
                placeholder="Filtro cenário"
              />
              <input
                type="text"
                value={filters.seed}
                onChange={(event) => setFilters((prev) => ({ ...prev, seed: event.target.value }))}
                placeholder="Filtro seed"
              />
              <input
                type="text"
                value={filters.status}
                onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
                placeholder="status"
              />
              <input
                type="text"
                value={filters.source}
                onChange={(event) => setFilters((prev) => ({ ...prev, source: event.target.value }))}
                placeholder="origem"
              />
              <input
                type="date"
                value={filters.dateStart}
                onChange={(event) => setFilters((prev) => ({ ...prev, dateStart: event.target.value }))}
              />
              <input
                type="date"
                value={filters.dateEnd}
                onChange={(event) => setFilters((prev) => ({ ...prev, dateEnd: event.target.value }))}
              />
            </div>

            <div className="qa-scenario-editor-grid">
              <div className="qa-scenario-list-panel">
                {(scenarioItems || [])
                  .filter((item) => {
                    const byScenario = !filters.scenario || `${item.id} ${item.name}`.toLowerCase().includes(filters.scenario.toLowerCase());
                    const bySeed = !filters.seed || (item.seeds || []).some((seed) => String(seed.id).toLowerCase().includes(filters.seed.toLowerCase()));
                    const byDateStart = !filters.dateStart || new Date(item.updatedAt || item.createdAt || 0).getTime() >= new Date(`${filters.dateStart}T00:00:00`).getTime();
                    const byDateEnd = !filters.dateEnd || new Date(item.updatedAt || item.createdAt || 0).getTime() <= new Date(`${filters.dateEnd}T23:59:59`).getTime();
                    return byScenario && bySeed && byDateStart && byDateEnd;
                  })
                  .map((item) => {
                    const selected = item.id === selectedScenarioId;
                    const sourceBadge = item.source === 'ai_inferred' ? 'IA' : item.source === 'replay_regression' ? 'Regressao' : 'Manual';
                    return (
                      <button
                        key={`${item.id}-${item.version}`}
                        type="button"
                        onClick={() => loadScenarioInEditor(item.id)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          marginBottom: 6,
                          borderRadius: 6,
                          border: selected ? '2px solid #2563eb' : '1px solid #d1d5db',
                          padding: 8,
                          background: selected ? '#eff6ff' : '#fff',
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{item.name}</div>
                        <div style={{ fontSize: 12 }}>{item.id}@{item.version}</div>
                        <div style={{ fontSize: 12 }}>Status: {item.status} | Origem: {sourceBadge}</div>
                      </button>
                    );
                  })}
              </div>

              <div>
                {!parsedScenario ? (
                  <p className="qa-empty">Selecione um cenário válido para habilitar a edição guiada.</p>
                ) : (
                  <div style={{ marginTop: 4 }}>
                    <h4>Edição guiada do cenário</h4>

                    <details style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: 8, marginBottom: 10 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Dados gerais</summary>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                        <label style={{ display: 'grid', gap: 4 }}>
                          Nome
                          <input
                            type="text"
                            value={parsedScenario.name || ''}
                            onChange={(event) => updateScenarioEditor((scenario) => ({ ...scenario, name: event.target.value }))}
                          />
                        </label>

                        <label style={{ display: 'grid', gap: 4 }}>
                          Versão
                          <input type="text" value={parsedScenario.version || ''} disabled />
                        </label>

                        <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
                          Descrição
                          <textarea
                            value={parsedScenario.description || ''}
                            rows={3}
                            onChange={(event) => updateScenarioEditor((scenario) => ({ ...scenario, description: event.target.value }))}
                          />
                        </label>

                        <label style={{ display: 'grid', gap: 4 }}>
                          Risco
                          <select
                            value={parsedScenario.risk || 'medium'}
                            onChange={(event) => updateScenarioEditor((scenario) => ({ ...scenario, risk: event.target.value }))}
                          >
                            <option value="low">low</option>
                            <option value="medium">medium</option>
                            <option value="high">high</option>
                          </select>
                        </label>

                        <label style={{ display: 'grid', gap: 4 }}>
                          Prioridade
                          <select
                            value={parsedScenario.priority || 'medium'}
                            onChange={(event) => updateScenarioEditor((scenario) => ({ ...scenario, priority: event.target.value }))}
                          >
                            <option value="low">low</option>
                            <option value="medium">medium</option>
                            <option value="high">high</option>
                          </select>
                        </label>

                        <fieldset style={{ gridColumn: '1 / -1', border: '1px solid #d1d5db', borderRadius: 6, padding: 8 }}>
                          <legend>Canais</legend>
                          <div className="qa-journey-actions-buttons" style={{ marginBottom: 0 }}>
                            {['whatsapp', 'chat', 'email', 'voice'].map((channel) => {
                              const selected = Array.isArray(parsedScenario.channels) && parsedScenario.channels.includes(channel);
                              return (
                                <label key={channel} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={() => updateScenarioEditor((scenario) => {
                                      const current = Array.isArray(scenario.channels) ? scenario.channels : [];
                                      const next = current.includes(channel)
                                        ? current.filter((item) => item !== channel)
                                        : [...current, channel];
                                      return { ...scenario, channels: next };
                                    })}
                                  />
                                  {channel}
                                </label>
                              );
                            })}
                          </div>
                        </fieldset>
                      </div>
                    </details>

                    <details style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: 8, marginBottom: 10 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Passos semânticos</summary>
                      <div style={{ marginTop: 8 }}>
                        {(parsedScenario.steps || []).map((step) => (
                          <div key={step.id} className="qa-step-editor-row">
                            <span className="qa-step-editor-title">{step.order}. {formatStepTypeLabel(step.type)} ({step.enabled === false ? 'desativado' : 'ativo'})</span>
                            <button type="button" onClick={() => moveStep(step.id, 'up')} title="Subir passo">↑</button>
                            <button type="button" onClick={() => moveStep(step.id, 'down')} title="Descer passo">↓</button>
                            <button
                              type="button"
                              onClick={() => toggleStep(step.id)}
                              title={step.enabled === false ? 'Ativar passo' : 'Desativar passo'}
                              aria-label={step.enabled === false ? 'Ativar passo' : 'Desativar passo'}
                            >
                              {step.enabled === false ? '▶' : '⏻'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </details>

                    <details style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: 8 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Seeds</summary>
                      <div style={{ marginTop: 8 }}>
                        <div className="qa-journey-actions-buttons" style={{ marginBottom: 8 }}>
                          <select value={selectedSeedId} onChange={(event) => setSelectedSeedId(event.target.value)}>
                            <option value="">Todas as seeds</option>
                            {(parsedScenario.seeds || []).map((seed) => (
                              <option key={seed.id} value={seed.id}>{seed.id}</option>
                            ))}
                          </select>
                        </div>

                        {(parsedScenario.seeds || []).map((seed) => {
                          const sourceBadge = seed.status === 'regression' ? 'Regressao' : (parsedScenario.source === 'ai_inferred' ? 'IA' : 'Manual');
                          return (
                            <div key={seed.id} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: 8, marginBottom: 6 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                <strong>{seed.id}</strong>
                                <span>{sourceBadge}</span>
                              </div>
                              <div style={{ fontSize: 12 }}>Status: {seed.status} | Persona: {seed.persona?.type || 'n/a'}</div>
                              <div className="qa-journey-actions-buttons" style={{ marginTop: 6 }}>
                                <button type="button" onClick={() => updateSeedStatus(seed.id, 'reviewed')}>◔ Revisar</button>
                                <button type="button" onClick={() => updateSeedStatus(seed.id, 'approved')}>✓ Aprovar</button>
                                <button type="button" onClick={() => updateSeedStatus(seed.id, 'regression')}>↺ Regressão</button>
                                <button
                                  type="button"
                                  onClick={() => updateSeedStatus(seed.id, 'disabled')}
                                  title="Desativar seed"
                                  aria-label="Desativar seed"
                                >
                                  ⏻
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  </div>
                )}
              </div>
            </div>
          </article>
        </section>
      </div>
      </>)}
      </div>

      <ReplayDetailsModal
        details={activeReplayDetails}
        onClose={() => setActiveReplayDetails(null)}
      />
    </>
  );
}

export default QaWavesPage;
