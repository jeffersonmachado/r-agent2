import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../api/client';
import './QaGapsPage.css';

function normalizeCoverageRows(coverage = {}) {
  return Object.entries(coverage).map(([capability, value]) => ({ capability, ...value }));
}

function formatReadableLabel(value, fallback = 'Registro') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;

  return raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function formatClosureStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'ready_to_automate') return 'Pronto para automatizar';
  if (normalized === 'has_blockers') return 'Com bloqueios';
  return formatReadableLabel(value, 'Indefinido');
}

function formatBlockerReason(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const blockers = {
    capability_sem_e2e: 'sem cobertura E2E',
    capability_sem_replay: 'sem replay validado',
    capability_sem_screenshots: 'sem evidência por captura de tela',
    capability_critica_sem_trace: 'capacidade crítica sem trace',
    capability_replay_desatualizado: 'replay desatualizado',
    capability_sem_validacao_operacional: 'sem validação operacional',
  };

  return blockers[normalized] || formatReadableLabel(value, 'Bloqueio não categorizado');
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(Math.round(number), 100));
}

function compactText(value, fallback = 'Indisponível') {
  const raw = String(value || '').trim();
  return raw || fallback;
}

function averageCoverage(coverage = {}) {
  const values = [
    coverage.transitionCoverage,
    coverage.stateValidationCoverage,
    coverage.sideEffectCoverage,
    coverage.operationalConsequenceCoverage,
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function toneForPercent(value) {
  const safeValue = formatPercent(value);
  if (safeValue >= 80) return 'success';
  if (safeValue >= 50) return 'warning';
  return 'danger';
}

function Icon({ name, className = '' }) {
  const common = {
    className,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  };

  const paths = {
    activity: <><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></>,
    alert: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
    check: <><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></>,
    chevron: <><path d="m6 9 6 6 6-6" /></>,
    circle: <><circle cx="12" cy="12" r="4" fill="currentColor" /></>,
    git: <><circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="M8.5 8.5 15.5 15.5" /><path d="M6 9v12" /></>,
    layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>,
    refresh: <><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="M12 8v4" /><path d="M12 16h.01" /></>,
    sparkles: <><path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></>,
    x: <><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></>,
    zap: <><path d="M13 2 3 14h8l-1 8 11-14h-8l1-6Z" /></>,
  };

  return <svg {...common}>{paths[name] || paths.circle}</svg>;
}

function Card({ children, className = '' }) {
  return <div className={`qg-card ${className}`.trim()}>{children}</div>;
}

function StatusDot({ ok }) {
  return (
    <span className={`qg-status-dot ${ok ? 'qg-tone-success' : 'qg-tone-danger'}`}>
      <Icon name={ok ? 'check' : 'x'} className="qg-icon qg-icon--sm" />
      {ok ? 'Sim' : 'Não'}
    </span>
  );
}

function ScoreRing({ value }) {
  const safeValue = formatPercent(value);
  const radius = 76;
  const circumference = 2 * Math.PI * radius;
  const tone = toneForPercent(safeValue);

  return (
    <div className="qg-score-ring">
      <svg className="qg-score-ring__svg" viewBox="0 0 176 176">
        <circle cx="88" cy="88" r={radius} className="qg-score-ring__track" strokeWidth="12" fill="none" />
        <circle
          cx="88"
          cy="88"
          r={radius}
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          className={`qg-score-ring__value qg-tone-${tone}`}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - safeValue / 100)}
        />
      </svg>
      <div className="qg-score-ring__label">
        <span>{safeValue}%</span>
        <small>cobertura geral</small>
      </div>
    </div>
  );
}

function SummaryMetric({ label, value, icon, tone = 'neutral', isText = false }) {
  return (
    <div className={`qg-summary-card qg-tone-${tone}`}>
      <div className="qg-summary-card__topline">
        <span>{label}</span>
        <Icon name={icon} className="qg-icon" />
      </div>
      <strong className={isText ? 'qg-summary-card__value qg-summary-card__value--text' : 'qg-summary-card__value'}>
        {value}
      </strong>
    </div>
  );
}

function CoverageMetric({ label, value }) {
  const number = formatPercent(value);
  const tone = toneForPercent(number);

  return (
    <Card className="qg-metric-card">
      <span className="qg-eyebrow">Cobertura</span>
      <span className="qg-muted">{label}</span>
      <div className="qg-metric-card__value">
        <strong className={`qg-tone-${tone}`}>{number}%</strong>
        <span>de 100%</span>
      </div>
      <progress className={`qg-progress qg-tone-${tone}`} max="100" value={Math.max(number, 4)} aria-label={`Cobertura ${label}`} />
    </Card>
  );
}

