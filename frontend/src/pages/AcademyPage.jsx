/**
 * RAP Academy — evolução e competências do usuário (read-only).
 *
 * NÃO é um LMS: apenas apresenta o que o Learning Core já observou —
 * competências por skill (score + componentes + evidências do ledger),
 * perfil (skills dominantes/fracas) e recálculo sob demanda.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/authContext';
import * as academyApi from '../api/academy';
import { ManualsTab } from '../components/academy/ManualsTab';
import { JourneyFaqTab } from '../components/academy/JourneyFaqTab';
import { Button } from '../styles/Button';
import logger from '../utils/logger';
import './AcademyPage.css';

const COMPONENT_LABELS = {
  precision: 'Precisão',
  autonomia: 'Autonomia',
  coverage: 'Cobertura',
  tempo: 'Ritmo',
  consistencia: 'Consistência',
};

function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  return `${Math.round(value * 100)}%`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR');
}

function ScoreBar({ value }) {
  const pct = value === null || value === undefined ? 0 : Math.round(value * 100);
  const tone = pct >= 70 ? 'high' : pct >= 40 ? 'mid' : 'low';
  return (
    <div className="academy-score-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`academy-score-bar-fill academy-score-${tone}`} style={{ width: `${pct}%` }} />
      <span className="academy-score-bar-label">{formatPercent(value)}</span>
    </div>
  );
}

export function AcademyPage() {
  const { isAuthenticated, agent } = useAuth();
  const isAdmin = ['owner', 'admin', 'super_admin'].includes(agent && agent.role);
  const [data, setData] = useState(null);
  const [skillGraph, setSkillGraph] = useState(null);
  const [missions, setMissions] = useState(null);
  const [simulations, setSimulations] = useState(null);
  const [certifications, setCertifications] = useState(null);
  const [mentorPlan, setMentorPlan] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [activeTab, setActiveTab] = useState('competencias');
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [completingId, setCompletingId] = useState(null);
  const [evaluating, setEvaluating] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [planError, setPlanError] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [competencies, graph, missionData, simulationData, certificationData, mentorData] = await Promise.all([
        academyApi.getMyCompetencies(),
        academyApi.getSkillGraph().catch((graphError) => {
          logger.warn('[AcademyPage] skill-graph indisponível', graphError);
          return null;
        }),
        academyApi.getMyMissions().catch((missionError) => {
          logger.warn('[AcademyPage] missões indisponíveis', missionError);
          return { missions: [] };
        }),
        academyApi.getSimulations().catch((simulationError) => {
          logger.warn('[AcademyPage] simulações indisponíveis', simulationError);
          return { simulations: [] };
        }),
        academyApi.getMyCertifications().catch((certError) => {
          logger.warn('[AcademyPage] certificações indisponíveis', certError);
          return { certifications: [] };
        }),
        academyApi.getMentorPlan().catch((mentorError) => {
          logger.warn('[AcademyPage] plano do mentor indisponível', mentorError);
          return { plan: null };
        }),
      ]);
      setData(competencies);
      setSkillGraph(graph);
      setMissions(missionData.missions || []);
      setSimulations(simulationData.simulations || []);
      setCertifications(certificationData.certifications || []);
      setMentorPlan(mentorData.plan || null);
    } catch (loadError) {
      logger.error('[AcademyPage] falha ao carregar competências', loadError);
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) load();
  }, [isAuthenticated, load]);

  useEffect(() => {
    if (!isAdmin || activeTab !== 'analytics' || analytics) return;
    academyApi.getAnalyticsOverview()
      .then(setAnalytics)
      .catch((analyticsError) => {
        logger.warn('[AcademyPage] analytics indisponível', analyticsError);
      });
  }, [isAdmin, activeTab, analytics]);

  const handleRecompute = useCallback(async () => {
    setRecomputing(true);
    try {
      await academyApi.recomputeCompetencies();
      await load();
    } catch (recomputeError) {
      logger.error('[AcademyPage] falha ao recalcular', recomputeError);
      setError(recomputeError);
    } finally {
      setRecomputing(false);
    }
  }, [load]);

  const handleCompleteMission = useCallback(async (missionId) => {
    setCompletingId(missionId);
    try {
      await academyApi.completeMission(missionId);
      const missionData = await academyApi.getMyMissions();
      setMissions(missionData.missions || []);
    } catch (completeError) {
      logger.error('[AcademyPage] falha ao concluir missão', completeError);
    } finally {
      setCompletingId(null);
    }
  }, []);

  const handleEvaluateCertifications = useCallback(async () => {
    setEvaluating(true);
    try {
      await academyApi.evaluateCertifications();
      const certificationData = await academyApi.getMyCertifications();
      setCertifications(certificationData.certifications || []);
    } catch (evalError) {
      logger.error('[AcademyPage] falha ao avaliar certificações', evalError);
    } finally {
      setEvaluating(false);
    }
  }, []);

  const handleGeneratePlan = useCallback(async () => {
    setGeneratingPlan(true);
    setPlanError(null);
    try {
      const plan = await academyApi.generateMentorPlan();
      setMentorPlan(plan);
    } catch (planErr) {
      logger.error('[AcademyPage] falha ao gerar plano', planErr);
      setPlanError(planErr);
    } finally {
      setGeneratingPlan(false);
    }
  }, []);

  const skillLabels = React.useMemo(() => {
    const map = {};
    for (const skill of (skillGraph && skillGraph.skills) || []) {
      map[skill.key] = skill.label || skill.key;
    }
    return map;
  }, [skillGraph]);

  const profile = data && data.profile;
  const competencies = (data && data.competencies) || [];

  return (
    <div className="academy-page">
      <header className="academy-header">
        <div>
          <h1>RAP Academy</h1>
          <p className="academy-subtitle">
            Suas competências operacionais, medidas por evidência enquanto você trabalha.
          </p>
        </div>
        <div className="academy-header-actions">
          <span className="academy-computed-at">Atualizado em {formatDate(data && data.computedAt)}</span>
          <Button onClick={handleRecompute} disabled={recomputing || loading}>
            {recomputing ? 'Recalculando…' : 'Recalcular agora'}
          </Button>
        </div>
      </header>

      {loading && <p className="academy-state">Carregando competências…</p>}
      {error && !loading && (
        <p className="academy-state academy-state-error">
          Não foi possível carregar suas competências agora. Tente novamente.
        </p>
      )}

      {!loading && !error && (
        <>
          <nav className="academy-tabs" aria-label="Seções da Academy">
            {[
              ['competencias', 'Competências'],
              ['missoes', `Missões${missions ? ` (${missions.filter((m) => m.status !== 'completed').length})` : ''}`],
              ['simulacoes', `Simulações${simulations ? ` (${simulations.length})` : ''}`],
              ['certificacoes', `Certificações${certifications ? ` (${certifications.filter((c) => c.status === 'active').length})` : ''}`],
              ['plano', 'Plano de evolução'],
              ['manuais', 'Manuais'],
              ['faq', 'Perguntas & Respostas'],
              ...(isAdmin ? [['analytics', 'Analytics']] : []),
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`academy-tab${activeTab === key ? ' academy-tab-active' : ''}`}
                onClick={() => setActiveTab(key)}
              >
                {label}
              </button>
            ))}
          </nav>

          {activeTab === 'competencias' && (
          <>
          {profile && (
            <section className="academy-profile" aria-label="Perfil de aprendizado">
              <div className="academy-profile-card">
                <h2>Resumo</h2>
                <p>
                  {profile.totals?.skills || 0} skill(s) observadas · {profile.totals?.events || 0} interações
                  {profile.totals?.averageScore !== null && profile.totals?.averageScore !== undefined
                    ? ` · score médio ${formatPercent(profile.totals.averageScore)}`
                    : ''}
                </p>
              </div>
              <div className="academy-profile-card">
                <h2>Domina</h2>
                {profile.dominantSkills?.length ? (
                  <ul>
                    {profile.dominantSkills.map((skill) => (
                      <li key={skill.skillKey}>
                        {skillLabels[skill.skillKey] || skill.skillKey} — {formatPercent(skill.score)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="academy-muted">Ainda sem dados suficientes (mín. 10 interações por skill).</p>
                )}
              </div>
              <div className="academy-profile-card">
                <h2>Em desenvolvimento</h2>
                {profile.weakSkills?.length ? (
                  <ul>
                    {profile.weakSkills.map((skill) => (
                      <li key={skill.skillKey}>
                        {skillLabels[skill.skillKey] || skill.skillKey} — {formatPercent(skill.score)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="academy-muted">Nenhuma skill abaixo de 50% com evidência suficiente.</p>
                )}
              </div>
            </section>
          )}

          <section aria-label="Competências por skill">
            <h2 className="academy-section-title">Competências por skill</h2>
            {competencies.length === 0 ? (
              <p className="academy-state">
                Ainda não há interações suficientes registradas. Use a plataforma normalmente —
                as competências aparecem aqui automaticamente.
              </p>
            ) : (
              <div className="academy-skills-grid">
                {competencies.map((competency) => (
                  <article key={competency.skillKey} className="academy-skill-card" data-testid={`skill-card-${competency.skillKey}`}>
                    <header>
                      <h3>{skillLabels[competency.skillKey] || competency.skillKey}</h3>
                      <span className="academy-muted">{competency.eventCount} interações</span>
                    </header>
                    <ScoreBar value={competency.score} />
                    <dl className="academy-components">
                      {Object.entries(COMPONENT_LABELS).map(([key, label]) => (
                        <div key={key}>
                          <dt>{label}</dt>
                          <dd>{formatPercent(competency.components?.[key])}</dd>
                        </div>
                      ))}
                    </dl>
                    {competency.evidenceRefs?.length > 0 && (
                      <details className="academy-evidence">
                        <summary>{competency.evidenceRefs.length} evidência(s) no ledger</summary>
                        <ul>
                          {competency.evidenceRefs.map((ref) => (
                            <li key={ref}><code>{ref}</code></li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <footer className="academy-muted">
                      Última atividade: {formatDate(competency.lastSeenAt)}
                    </footer>
                  </article>
                ))}
              </div>
            )}
          </section>
          </>
          )}

          {activeTab === 'missoes' && (
            <section aria-label="Missões de treinamento">
              <h2 className="academy-section-title">Missões de treinamento</h2>
              {!missions || missions.length === 0 ? (
                <p className="academy-state">
                  Nenhuma missão disponível ainda. Missões são geradas a partir de replays
                  operacionais reais (anonimizados) pela administração da plataforma.
                </p>
              ) : (
                <div className="academy-missions-list">
                  {missions.map((mission) => (
                    <article key={mission.id} className="academy-mission-card" data-testid={`mission-${mission.id}`}>
                      <div className="academy-mission-body">
                        <h3>{mission.title}</h3>
                        {mission.summary && <p className="academy-muted">{mission.summary}</p>}
                        {mission.completedAt && (
                          <p className="academy-muted">Concluída em {formatDate(mission.completedAt)}</p>
                        )}
                      </div>
                      <div className="academy-mission-actions">
                        {mission.status === 'completed' ? (
                          <span className="academy-mission-done">Concluída ✓</span>
                        ) : (
                          <Button
                            onClick={() => handleCompleteMission(mission.id)}
                            disabled={completingId === mission.id}
                          >
                            {completingId === mission.id ? 'Concluindo…' : 'Marcar como concluída'}
                          </Button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTab === 'simulacoes' && (
            <section aria-label="Simulações">
              <h2 className="academy-section-title">Simulações</h2>
              {!simulations || simulations.length === 0 ? (
                <p className="academy-state">
                  Nenhuma simulação gerada ainda. Simulações são cenários sintéticos
                  (persona × tipo de cenário × jornada) — nunca usam dados reais.
                </p>
              ) : (
                <div className="academy-skills-grid">
                  {simulations.map((simulation) => (
                    <article key={simulation.id} className="academy-skill-card" data-testid={`simulation-${simulation.id}`}>
                      <header>
                        <h3>{simulation.journeyKey}</h3>
                        <span className="academy-muted">{simulation.seedType}</span>
                      </header>
                      <p className="academy-muted">{simulation.descricao}</p>
                      <footer className="academy-muted">
                        persona {simulation.personaKey} · {simulation.steps} passos
                        {simulation.aiEnriched ? ' · enriquecida por IA' : ''}
                        {' '}· {formatDate(simulation.createdAt)}
                      </footer>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
          {activeTab === 'certificacoes' && (
            <section aria-label="Certificações">
              <div className="academy-section-header">
                <h2 className="academy-section-title">Certificações por competência comprovada</h2>
                <Button onClick={handleEvaluateCertifications} disabled={evaluating}>
                  {evaluating ? 'Avaliando…' : 'Avaliar agora'}
                </Button>
              </div>
              <p className="academy-muted">
                Certificações são emitidas automaticamente quando todos os critérios de evidência
                (precisão, ritmo, autonomia, consistência e recuperação) atingem o threshold — nunca
                por tempo ou presença. Erros novos em uma skill certificada revogam a certificação (drift).
              </p>
              {!certifications || certifications.length === 0 ? (
                <p className="academy-state">
                  Nenhuma certificação ainda. Continue operando — quando houver evidência suficiente,
                  a certificação aparece aqui automaticamente.
                </p>
              ) : (
                <div className="academy-skills-grid">
                  {certifications.map((certification) => (
                    <article key={certification.id} className="academy-skill-card" data-testid={`certification-${certification.skillKey}`}>
                      <header>
                        <h3>{skillLabels[certification.skillKey] || certification.skillKey}</h3>
                        <span className={certification.status === 'active' ? 'academy-cert-active' : 'academy-cert-revoked'}>
                          {certification.status === 'active' ? 'Ativa' : 'Revogada'}
                        </span>
                      </header>
                      <dl className="academy-components">
                        <div><dt>Precisão</dt><dd>{formatPercent(certification.assessmentSnapshot?.criteria?.precisao)}</dd></div>
                        <div><dt>Autonomia</dt><dd>{formatPercent(certification.assessmentSnapshot?.criteria?.autonomia)}</dd></div>
                        <div><dt>Recuperação</dt><dd>{formatPercent(certification.assessmentSnapshot?.criteria?.recuperacao)}</dd></div>
                      </dl>
                      {certification.evidenceRefs?.length > 0 && (
                        <details className="academy-evidence">
                          <summary>{certification.evidenceRefs.length} evidência(s) no ledger</summary>
                          <ul>
                            {certification.evidenceRefs.map((ref) => (
                              <li key={ref}><code>{ref}</code></li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <footer className="academy-muted">
                        Emitida em {formatDate(certification.issuedAt)}
                        {certification.revokedAt ? ` · revogada em ${formatDate(certification.revokedAt)}` : ''}
                      </footer>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTab === 'plano' && (
            <section aria-label="Plano de evolução">
              <div className="academy-section-header">
                <h2 className="academy-section-title">Plano de evolução (Mentor)</h2>
                <Button onClick={handleGeneratePlan} disabled={generatingPlan}>
                  {generatingPlan ? 'Gerando…' : 'Gerar novo plano'}
                </Button>
              </div>
              {planError && (
                <p className="academy-state academy-state-error">
                  Não foi possível gerar o plano agora (IA indisponível). Tente novamente mais tarde.
                </p>
              )}
              {!mentorPlan ? (
                <p className="academy-state">
                  Nenhum plano gerado ainda. O Mentor analisa suas janelas de 7/30/90 dias
                  e sugere competências, objetivos e indicadores.
                </p>
              ) : (
                <>
                  {mentorPlan.aggregates?.windows && (
                    <section className="academy-profile" aria-label="Janelas de análise">
                      {mentorPlan.aggregates.windows.map((window) => (
                        <div key={window.days} className="academy-profile-card">
                          <h2>Últimos {window.days} dias</h2>
                          <p>
                            {window.events} interações · {window.errors} erros
                            {window.errorRate !== null ? ` (${formatPercent(window.errorRate)})` : ''}
                            {' '}· {window.flowsCompleted} fluxos concluídos
                          </p>
                        </div>
                      ))}
                    </section>
                  )}
                  <div className="academy-skills-grid">
                    {mentorPlan.plan?.resumo && (
                      <article className="academy-skill-card">
                        <h3>Resumo</h3>
                        <p className="academy-muted">{mentorPlan.plan.resumo}</p>
                      </article>
                    )}
                    {Array.isArray(mentorPlan.plan?.competenciasSugeridas) && mentorPlan.plan.competenciasSugeridas.length > 0 && (
                      <article className="academy-skill-card">
                        <h3>Competências sugeridas</h3>
                        <ul>
                          {mentorPlan.plan.competenciasSugeridas.map((item, index) => (
                            <li key={index}>
                              {skillLabels[item.skill] || item.skill}
                              {item.motivo ? ` — ${item.motivo}` : ''}
                            </li>
                          ))}
                        </ul>
                      </article>
                    )}
                    {Array.isArray(mentorPlan.plan?.objetivos) && mentorPlan.plan.objetivos.length > 0 && (
                      <article className="academy-skill-card">
                        <h3>Objetivos</h3>
                        <ul>
                          {mentorPlan.plan.objetivos.map((item, index) => (
                            <li key={index}>
                              {item.descricao}
                              {item.prazoDias ? ` (${item.prazoDias} dias)` : ''}
                            </li>
                          ))}
                        </ul>
                      </article>
                    )}
                    {Array.isArray(mentorPlan.plan?.indicadores) && mentorPlan.plan.indicadores.length > 0 && (
                      <article className="academy-skill-card">
                        <h3>Indicadores</h3>
                        <ul>
                          {mentorPlan.plan.indicadores.map((item, index) => (
                            <li key={index}>{item.nome}: {item.meta}</li>
                          ))}
                        </ul>
                      </article>
                    )}
                  </div>
                  <p className="academy-muted">Gerado em {formatDate(mentorPlan.generatedAt)}</p>
                </>
              )}
            </section>
          )}

          {activeTab === 'manuais' && (
            <ManualsTab isAdmin={isAdmin} />
          )}

          {activeTab === 'faq' && (
            <JourneyFaqTab isAdmin={isAdmin} />
          )}

          {activeTab === 'analytics' && isAdmin && (
            <section aria-label="Analytics de aprendizado">
              <h2 className="academy-section-title">Analytics de aprendizado (tenant)</h2>
              {!analytics ? (
                <p className="academy-state">Carregando analytics…</p>
              ) : (
                <>
                  <section className="academy-profile" aria-label="Visão geral">
                    <div className="academy-profile-card">
                      <h2>Usuários</h2>
                      <p>{analytics.users} com competências · score médio {formatPercent(analytics.avgScore)}</p>
                    </div>
                    <div className="academy-profile-card">
                      <h2>Certificações</h2>
                      <p>{analytics.certifications?.active || 0} ativas · {analytics.certifications?.revoked || 0} revogadas</p>
                    </div>
                    <div className="academy-profile-card">
                      <h2>Missões</h2>
                      <p>{analytics.missions?.completed || 0} de {analytics.missions?.total || 0} concluídas</p>
                    </div>
                    <div className="academy-profile-card">
                      <h2>Tutor (30d)</h2>
                      <p>{analytics.tutorHints30d || 0} dicas emitidas</p>
                    </div>
                  </section>

                  {analytics.roi && (
                    <section aria-label="ROI">
                      <h2 className="academy-section-title">ROI (últimos {analytics.roi.windowDays}d vs período anterior)</h2>
                      <section className="academy-profile">
                        <div className="academy-profile-card">
                          <h2>Taxa de erro</h2>
                          <p>
                            {formatPercent(analytics.roi.previous?.errorRate)} → {formatPercent(analytics.roi.current?.errorRate)}
                            {analytics.roi.errorRateDelta !== null && (
                              <span className={analytics.roi.errorRateDelta < 0 ? 'academy-cert-active' : 'academy-cert-revoked'}>
                                {' '}({analytics.roi.errorRateDelta < 0 ? '▼' : '▲'} {formatPercent(Math.abs(analytics.roi.errorRateDelta))})
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="academy-profile-card">
                          <h2>Tempo mediano por tela</h2>
                          <p>
                            {analytics.roi.previous?.medianNavigationMs ?? '—'}ms → {analytics.roi.current?.medianNavigationMs ?? '—'}ms
                            {analytics.roi.navigationMsDelta !== null && (
                              <span className={analytics.roi.navigationMsDelta < 0 ? 'academy-cert-active' : 'academy-cert-revoked'}>
                                {' '}({analytics.roi.navigationMsDelta < 0 ? '▼' : '▲'} {Math.abs(analytics.roi.navigationMsDelta)}ms)
                              </span>
                            )}
                          </p>
                        </div>
                      </section>
                    </section>
                  )}

                  <section aria-label="Skills do tenant">
                    <h2 className="academy-section-title">Skills do tenant</h2>
                    <div className="academy-skills-grid">
                      {(analytics.skills || []).map((skill) => (
                        <article key={skill.skillKey} className="academy-skill-card">
                          <header>
                            <h3>{skillLabels[skill.skillKey] || skill.skillKey}</h3>
                            <span className="academy-muted">{skill.users} usuário(s)</span>
                          </header>
                          <ScoreBar value={skill.avgScore} />
                          <footer className="academy-muted">
                            {skill.activeCertifications} certificação(ões) ativa(s)
                          </footer>
                        </article>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
