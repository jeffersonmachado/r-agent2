import React, { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../api/client';
import JourneyStatusCard from '../components/qa-waves/JourneyStatusCard';
import JourneyTree from '../components/qa-waves/JourneyTree';
import ReplayDetailsModal from '../components/qa-waves/ReplayDetailsModal';
import StepBreakdown from '../components/qa-waves/StepBreakdown';
import '../components/qa-waves/qaWaves.css';

function toScenarioId(scenario) {
  if (!scenario) return null;
  if (typeof scenario === 'string') return scenario;
  if (typeof scenario === 'object') return scenario.id || scenario.scenarioId || null;
  return null;
}

function collectScenarioEntriesFromSteps(steps = []) {
  const entries = [];

  for (const step of steps || []) {
    const subJourneys = Array.isArray(step?.subJourneys) ? step.subJourneys : [];
    for (const subJourney of subJourneys) {
      const scenarios = Array.isArray(subJourney?.scenarios) ? subJourney.scenarios : [];
      for (const scenario of scenarios) {
        const id = toScenarioId(scenario);
        if (!id) continue;
        entries.push({
          id,
          critical: Boolean(scenario?.critical),
        });
      }
    }
  }

  return entries;
}

export function QaWavesPage() {
  const [journeysTree, setJourneysTree] = useState([]);
  const [journeyStatus, setJourneyStatus] = useState([]);
  const [stepStatus, setStepStatus] = useState([]);
  const [details, setDetails] = useState(null);
  const [selectedDomainId, setSelectedDomainId] = useState('');
  const [selectedJourneyId, setSelectedJourneyId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selectedDomain = useMemo(
    () => journeysTree.find((domain) => domain.id === selectedDomainId) || null,
    [journeysTree, selectedDomainId]
  );

  const selectedJourney = useMemo(
    () => selectedDomain?.journeys?.find((journey) => journey.journeyId === selectedJourneyId) || null,
    [selectedDomain, selectedJourneyId]
  );

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

    const allScenarioIds = new Set();
    for (const domain of journeysTree) {
      for (const journey of domain?.journeys || []) {
        const entries = collectScenarioEntriesFromSteps(journey?.steps || []);
        for (const entry of entries) {
          allScenarioIds.add(entry.id);
        }
      }
    }

    const domainScenarioIds = new Set();
    const domainCriticalIds = new Set();
    for (const journey of selectedDomain?.journeys || []) {
      const entries = collectScenarioEntriesFromSteps(journey?.steps || []);
      for (const entry of entries) {
        domainScenarioIds.add(entry.id);
        if (entry.critical) domainCriticalIds.add(entry.id);
      }
    }

    const totalItems = domainScenarioIds.size;
    const criticalItems = domainCriticalIds.size;
    const coverage = allScenarioIds.size > 0
      ? Math.min(100, Math.round((totalItems / allScenarioIds.size) * 100))
      : 0;

    return {
      totalItems,
      criticalItems,
      coverage,
      scenarioIds: Array.from(domainScenarioIds),
    };
  }, [journeysTree, selectedDomain]);

  async function loadJourneyStatus() {
    const response = await fetchJson('/api/qa-waves/journey-status');
    setJourneyStatus(Array.isArray(response.items) ? response.items : []);
  }

  async function loadStepStatus() {
    const params = new URLSearchParams();
    if (selectedJourneyId) params.set('journeyId', selectedJourneyId);
    const suffix = params.toString();
    const response = await fetchJson(`/api/qa-waves/step-status${suffix ? `?${suffix}` : ''}`);
    setStepStatus(Array.isArray(response.items) ? response.items : []);
  }

  async function loadAll() {
    setError('');
    try {
      const [journeysData, journeyStatusData] = await Promise.all([
        fetchJson('/api/qa-waves/journeys'),
        fetchJson('/api/qa-waves/journey-status'),
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
    if (selectedJourneyId) {
      loadStepStatus();
    }
  }, [selectedJourneyId]);

  async function enqueueScenarios(scenarioIds, successMessage) {
    const safeIds = Array.from(new Set((scenarioIds || []).filter(Boolean)));
    if (safeIds.length === 0) {
      setError('Nenhum cenario encontrado para execucao');
      return;
    }

    await fetchJson('/api/qa-waves/executions', {
      method: 'POST',
      body: JSON.stringify({ scenarioIds: safeIds }),
    });

    setSuccess(successMessage);
    await Promise.all([loadJourneyStatus(), loadStepStatus()]);
  }

  async function handleExecuteJourney() {
    setError('');
    setSuccess('');
    try {
      const scenarioIds = (selectedJourney?.steps || [])
        .flatMap((step) => step.subJourneys || [])
        .flatMap((subJourney) => subJourney.scenarios || [])
        .map((scenario) => scenario.id);

      await enqueueScenarios(scenarioIds, `Execucao da jornada ${selectedJourney?.journeyName || ''} enfileirada com sucesso`);
    } catch (err) {
      setError(err?.message || 'Falha ao enfileirar execucao da jornada');
    }
  }

  async function handleExecuteDomain() {
    setError('');
    setSuccess('');
    try {
      await enqueueScenarios(
        domainSummary.scenarioIds,
        `Execucao do dominio ${selectedDomain?.name || ''} enfileirada com sucesso`
      );
    } catch (err) {
      setError(err?.message || 'Falha ao enfileirar execucao do dominio');
    }
  }

  async function handleExecuteStep(stepId) {
    setError('');
    setSuccess('');
    try {
      const step = (selectedJourney?.steps || []).find((item) => item.stepId === stepId);
      const scenarioIds = (step?.subJourneys || [])
        .flatMap((subJourney) => subJourney.scenarios || [])
        .map((scenario) => scenario.id);

      await enqueueScenarios(scenarioIds, `Execucao do passo ${step?.stepName || stepId} enfileirada com sucesso`);
    } catch (err) {
      setError(err?.message || 'Falha ao enfileirar execucao do passo');
    }
  }

  async function handleExecuteScenario(scenarioId) {
    setError('');
    setSuccess('');
    try {
      await enqueueScenarios([scenarioId], `Execucao do cenario ${scenarioId} enfileirada com sucesso`);
    } catch (err) {
      setError(err?.message || 'Falha ao enfileirar execucao do cenario');
    }
  }

  async function handleReplayDetails(replayId) {
    setError('');
    try {
      const response = await fetchJson(`/api/qa-waves/replays/${encodeURIComponent(replayId)}`);
      setDetails(response);
    } catch (err) {
      setError(err?.message || 'Falha ao carregar detalhes do replay');
    }
  }

  async function handleScenarioReplayDetails(scenarioId) {
    setError('');
    const scenarioKey = String(scenarioId || '');
    if (!scenarioKey) {
      setError('Cenario invalido para replay');
      return;
    }

    try {
      const params = new URLSearchParams();
      params.set('page', '1');
      params.set('pageSize', '100');
      params.set('sortBy', 'startedAt');
      params.set('sortDir', 'desc');
      const response = await fetchJson(`/api/qa-waves/replays?${params.toString()}`);
      const items = Array.isArray(response.items) ? response.items : [];
      const candidate = items.find((item) => String(item.itemId || item.scenarioId || '') === scenarioKey);

      if (!candidate?.id) {
        setError(`Nenhum replay encontrado para o cenario ${scenarioKey}`);
        return;
      }

      await handleReplayDetails(candidate.id);
    } catch (err) {
      setError(err?.message || 'Falha ao carregar replay do cenario');
    }
  }

  function handleSelectJourney(domainId, journeyId) {
    setSelectedDomainId(domainId);
    setSelectedJourneyId(journeyId);
  }

  return (
    <div className="qa-waves-page">
      <header className="qa-waves-header">
        <h1 className="qa-waves-title">QA Waves Integrado</h1>
        <p className="qa-waves-subtitle">
          Opera na mesma API e frontend do r-agent2, sem porta adicional.
        </p>
      </header>

      {error ? <div className="qa-waves-feedback error">{error}</div> : null}
      {success ? <div className="qa-waves-feedback success">{success}</div> : null}

      <div className="qa-waves-business-main">
        <section className="qa-waves-panel qa-waves-business-sidebar">
          <h2 className="qa-waves-section-title">Dominio e Jornada</h2>
          <JourneyTree
            domains={treeForSidebar}
            selectedDomainId={selectedDomainId}
            selectedJourneyId={selectedJourneyId}
            onSelectJourney={handleSelectJourney}
          />
        </section>

        <section className="qa-waves-panel qa-waves-business-content">
          <div className="qa-journey-actions">
            <h2 className="qa-waves-section-title">Visao de Jornada</h2>
            <div className="qa-journey-actions-buttons">
              <button type="button" onClick={handleExecuteDomain} disabled={!selectedDomain || domainSummary.totalItems === 0}>
                Executar dominio (equivalente Wave)
              </button>
              <button type="button" onClick={handleExecuteJourney} disabled={!selectedJourney}>
                Executar jornada inteira
              </button>
            </div>
          </div>
          <article className="qa-domain-summary-card">
            <h3>Resumo consolidado do dominio</h3>
            <div className="qa-domain-summary-metrics">
              <div>
                <strong>{domainSummary.totalItems}</strong>
                <span>Itens</span>
              </div>
              <div>
                <strong>{domainSummary.criticalItems}</strong>
                <span>Criticos</span>
              </div>
              <div>
                <strong>{domainSummary.coverage}%</strong>
                <span>Coverage</span>
              </div>
            </div>
          </article>
          <JourneyStatusCard journey={selectedJourney} stepStatuses={selectedJourney?.steps || []} />
          <StepBreakdown
            steps={selectedJourney?.steps || []}
            onExecuteStep={handleExecuteStep}
            onExecuteScenario={handleExecuteScenario}
            onReplayScenario={handleScenarioReplayDetails}
          />
        </section>
      </div>

      <ReplayDetailsModal details={details} onClose={() => setDetails(null)} />
    </div>
  );
}

export default QaWavesPage;