const DEFAULT_POLICY = { replayDays: 7, requireTrace: true, requireScreenshot: true };

function PolicyForm({ policy, onChange }) {
  return (
    <Card>
      <details className="qg-policy">
        <summary className="qg-policy__summary">
          <span>
            <Icon name="shield" className="qg-icon qg-tone-accent" />
            Política GO/NO_GO - ajustar parâmetros
          </span>
          <Icon name="chevron" className="qg-icon qg-policy__chevron" />
        </summary>
        <div className="qg-policy__body">
          <label className="qg-field">
            <span>Janela de replay (dias)</span>
            <input
              type="number"
              min={1}
              max={90}
              value={policy.replayDays}
              onChange={(event) => onChange({ ...policy, replayDays: Math.max(1, Number(event.target.value)) })}
            />
          </label>
          <label className="qg-check-field">
            <input
              type="checkbox"
              checked={policy.requireTrace}
              onChange={(event) => onChange({ ...policy, requireTrace: event.target.checked })}
            />
            <span>Exigir rastreio em capacidades críticas</span>
          </label>
          <label className="qg-check-field">
            <input
              type="checkbox"
              checked={policy.requireScreenshot}
              onChange={(event) => onChange({ ...policy, requireScreenshot: event.target.checked })}
            />
            <span>Exigir captura de tela em capacidades críticas</span>
          </label>
        </div>
      </details>
    </Card>
  );
}

