import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../api/client';
import { useTheme } from '../styles/themeContext';

function normalizeCoverageRows(coverage = {}) {
  return Object.entries(coverage).map(([capability, value]) => ({ capability, ...value }));
}

function withAlpha(color, alpha) {
  if (!color || typeof color !== 'string') return color;
  if (color.startsWith('rgba') || color.startsWith('rgb')) return color;

  const normalized = color.replace('#', '');
  if (![3, 6].includes(normalized.length)) return color;

  const expanded = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized;

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);

  if ([red, green, blue].some((value) => Number.isNaN(value))) return color;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
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

function formatBoolean(value) {
  return value ? 'Sim' : 'Não';
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

function compactText(value, fallback = 'Indisponivel') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  return raw;
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

function chunkItems(items = [], size = 2) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function SurfaceCard({ children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-border bg-bg-elevated/90 shadow-sm ${className}`}>
      {children}
    </section>
  );
}

function HeroProgressRing({ value, theme }) {
  const safeValue = formatPercent(value);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (safeValue / 100) * circumference;

  return (
    <div className="relative flex h-40 w-40 items-center justify-center rounded-full">
      <svg className="h-40 w-40 -rotate-90" viewBox="0 0 140 140" fill="none">
        <circle
          cx="70"
          cy="70"
          r={radius}
          stroke={withAlpha(theme.colors.text.tertiary, 0.14)}
          strokeWidth="10"
        />
        <circle
          cx="70"
          cy="70"
          r={radius}
          stroke={theme.colors.status.error}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="text-5xl font-semibold text-text-primary">{safeValue}%</div>
        <div className="mt-1 text-xs uppercase tracking-[0.18em] text-text-tertiary">cobertura geral</div>
      </div>
    </div>
  );
}

function SummaryStatCard({ label, value, icon, style }) {
  return (
    <div className="rounded-2xl border p-4 shadow-sm backdrop-blur-sm" style={style}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-text-tertiary">{label}</div>
          <div className="mt-3 text-3xl font-semibold text-text-primary">{value}</div>
        </div>
        <div className="text-lg text-text-tertiary">{icon}</div>
      </div>
    </div>
  );
}

function StatusPill({ value }) {
  const active = Boolean(value);
  return (
    <span
      className={`inline-flex min-w-[42px] items-center justify-center rounded-full px-2.5 py-1 text-[11px] font-medium ${active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}
    >
      {active ? 'Sim' : 'Nao'}
    </span>
  );
}

function GapSection({ title, items, tone = 'default' }) {
  const list = Array.isArray(items) ? items : [];
  const toneClass = tone === 'success'
    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/15'
    : tone === 'warning'
      ? 'bg-amber-500/10 text-amber-300 border-amber-500/15'
      : 'bg-bg-default text-text-secondary border-border/60';

  return (
    <SurfaceCard className="h-[215px] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-text-primary">{title}</h3>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass}`}>
          {list.length} itens
        </span>
      </div>
      {list.length === 0 ? (
        <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-300">
          Nenhum gap detectado.
        </div>
      ) : (
        <ul className="max-h-[145px] space-y-2 overflow-auto pr-1 text-sm">
          {list.slice(0, 20).map((item, index) => (
            <li
              key={`${title}-${index}`}
              className="rounded-xl border border-border/60 bg-bg-default px-3 py-2 text-text-primary"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{formatReadableLabel(item.capability || item.type || 'registro')}</div>
                  <div className="mt-1 text-xs text-text-secondary">{item.gap || item.reason || item.message || 'lacuna identificada'}</div>
                </div>
                <span className="rounded-md bg-bg-hover px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                  {formatReadableLabel(item.reason || item.gap || item.type || 'gap')}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SurfaceCard>
  );
}

function CoverageMetric({ label, value, theme }) {
  const number = formatPercent(value);
  const toneColor = number >= 80
    ? theme.colors.status.success
    : number >= 50
      ? theme.colors.status.warning
      : theme.colors.status.error;
  return (
    <SurfaceCard className="p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-text-secondary">{label}</div>
      <div className="mt-3 flex items-end gap-2">
        <div className="text-4xl font-semibold leading-none" style={{ color: toneColor }}>{number}%</div>
        <div className="pb-1 text-xs text-text-tertiary">de 100%</div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-bg-default">
        <div className="h-full rounded-full" style={{ width: `${Math.max(6, Math.min(number, 100))}%`, backgroundColor: toneColor }} />
      </div>
    </SurfaceCard>
  );
}

function AutoClosureSuggestions({ loading, theme }) {
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

  const { remediations, closure } = suggestions;
  const remediationItems = [
    ...(Array.isArray(remediations?.e2eScenarios) ? remediations.e2eScenarios.map((item) => ({
      type: 'E2E',
      label: `Adicionar E2E com uiSteps e validacao de ${item.capability || item.name || 'cenario'}`,
    })) : []),
    ...(Array.isArray(remediations?.preflightSuggestions) ? remediations.preflightSuggestions.map((item) => ({
      type: 'VALIDATORS',
      label: `Incluir validadores/evidencias reais para ${item.capability || 'capacidade'}`,
    })) : []),
    ...(Array.isArray(remediations?.replayImprovements) ? remediations.replayImprovements.map((item) => ({
      type: 'REPLAY',
      label: item.action || `Gerar replay operacional para ${item.capability || item.type || 'capacidade'}`,
    })) : []),
  ].slice(0, 12);
  const remediationChunks = chunkItems(remediationItems, 2);

  const badgePalette = {
    E2E: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/20',
    VALIDATORS: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
    REPLAY: 'bg-violet-500/15 text-violet-300 border-violet-500/20',
  };

  return (
    <SurfaceCard className="p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-text-secondary">Remediação automática</p>
          <h2 className="mt-1 text-lg font-semibold text-text-primary">Sugestões autônomas de fechamento de gaps</h2>
        </div>
        <span className="rounded-full border border-border/60 bg-bg-default px-3 py-1 text-xs font-medium text-text-secondary">
          {formatClosureStatus(closure.closureStatus)}
        </span>
      </div>

      {error ? <p className="mb-3 text-sm" style={{ color: theme.colors.status.error }}>{error}</p> : null}

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="bg-bg-default p-3 rounded border border-border/50">
          <div className="text-xs text-text-secondary">Cenários para gerar</div>
          <div className="text-lg font-bold" style={{ color: theme.colors.accent.primary }}>{remediations.scenarios.length}</div>
        </div>
        <div className="bg-bg-default p-3 rounded border border-border/50">
          <div className="text-xs text-text-secondary">Cobertura de passos de UI</div>
          <div className="text-lg font-bold" style={{ color: theme.colors.status.success }}>{remediations.uiSteps.coverage}</div>
        </div>
        <div className="bg-bg-default p-3 rounded border border-border/50">
          <div className="text-xs text-text-secondary">Cobertura de validadores</div>
          <div className="text-lg font-bold" style={{ color: theme.colors.accent.hover }}>{remediations.validators.coverage}</div>
        </div>
        <div className="bg-bg-default p-3 rounded border border-border/50">
          <div className="text-xs text-text-secondary">Potencial de automação</div>
          <div className="text-lg font-bold" style={{ color: theme.colors.status.warning }}>{closure.automationPotential}%</div>
        </div>
      </div>

      <div className="border-t border-border/50 pt-4">
        <h3 className="mb-3 text-sm font-semibold text-text-primary">Geracao automatica</h3>
        <div className="space-y-2">
          {remediationChunks.map((row, rowIndex) => (
            <div key={`remediation-row-${rowIndex}`} className="grid gap-2 md:grid-cols-2">
              {row.map((item, itemIndex) => (
                <div key={`remediation-${rowIndex}-${itemIndex}`} className="flex items-center gap-3 rounded-xl border border-border/60 bg-bg-default px-3 py-2">
                  <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${badgePalette[item.type] || 'bg-bg-hover text-text-secondary border-border/60'}`}>
                    {item.type}
                  </span>
                  <span className="text-xs text-text-secondary">{item.label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 text-xs text-text-secondary">
        Status: <strong>{closure.closureStatus === 'ready_to_automate' ? 'Pronto' : 'Com bloqueios'}</strong>
      </p>
    </SurfaceCard>
  );
}


