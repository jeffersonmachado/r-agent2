import React, { useEffect, useMemo, useState } from 'react';
import { CrudPageBase } from '../modules/crud-base';
import { useToast } from '../components/Toast';
import { getDemoState, runDemoFlow } from '../api/demo';
import { WorkspaceTimeline } from '../modules/workspace/WorkspaceTimeline';
import { WorkspaceInsights } from '../modules/workspace/WorkspaceInsights';
import {
  DEMO_OPERATIONAL_SUBTITLE,
  DEMO_TECHNICAL_SUBTITLE,
  DemoDevDetailsModal,
  DemoDevQaSection,
  DemoDevReplayBadge,
  getDemoJourneyStage,
  getDemoReplayDetails,
} from '../components/qa-waves/DemoDevSurface';
import {
  AIInsightsMiniCard,
  TicketSummaryCard,
  CustomerHistoryCard,
  JourneyMiniCard,
  QuickActionsPanel,
} from '../components/support/attendance';
import { CrmBadge, CrmCard } from '../components/crm';
import { useAuth } from '../context/authContext';
import { getAgentClassification } from '../utils/classification';

function normalizeVertical(value) {
  return String(value || '').toLowerCase() === 'beauty' ? 'beauty' : 'fitness';
}

function parseVerticalFromLocation() {
  if (typeof window === 'undefined') return 'fitness';
  const params = new URLSearchParams(window.location.search || '');
  return normalizeVertical(params.get('vertical') || 'fitness');
}

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('pt-BR');
  } catch {
    return String(value);
  }
}

function toTicketSummary(ticket) {
  if (!ticket) return null;
  return {
    id: ticket.id || '-',
    date: ticket.updatedAt || ticket.createdAt || null,
    contact: ticket.contactName || ticket.customerName || ticket.phoneNumber || '-',
    channel: ticket.channelType || ticket.channel || '-',
    queue: ticket.queue || '-',
    status: ticket.status || '-',
    reason: ticket.reason || ticket.context?.closeReasonName || '-',
  };
}

function toCustomerSummary(ticket, lead) {
  return {
    name: lead?.name || ticket?.contactName || ticket?.customerName || 'Nao identificado',
    phone: lead?.phone || ticket?.phoneNumber || ticket?.phone || '-',
    document: '-',
    socialName: '-',
  };
}