function GapSection({ title, items }) {
  const list = Array.isArray(items) ? items : [];

  return (
    <Card className="qg-gap-card">
      <div className="qg-section-header">
        <h3>{title}</h3>
        <span className={`qg-pill ${list.length === 0 ? 'qg-tone-success' : 'qg-tone-warning'}`}>
          {list.length} {list.length === 1 ? 'item' : 'itens'}
        </span>
      </div>
      {list.length === 0 ? (
        <div className="qg-empty-state qg-tone-success">
          <Icon name="check" className="qg-icon" />
          Nenhum gap detectado
        </div>
      ) : (
        <ul className="qg-list qg-list--scroll">
          {list.slice(0, 40).map((item, index) => {
            const name = formatReadableLabel(item.capability || item.type || item.name || 'registro');
            const reason = item.gap || item.reason || item.message || 'gap';
            return (
              <li key={`${title}-${index}`} className="qg-list-item qg-list-item--split">
                <span>{name}</span>
                <code>{formatReadableLabel(reason)}</code>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function remediationTone(type) {
  if (type === 'E2E') return 'accent';
  if (type === 'Replay') return 'info';
  if (type === 'Validators') return 'warning';
  return 'neutral';
}

function AutoClosureSuggestions({ loading }) {
  const [suggestions, setSuggestions] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (loading) return;

    const loadSuggestions = async () => {
      try {
        const data = await fetchJson('/api/qa-waves/closure/analyze-gaps');
        setSuggestions(data);
      } catch (err) {
        setError(err?.message || 'Falha ao carregar sugestões');
      }
    };

    loadSuggestions();
  }, [loading]);

  if (!suggestions) return null;

  const { remediations = {}, closure = {} } = suggestions;
  const remediationItems = [
    ...(Array.isArray(remediations?.e2eScenarios) ? remediations.e2eScenarios.map((item) => ({
      type: 'E2E',
      label: `Adicionar E2E com uiSteps e validação de ${item.capability || item.name || 'cenário'}`,
    })) : []),
    ...(Array.isArray(remediations?.preflightSuggestions) ? remediations.preflightSuggestions.map((item) => ({
      type: 'Validators',
      label: `Incluir validators/evidências reais para ${item.capability || 'capacidade'}`,
    })) : []),
    ...(Array.isArray(remediations?.replayImprovements) ? remediations.replayImprovements.map((item) => ({
      type: 'Replay',
      label: item.action || `Gerar replay operacional para ${item.capability || item.type || 'capacidade'}`,
    })) : []),
  ].slice(0, 24);

  return (
    <Card className="qg-remediation">
      <div className="qg-remediation__header">
        <div className="qg-title-cluster">
          <div className="qg-icon-box qg-tone-accent">
            <Icon name="zap" className="qg-icon" />
          </div>
          <div>
            <p className="qg-eyebrow">Remediação automática</p>
            <h2>Sugestões autônomas de fechamento de gaps</h2>
          </div>
        </div>
        <span className="qg-pill qg-tone-warning">{formatClosureStatus(closure.closureStatus)}</span>
      </div>

      {error ? <p className="qg-error-text">{error}</p> : null}

      <div className="qg-remediation__stats">
        {[
          { label: 'Cenários para gerar', value: remediations?.scenarios?.length || 0, tone: 'accent' },
          { label: 'Cobertura de UI', value: remediations?.uiSteps?.coverage || 0, tone: 'success' },
          { label: 'Cobertura de validadores', value: remediations?.validators?.coverage || 0, tone: 'info' },
          { label: 'Potencial de automação', value: `${formatPercent(closure.automationPotential)}%`, tone: 'warning' },
        ].map((item) => (
          <div key={item.label} className="qg-stat">
            <span>{item.label}</span>
            <strong className={`qg-tone-${item.tone}`}>{item.value}</strong>
          </div>
        ))}
      </div>

      <div>
        <h3>Geração automática</h3>
        <ul className="qg-list qg-list--grid">
          {remediationItems.map((item, index) => (
            <li key={`${item.type}-${index}`} className="qg-list-item">
              <span className={`qg-chip qg-tone-${remediationTone(item.type)}`}>{item.type}</span>
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="qg-card-footer">
        <p>
          Status: <strong className={closure.closureStatus === 'ready_to_automate' ? 'qg-tone-success' : 'qg-tone-danger'}>
            {closure.closureStatus === 'ready_to_automate' ? 'Pronto' : 'Com bloqueios'}
          </strong>
        </p>
      </div>
    </Card>
  );
}

export function QaGapsPage() {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [policy, setPolicy] = useState(DEFAULT_POLICY);

  const loadReport = useCallback(async (recompute = false, customPolicy = null) => {
    setLoading(true);
    setError('');
    try {
      if (recompute) {
        const usedPolicy = customPolicy || policy;
        await fetchJson('/api/qa-waves/operational/recompute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            persist: true,
            policy: {
              requireFreshReplayDays: usedPolicy.replayDays,
              requireTraceForCritical: usedPolicy.requireTrace,
              requireScreenshotsForCritical: usedPolicy.requireScreenshot,
            },
          }),
        });
      }
      const data = await fetchJson('/api/qa-waves/operational/summary');
      setReport(data);
    } catch (err) {
      setError(err?.message || 'Falha ao carregar gaps operacionais');
    } finally {
      setLoading(false);
    }
  }, [policy]);

  useEffect(() => {
    loadReport(false);
  }, [loadReport]);

  const coverageRows = useMemo(() => normalizeCoverageRows(report?.coverage), [report]);
  const finalCoverage = report?.finalCoverage || report?.governance?.coverage || {};
  const summary = report?.summary || {};
  const goNoGo = summary.goNoGo || report?.governance?.goNoGo || 'Indisponível';
  const blockerItems = Array.isArray(report?.governance?.blockers) ? report.governance.blockers : [];
  const lastUpdated = report?.generatedAt || report?.updatedAt || report?.policy?.generatedAt || 'Indisponível';
  const overallCoverage = averageCoverage(finalCoverage);
  const decisionIsGo = String(goNoGo).toUpperCase() === 'GO';
  const policyText = report?.policy
    ? `janela ${report.policy.requireFreshReplayDays ?? 7}d${report.policy.requireTraceForCritical ? ' · rastreio ativo' : ''}${report.policy.requireScreenshotsForCritical ? ' · captura de tela ativa' : ''}`
    : 'janela 7d · rastreio ativo · captura de tela ativa';

	  return (
	    <div className="qg-shell">
	      <div className="qg-backdrop" aria-hidden="true" />

	      <main className="qg-container qg-main">
        <section className="qg-hero">
          <div className="qg-hero__glow" aria-hidden="true" />
          <div className="qg-hero__content">
            <div>
              <div className="qg-overline-pill">
                <Icon name="sparkles" className="qg-icon qg-icon--sm qg-tone-accent" />
                Painel de observabilidade QA
              </div>
              <h2>QA Gaps Operacionais</h2>
              <p>Descoberta autônoma de capacidades, jornadas, dependências e governança operacional em uma leitura única.</p>
              <div className="qg-hero__actions">
                <button type="button" className="qg-primary-action" onClick={() => loadReport(true)} disabled={loading}>
                  <Icon name="refresh" className={`qg-icon ${loading ? 'is-spinning' : ''}`} />
                  {loading ? 'Atualizando...' : 'Recomputar leitura'}
                </button>
                <div className={`qg-decision qg-tone-${decisionIsGo ? 'success' : 'danger'}`}>
                  <Icon name={decisionIsGo ? 'check' : 'x'} className="qg-icon" />
                  Decisão: {goNoGo}
                </div>
              </div>
            </div>
            <ScoreRing value={overallCoverage} />
          </div>

          <div className="qg-summary-grid">
            <SummaryMetric label="Capacidades" value={summary.capabilities || 0} icon="layers" tone="accent" />
            <SummaryMetric label="Jornadas" value={summary.journeys || 0} icon="git" tone="success" />
            <SummaryMetric label="Bloqueios" value={blockerItems.length} icon="shield" tone="danger" />
            <SummaryMetric label="Última leitura" value={compactText(lastUpdated)} icon="activity" tone="warning" isText />
          </div>
        </section>

        <PolicyForm policy={policy} onChange={setPolicy} />

        <div className="qg-policy-note">
          <strong>Política aplicada:</strong> {policyText}
        </div>

        {error ? <div className="qg-error-box">{error}</div> : null}

        <section className="qg-coverage-grid">
          <CoverageMetric label="Transições" value={finalCoverage.transitionCoverage} />
          <CoverageMetric label="Validação de estado" value={finalCoverage.stateValidationCoverage} />
          <CoverageMetric label="Efeitos colaterais" value={finalCoverage.sideEffectCoverage} />
          <CoverageMetric label="Consequência operacional" value={finalCoverage.operationalConsequenceCoverage} />
        </section>

        <div className="qg-split-grid">
          <Card className="qg-blockers-card">
            <div className="qg-section-header">
              <h2>
                <Icon name="alert" className="qg-icon qg-tone-danger" />
                Bloqueadores GO/NO_GO
              </h2>
              <span className="qg-pill qg-tone-danger">{blockerItems.length}</span>
            </div>
            <ul className="qg-list qg-list--scroll qg-list--tall">
              {blockerItems.slice(0, 60).map((item, index) => (
                <li key={`blocker-${index}`} className="qg-list-item qg-list-item--with-dot">
                  <Icon name="circle" className="qg-icon qg-icon--dot qg-tone-danger" />
                  <span>
                    <strong>{formatReadableLabel(item.capability || '*', 'Capacidade')}</strong>
                    <small>{formatBlockerReason(item.reason || 'bloqueio')}</small>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="qg-table-card">
            <div className="qg-table-card__header">
              <h2>Cobertura por capacidade</h2>
              <span>{coverageRows.length} capacidades</span>
            </div>
            <div className="qg-table-wrap">
              <table className="qg-table">
                <thead>
                  <tr>
                    <th>Capacidade</th>
                    <th>Implementado</th>
                    <th>Replay</th>
                    <th>Validado</th>
                    <th>Operacional</th>
                  </tr>
                </thead>
                <tbody>
                  {coverageRows.map((row) => (
                    <tr key={row.capability}>
                      <td>{formatReadableLabel(row.capability, 'Capacidade')}</td>
                      <td><StatusDot ok={row.implemented} /></td>
                      <td><StatusDot ok={row.replayed} /></td>
                      <td><StatusDot ok={row.validated} /></td>
                      <td><StatusDot ok={row.operationallyVerified} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <section className="qg-gap-grid">
          <GapSection title="Lacunas de implementação" items={report?.gaps?.implementation} />
          <GapSection title="Lacunas de E2E" items={report?.gaps?.e2e} />
          <GapSection title="Lacunas de replay" items={report?.gaps?.replay} />
          <GapSection title="Lacunas de UX" items={report?.gaps?.ux} />
          <GapSection title="Lacunas operacionais" items={report?.gaps?.operational} />
          <GapSection title="Lacunas de estado e transição" items={report?.gaps?.stateBased} />
        </section>

        {Array.isArray(report?.autoGeneration) && report.autoGeneration.length > 0 ? (
          <Card className="qg-auto-generation">
            <h2>Geração automática</h2>
            <ul className="qg-list qg-list--grid">
              {report.autoGeneration.slice(0, 30).map((item, index) => (
                <li key={`auto-${index}`} className="qg-list-item">
                  <span className="qg-chip qg-tone-accent">{formatReadableLabel(item.type, 'Auto')}</span>
                  <span>{item.message}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <AutoClosureSuggestions loading={loading} />
      </main>
    </div>
  );
}

export default QaGapsPage;