const DEFAULT_POLICY = { replayDays: 7, requireTrace: true, requireScreenshot: true };

function PolicyForm({ policy, onChange }) {
  return (
    <details className="rounded-2xl border border-border bg-bg-elevated/90 shadow-sm">
      <summary className="cursor-pointer px-5 py-4 text-sm font-semibold select-none text-text-primary">
        Política GO/NO_GO — ajustar parâmetros
      </summary>
      <div className="flex flex-wrap gap-6 border-t border-border/70 p-5 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Janela de replay (dias)</span>
          <input
            type="number"
            min={1}
            max={90}
            value={policy.replayDays}
            onChange={(e) => onChange({ ...policy, replayDays: Math.max(1, Number(e.target.value)) })}
            className="w-24 rounded border border-border bg-bg-default px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-2 mt-5">
          <input
            type="checkbox"
            checked={policy.requireTrace}
            onChange={(e) => onChange({ ...policy, requireTrace: e.target.checked })}
          />
          <span>Exigir rastreio em capacidades críticas</span>
        </label>
        <label className="flex items-center gap-2 mt-5">
          <input
            type="checkbox"
            checked={policy.requireScreenshot}
            onChange={(e) => onChange({ ...policy, requireScreenshot: e.target.checked })}
          />
          <span>Exigir captura de tela em capacidades críticas</span>
        </label>
      </div>
    </details>
  );
}