export function DemoPage() {
  const { agent } = useAuth();
  // Superfícies técnicas da demo (diagnóstico de plataforma) só aparecem
  // para engenharia. A demo operacional mostra apenas linguagem PRODUCTION.
  const isDevelopment = getAgentClassification(agent) === 'DEVELOPMENT';
  const [vertical, setVertical] = useState(parseVerticalFromLocation());
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [activeReplayDetails, setActiveReplayDetails] = useState(null);
  const [lastExecution, setLastExecution] = useState(null);

  const { showToast, ToastContainer } = useToast();

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const payload = await getDemoState({ vertical });
        if (!mounted) return;
        setState(payload);
      } catch (err) {
        if (!mounted) return;
        setError(err?.message || 'Falha ao carregar demo comercial');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [vertical]);

  function updateVertical(nextVertical) {
    const normalized = normalizeVertical(nextVertical);
    setVertical(normalized);

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search || '');
      params.set('vertical', normalized);
      const query = params.toString();
      const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
      window.history.replaceState({}, '', nextUrl);
    }
  }

  async function handleRunDemo() {
    setRunning(true);
    try {
      const response = await runDemoFlow({ vertical });
      setLastExecution(response?.execution || null);
      showToast(`Demo enfileirada com executionId=${response?.execution?.executionId || 'n/a'}`, 'success');
    } catch (err) {
      showToast(err?.message || 'Falha ao enfileirar demo', 'error');
    } finally {
      setRunning(false);
    }
  }

  const ticketSummary = useMemo(() => toTicketSummary(state?.support?.ticket), [state]);
  const firstLead = state?.crm?.leads?.[0] || null;
  const customerSummary = useMemo(
    () => toCustomerSummary(state?.support?.ticket, firstLead),
    [state, firstLead]
  );

  const quickActions = {
    onToggleMode: () => showToast('Modo de execucao disponivel no atendimento operacional.', 'info'),
    onOpenTemplate: () => showToast('Templates reutilizam o modulo de atendimento existente.', 'info'),
    onOpenAttachments: () => showToast('Anexos reutilizam pipeline de ticket.', 'info'),
    onOpenHistory: () => showToast('Historico consolidado no timeline comercial.', 'info'),
    onOpenSupport: () => showToast('Suporte usa o mesmo modulo /support.', 'info'),
    onOpenInternalNotes: () => showToast('Notas internas em backlog de demo.', 'info'),
  };

  return (
    <CrudPageBase title="Demo RAP" hideHeader>
      <div className="demo-page" data-testid="demo-page">
        <header className="demo-hero">
          <div>
            <span className="demo-overline">DEMO COMERCIAL UNIFICADA</span>
            <h1>{state?.executiveSummary?.title || 'RAP Commercial Demo'}</h1>
            <p>{isDevelopment
              ? (state?.executiveSummary?.subtitle || DEMO_TECHNICAL_SUBTITLE)
              : DEMO_OPERATIONAL_SUBTITLE}</p>
          </div>
          <div className="demo-hero-actions">
            <div className="demo-vertical-switch" role="group" aria-label="Selecionar vertical da demo">
              <button
                type="button"
                className={vertical === 'fitness' ? 'is-active' : ''}
                onClick={() => updateVertical('fitness')}
              >
                Fitness
              </button>
              <button
                type="button"
                className={vertical === 'beauty' ? 'is-active' : ''}
                onClick={() => updateVertical('beauty')}
              >
                Beauty
              </button>
            </div>
            <button type="button" className="demo-run-button" onClick={handleRunDemo} disabled={running}>
              {running ? 'Executando...' : 'Executar fluxo demo'}
            </button>
          </div>
        </header>

        <section className="demo-indicators" aria-label="Indicadores de resultado">
          <article className="demo-kpi"><span>Leads gerados</span><strong>{state?.indicators?.leadsGenerated ?? '-'}</strong></article>
          <article className="demo-kpi"><span>Tickets criados</span><strong>{state?.indicators?.ticketsCreated ?? '-'}</strong></article>
          <article className="demo-kpi"><span>SLA</span><strong>{state?.indicators?.sla ?? '-'}</strong></article>
          <article className="demo-kpi"><span>IA confidence</span><strong>{state?.indicators?.iaConfidence ?? '-'}</strong></article>
          {isDevelopment ? (
            <article className="demo-kpi"><span>QA health</span><strong>{state?.indicators?.qaHealth ?? '-'}</strong></article>
          ) : null}
          <article className="demo-kpi"><span>ROI estimado</span><strong>{state?.indicators?.roiEstimated ?? '-'}</strong></article>
        </section>

        {loading ? <p className="demo-feedback">Carregando estado consolidado da demo...</p> : null}
        {error ? <p className="demo-feedback demo-feedback--error">{error}</p> : null}

        {!loading && !error ? (
          <>
            <section className="demo-grid demo-grid--support">
              <TicketSummaryCard ticket={ticketSummary} formatDate={formatDate} />
              <CustomerHistoryCard customer={customerSummary} />
              <JourneyMiniCard
                journey={{
                  name: state?.journey?.active?.journeyName || state?.seed?.journey?.name || '-',
                  stage: getDemoJourneyStage(state, isDevelopment),
                  nextStage: state?.seed?.expectedOutcome?.nextStage || '-',
                }}
                execution={{
                  flow: state?.automation?.outcome || '-',
                  step: state?.seed?.expectedOutcome?.automationStep || '-',
                }}
              />
              <AIInsightsMiniCard
                ai={{
                  intent: state?.ai?.intent || '-',
                  confidence: state?.ai?.confidence || '-',
                  nextBestAction: state?.ai?.nextBestAction || '-',
                }}
                execution={{ mode: state?.automation?.mode || '-' }}
                onReplay={isDevelopment ? () => setActiveReplayDetails(getDemoReplayDetails(state)) : undefined}
                onTestFlow={isDevelopment ? handleRunDemo : undefined}
              />
              <QuickActionsPanel executionMode={state?.automation?.mode || 'Bot'} {...quickActions} />
            </section>

            {isDevelopment ? (
              <DemoDevQaSection state={state} showToast={showToast} />
            ) : null}

            <section className="demo-grid demo-grid--workspace">
              <WorkspaceTimeline timeline={state?.timeline || { items: [] }} loading={false} classification={getAgentClassification(agent)} onLoadMore={() => {}} />
              <WorkspaceInsights
                insights={{
                  items: [
                    {
                      type: 'next_best_action',
                      severity: 'normal',
                      confidence: Number(String(state?.indicators?.iaConfidence || '0').replace(/[^0-9]/g, '')) / 100 || 0.8,
                      source: 'demo-orchestrator',
                      description: state?.ai?.nextBestAction || 'Executar proxima etapa comercial',
                    },
                  ],
                  persisted: state?.workspace?.insights?.persisted || [],
                }}
                loading={false}
              />
            </section>

            <section className="demo-grid demo-grid--crm">
              <CrmCard>
                <h3 className="demo-card-title">CRM</h3>
                <p className="demo-card-subtitle">Leads, contatos e oportunidades reutilizando o modulo existente.</p>
                <div className="demo-badges">
                  <CrmBadge label={`Leads ${state?.crm?.leadCount ?? 0}`} variant="info" />
                  <CrmBadge label={`Conversao ${state?.indicators?.conversion || '-'}`} variant="success" />
                  {isDevelopment ? (
                    <DemoDevReplayBadge indicators={state?.indicators} />
                  ) : null}
                </div>
                <ul className="demo-simple-list">
                  {(state?.crm?.leads || []).slice(0, 5).map((lead) => (
                    <li key={lead.id || lead.email || lead.phone}>
                      <span>{lead.name || 'Lead sem nome'}</span>
                      <small>{lead.stage || 'new'}{lead.score ? ` • score ${lead.score}` : ''}</small>
                    </li>
                  ))}
                </ul>
              </CrmCard>

              <CrmCard>
                <h3 className="demo-card-title">Automacao e resultado</h3>
                <div className="demo-list">
                  <div><span>Modo</span><strong>{state?.automation?.mode || '-'}</strong></div>
                  <div><span>Automacoes executadas</span><strong>{state?.automation?.automationsExecuted ?? '-'}</strong></div>
                  <div><span>Resultado operacional</span><strong>{state?.automation?.outcome || '-'}</strong></div>
                  <div><span>Ultima execution</span><strong>{lastExecution?.executionId || '-'}</strong></div>
                </div>
              </CrmCard>
            </section>
          </>
        ) : null}

        {isDevelopment ? (
          <DemoDevDetailsModal
            details={activeReplayDetails}
            onClose={() => setActiveReplayDetails(null)}
          />
        ) : null}

        <ToastContainer />
      </div>
    </CrudPageBase>
  );
}

export default DemoPage;
