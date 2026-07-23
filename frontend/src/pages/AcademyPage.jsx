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
  const { isAuthenticated } = useAuth();
  const [data, setData] = useState(null);
  const [skillGraph, setSkillGraph] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [competencies, graph] = await Promise.all([
        academyApi.getMyCompetencies(),
        academyApi.getSkillGraph().catch((graphError) => {
          logger.warn('[AcademyPage] skill-graph indisponível', graphError);
          return null;
        }),
      ]);
      setData(competencies);
      setSkillGraph(graph);
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
    </div>
  );
}