export function QaGapsPage() {
  const { theme, themeName } = useTheme();
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
  const blockerCount = report?.governance?.blockers?.length || 0;
  const lastUpdated = report?.generatedAt || report?.updatedAt || report?.policy?.generatedAt || 'Indisponível';
  const overallCoverage = averageCoverage(finalCoverage);
  const isLight = themeName === 'light';
  const toneStyle = String(goNoGo).toUpperCase() === 'GO'
    ? {
        color: theme.colors.status.success,
        borderColor: withAlpha(theme.colors.status.success, isLight ? 0.24 : 0.3),
        backgroundColor: withAlpha(theme.colors.status.success, isLight ? 0.1 : 0.14),
      }
    : {
        color: theme.colors.status.error,
        borderColor: withAlpha(theme.colors.status.error, isLight ? 0.24 : 0.3),
        backgroundColor: withAlpha(theme.colors.status.error, isLight ? 0.1 : 0.14),
      };
  const heroStyle = {
    background: isLight
      ? `linear-gradient(135deg, ${withAlpha(theme.colors.accent.primary, 0.1)}, ${withAlpha(theme.colors.status.info, 0.06)}, ${withAlpha(theme.colors.status.success, 0.08)})`
      : `linear-gradient(135deg, ${withAlpha(theme.colors.accent.primary, 0.18)}, ${withAlpha(theme.colors.status.info, 0.12)}, ${withAlpha(theme.colors.status.success, 0.1)})`,
    borderColor: isLight ? theme.colors.border.default : theme.colors.border.hover,
  };
  const eyebrowStyle = {
    borderColor: isLight ? withAlpha(theme.colors.accent.primary, 0.22) : theme.colors.border.hover,
    backgroundColor: isLight ? withAlpha(theme.colors.bg.secondary, 0.78) : withAlpha(theme.colors.bg.elevated, 0.72),
    color: isLight ? theme.colors.accent.primary : theme.colors.text.secondary,
  };
  const ctaStyle = {
    backgroundColor: loading ? theme.colors.text.tertiary : theme.colors.accent.primary,
    color: '#ffffff',
  };
  const summaryCardStyle = {
    borderColor: isLight ? withAlpha(theme.colors.bg.secondary, 0.72) : theme.colors.border.hover,
    backgroundColor: isLight ? withAlpha(theme.colors.bg.secondary, 0.84) : withAlpha(theme.colors.bg.elevated, 0.72),
  };
  const summaryLabelStyle = { color: theme.colors.text.tertiary };
  const summaryValueStyle = { color: theme.colors.text.primary };
  const errorBoxStyle = {
    borderColor: withAlpha(theme.colors.status.error, 0.35),
    backgroundColor: withAlpha(theme.colors.status.error, isLight ? 0.1 : 0.16),
    color: theme.colors.status.error,
  };
  const heroShellStyle = {
    background: 'linear-gradient(135deg, rgba(34, 31, 72, 0.92), rgba(24, 22, 43, 0.96))',
    borderColor: withAlpha(theme.colors.accent.primary, 0.18),
    boxShadow: '0 24px 60px rgba(0, 0, 0, 0.26)',
  };
  const decisionBadgeStyle = String(goNoGo).toUpperCase() === 'GO'
    ? {
        color: theme.colors.status.success,
        borderColor: withAlpha(theme.colors.status.success, 0.24),
        backgroundColor: withAlpha(theme.colors.status.success, 0.1),
      }
    : {
        color: '#ff8aa0',
        borderColor: 'rgba(239, 68, 68, 0.22)',
        backgroundColor: 'rgba(110, 24, 52, 0.42)',
      };
  const statStyles = [
    { background: 'linear-gradient(135deg, rgba(46, 45, 114, 0.72), rgba(33, 32, 77, 0.86))', borderColor: 'rgba(115, 108, 255, 0.18)' },
    { background: 'linear-gradient(135deg, rgba(10, 67, 69, 0.78), rgba(16, 85, 80, 0.7))', borderColor: 'rgba(54, 215, 183, 0.18)' },
    { background: 'linear-gradient(135deg, rgba(87, 19, 52, 0.82), rgba(68, 16, 46, 0.72))', borderColor: 'rgba(255, 96, 147, 0.16)' },
    { background: 'linear-gradient(135deg, rgba(91, 58, 25, 0.82), rgba(70, 45, 23, 0.76))', borderColor: 'rgba(255, 197, 114, 0.16)' },
  ];
  const blockerItems = Array.isArray(report?.governance?.blockers) ? report.governance.blockers : [];
  const implementationTone = (report?.gaps?.implementation?.length || 0) === 0 ? 'success' : 'default';

  return (
    <div className="mx-auto max-w-7xl p-6 space-y-6">
      <section className="overflow-hidden rounded-[28px] border shadow-sm" style={heroShellStyle}>
        <div className="grid gap-8 px-6 py-6 lg:grid-cols-[1.45fr_0.7fr] lg:px-8 lg:py-8">
          <div className="space-y-4">
            <div className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em]" style={eyebrowStyle}>
              Painel de observabilidade QA
            </div>
            <div>
              <h1 className="text-5xl font-semibold tracking-tight" style={{ color: theme.colors.text.primary }}>QA Gaps Operacionais</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6" style={{ color: theme.colors.text.secondary }}>
                Descoberta autônoma de capacidades, jornadas, dependências e governança operacional em uma leitura única.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="inline-flex items-center rounded-xl px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-70"
                style={ctaStyle}
                onClick={() => loadReport(true)}
                disabled={loading}
              >
                {loading ? 'Atualizando...' : 'Recomputar leitura'}
              </button>
              <div className="inline-flex items-center rounded-xl border px-3 py-2 text-sm font-medium" style={decisionBadgeStyle}>
                Decisão: {goNoGo}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 pt-2 md:grid-cols-4">
              <SummaryStatCard label="Capacidades" value={summary.capabilities || 0} icon="◎" style={statStyles[0]} />
              <SummaryStatCard label="Jornadas" value={summary.journeys || 0} icon="⇄" style={statStyles[1]} />
              <SummaryStatCard label="Bloqueios" value={blockerCount} icon="◔" style={statStyles[2]} />
              <SummaryStatCard label="Última leitura" value={compactText(lastUpdated, 'Indisponivel')} icon="⌁" style={statStyles[3]} />
            </div>
          </div>

          <div className="flex items-center justify-center lg:justify-end">
            <HeroProgressRing value={overallCoverage} theme={theme} />
          </div>
        </div>
      </section>

      <PolicyForm policy={policy} onChange={setPolicy} />

      {report?.policy ? (
        <div className="rounded-2xl border border-border bg-bg-elevated/90 px-4 py-3 text-xs text-text-secondary shadow-sm">
          Política aplicada: janela {report.policy.requireFreshReplayDays ?? 7}d
          {report.policy.requireTraceForCritical ? ' · rastreio ativo' : ''}
          {report.policy.requireScreenshotsForCritical ? ' · captura de tela ativa' : ''}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border p-3 text-sm" style={errorBoxStyle}>{error}</div>
      ) : null}

      <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <CoverageMetric label="Cobertura Transições" value={finalCoverage.transitionCoverage} theme={theme} />
        <CoverageMetric label="Cobertura Validação de estado" value={finalCoverage.stateValidationCoverage} theme={theme} />
        <CoverageMetric label="Cobertura Efeitos colaterais" value={finalCoverage.sideEffectCoverage} theme={theme} />
        <CoverageMetric label="Cobertura Consequência operacional" value={finalCoverage.operationalConsequenceCoverage} theme={theme} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.3fr]">
        <SurfaceCard className="h-[420px] overflow-hidden p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-text-primary">Bloqueadores GO/NO_GO</h2>
            <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300">
              {blockerItems.length}
            </span>
          </div>
          <ul className="max-h-[340px] space-y-2 overflow-auto pr-1 text-sm">
            {blockerItems.slice(0, 40).map((item, index) => (
              <li key={`blocker-${index}`} className="rounded-xl border border-border/60 bg-bg-default px-3 py-2 text-text-primary">
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-2 w-2 rounded-full bg-rose-400" />
                  <div>
                    <div className="font-medium">{formatReadableLabel(item.capability || '*', 'Capacidade')}</div>
                    <div className="text-xs text-text-secondary">{formatBlockerReason(item.reason || 'bloqueio')}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </SurfaceCard>

        <SurfaceCard className="h-[420px] overflow-hidden">
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="text-base font-semibold text-text-primary">Cobertura por capacidade</h2>
          </div>
          <div className="h-[356px] overflow-auto px-3 py-2">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-bg-elevated/95 backdrop-blur-sm">
                <tr className="text-left border-b border-border">
                  <th className="py-3 pr-3 pl-2 text-[11px] uppercase tracking-[0.18em] text-text-tertiary">Capacidade</th>
                  <th className="py-3 pr-3 text-[11px] uppercase tracking-[0.18em] text-text-tertiary">Implementado</th>
                  <th className="py-3 pr-3 text-[11px] uppercase tracking-[0.18em] text-text-tertiary">Replay</th>
                  <th className="py-3 pr-3 text-[11px] uppercase tracking-[0.18em] text-text-tertiary">Validado</th>
                  <th className="py-3 pr-3 text-[11px] uppercase tracking-[0.18em] text-text-tertiary">Operacional</th>
                </tr>
              </thead>
              <tbody>
                {coverageRows.map((row) => (
                  <tr key={row.capability} className="border-b border-border/50">
                    <td className="py-3 pr-3 pl-2 text-text-primary">{formatReadableLabel(row.capability, 'Capacidade')}</td>
                    <td className="py-3 pr-3"><StatusPill value={row.implemented} /></td>
                    <td className="py-3 pr-3"><StatusPill value={row.replayed} /></td>
                    <td className="py-3 pr-3"><StatusPill value={row.validated} /></td>
                    <td className="py-3 pr-3"><StatusPill value={row.operationallyVerified} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SurfaceCard>
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <GapSection title="Lacunas de implementação" items={report?.gaps?.implementation} tone={implementationTone} />
        <GapSection title="Lacunas de E2E" items={report?.gaps?.e2e} tone="warning" />
        <GapSection title="Lacunas de replay" items={report?.gaps?.replay} tone="warning" />
        <GapSection title="Lacunas de UX" items={report?.gaps?.ux} />
        <GapSection title="Lacunas operacionais" items={report?.gaps?.operational} />
        <GapSection title="Lacunas de estado e transição" items={report?.gaps?.stateBased} />
      </section>

      <SurfaceCard className="p-5">
        <h2 className="mb-2 text-base font-semibold text-text-primary">Geração automática</h2>
        <ul className="max-h-[180px] space-y-2 overflow-auto text-sm">
          {(report?.autoGeneration || []).slice(0, 30).map((item, index) => (
            <li key={`auto-${index}`} className="rounded-xl border border-border/60 bg-bg-default px-3 py-2 text-text-secondary">
              <span className="font-medium text-text-primary">{formatReadableLabel(item.type, 'Automação')}</span>: {item.message}
            </li>
          ))}
        </ul>
      </SurfaceCard>

      <AutoClosureSuggestions loading={loading} theme={theme} />
    </div>
  );
}

export default QaGapsPage;
