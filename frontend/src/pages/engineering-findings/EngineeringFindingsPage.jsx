import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listEngineeringFindings,
  getEngineeringFindingsSummary,
  getEngineeringFinding,
  getEngineeringFindingHistory,
  reproduceEngineeringFinding,
  triageEngineeringFinding,
  runEngineeringFindingFix,
  approveEngineeringFindingSelfModification,
  runEngineeringBugLoopSweep,
} from '../../api/engineeringFindings';
import { useToast } from '../../components/Toast';

/**
 * Findings do ciclo autônomo de bug (DEVELOPMENT).
 *
 * Esta tela é a superfície INTERNA de engenharia: mostra o que o RAP detectou, como reproduziu, o que
 * confirmou, qual task de correção gerou e como validou a regressão. Ela nunca é a autoridade —
 * status/severidade/evidência vêm do backend, e nenhuma ação aqui contorna os gates (o backend
 * recusa FIXED sem as provas, self-modification sem aprovação humana, etc.).
 */

const STATUS_BADGE = {
  SUSPECTED: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  REPRODUCING: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  CONFIRMED: 'bg-red-500/15 text-red-500 border-red-500/30',
  NOT_REPRODUCED: 'bg-bg-elevated text-text-secondary border-border-default',
  DUPLICATE: 'bg-bg-elevated text-text-secondary border-border-default',
  FIXING: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  FIXED: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  REGRESSION_VALIDATED: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  CLOSED: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  BLOCKED: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
};

const SEVERITY_BADGE = {
  LOW: 'text-emerald-500',
  MEDIUM: 'text-amber-500',
  HIGH: 'text-orange-500',
  CRITICAL: 'text-red-500',
};

export function FindingStatusBadge({ status }) {
  return (
    <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium border ${STATUS_BADGE[status] || 'bg-bg-elevated text-text-secondary border-border-default'}`}>
      {status}
    </span>
  );
}

function KeyValue({ label, value }) {
  return (
    <div className="rounded-lg border border-border-default p-2">
      <div className="text-text-secondary">{label}</div>
      <div className="text-text-primary font-semibold break-words">{value === null || value === undefined || value === '' ? '—' : String(value)}</div>
    </div>
  );
}

function FindingDetail({ findingId, onChanged }) {
  const { showToast } = useToast();
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [finding, setFinding] = useState(null);

  const load = useCallback(async () => {
    try {
      const [detail, historyPayload] = await Promise.all([
        getEngineeringFinding(findingId),
        getEngineeringFindingHistory(findingId),
      ]);
      setFinding(detail);
      setHistory(historyPayload.history || []);
    } catch (err) {
      showToast?.(err.message || 'Falha ao carregar o finding', 'error');
    }
  }, [findingId, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (label, fn) => {
    setBusy(true);
    try {
      const result = await fn();
      showToast?.(`${label}: ${result?.outcome || result?.finding?.status || result?.status || 'ok'}`, 'success');
      await load();
      onChanged?.();
    } catch (err) {
      // Recusas de honestidade (FIXED sem provas, self-modification sem aprovação, confirmação sem
      // base objetiva) são respostas LEGÍTIMAS do backend — mostradas como erro, nunca mascaradas.
      showToast?.(err.message || `${label} recusado`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const reproduction = finding?.reproduction || {};
  const attempts = Array.isArray(finding?.reproduction_attempts) ? finding.reproduction_attempts : [];
  const evidence = Array.isArray(finding?.evidence_refs) ? finding.evidence_refs : [];
  const regressionRuns = Array.isArray(finding?.regression_runs) ? finding.regression_runs : [];

  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-bold text-text-primary">Finding {findingId}</h3>
        <div className="flex gap-2 flex-wrap">
          <button type="button" disabled={busy} onClick={() => run('Reproduzir', () => reproduceEngineeringFinding(findingId))} className="px-3 py-1.5 rounded-lg border border-border-default bg-bg-primary text-xs text-text-primary disabled:opacity-50">
            Reproduzir
          </button>
          <button type="button" disabled={busy} onClick={() => run('Triar', () => triageEngineeringFinding(findingId))} className="px-3 py-1.5 rounded-lg border border-border-default bg-bg-primary text-xs text-text-primary disabled:opacity-50">
            Triar / criar task
          </button>
          <button type="button" disabled={busy} onClick={() => run('Corrigir', () => runEngineeringFindingFix(findingId))} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium disabled:opacity-50">
            Executar correção
          </button>
          {finding?.human_approval_required ? (
            <button type="button" disabled={busy} onClick={() => run('Aprovar self-modification', () => approveEngineeringFindingSelfModification(findingId, { approvalRef: 'ui' }))} className="px-3 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-medium disabled:opacity-50">
              Aprovar self-modification
            </button>
          ) : null}
        </div>
      </div>

      {!finding ? (
        <p className="text-xs text-text-secondary mt-2">Selecione um finding na lista para ver evidência, reprodução, causa raiz, task de correção e regressão.</p>
      ) : (
        <>
          <p className="text-sm text-text-primary mt-3">{finding.title}</p>
          {finding.description ? <p className="text-xs text-text-secondary mt-1">{finding.description}</p> : null}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-xs">
            <KeyValue label="status" value={finding.status} />
            <KeyValue label="severidade" value={finding.severity} />
            <KeyValue label="categoria" value={finding.category} />
            <KeyValue label="fonte" value={finding.source} />
            <KeyValue label="ocorrências" value={finding.occurrences} />
            <KeyValue label="reincidências" value={finding.recurrence_count} />
            <KeyValue label="base de confirmação" value={finding.confirmation_basis} />
            <KeyValue label="self-modification" value={finding.self_modification ? 'SIM' : 'não'} />
            <KeyValue label="comportamento esperado" value={finding.expected_behavior} />
            <KeyValue label="comportamento observado" value={finding.observed_behavior} />
            <KeyValue label="causa raiz" value={finding.root_cause} />
            <KeyValue label="task de correção" value={finding.fix_task_id} />
          </div>

          {finding.human_approval_required ? (
            <p className="text-xs text-orange-500 mt-3">
              Fix de self-modification: exige aprovação humana explícita (autoaprovação proibida por policy).
            </p>
          ) : null}

          <div className="mt-4">
            <h4 className="text-xs font-bold text-text-primary">Reprodução</h4>
            <div className="text-xs text-text-secondary mt-1">
              {reproduction.command ? <code className="break-all">{reproduction.command}</code> : 'sem comando declarado'}
              {reproduction.lastOutcome ? ` · último resultado: ${reproduction.lastOutcome}` : ''}
            </div>
            {attempts.length > 0 ? (
              <ul className="text-xs text-text-secondary mt-2 space-y-1">
                {attempts.slice(-5).map((a, index) => (
                  <li key={`${a.attempt}-${index}`}>
                    tentativa {a.attempt}: {a.outcome} — {a.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="mt-4">
            <h4 className="text-xs font-bold text-text-primary">Evidência ({evidence.length})</h4>
            <ul className="text-xs text-text-secondary mt-1 space-y-1">
              {evidence.slice(-8).map((e, index) => (
                <li key={`${e.id || e.ref}-${index}`}>{e.type}: {e.detail || e.ref}</li>
              ))}
              {evidence.length === 0 ? <li>nenhuma evidência persistida — finding não pode ser confirmado nem fechado</li> : null}
            </ul>
          </div>

          <div className="mt-4">
            <h4 className="text-xs font-bold text-text-primary">Regressão ({regressionRuns.length})</h4>
            <ul className="text-xs text-text-secondary mt-1 space-y-1">
              {regressionRuns.map((r, index) => (
                <li key={`${r.id}-${index}`}>{r.planTier || r.plan_tier}: {r.result || (r.passed ? 'PASS' : 'FAIL')}</li>
              ))}
              {regressionRuns.length === 0 ? <li>nenhuma execução de regressão registrada — FIXED não é REGRESSION_VALIDATED</li> : null}
            </ul>
          </div>

          <div className="mt-4">
            <h4 className="text-xs font-bold text-text-primary">Histórico</h4>
            <ul className="text-xs text-text-secondary mt-1 space-y-1">
              {history.map((h) => (
                <li key={h.id}>{new Date(h.created_at).toLocaleString()} — {h.type}{h.actor ? ` (${h.actor})` : ''}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Export NOMEADO, não default: o helper `lazyPage` do `main.jsx` resolve `module[exportName]` —
 * um `export default` aqui faz o React receber `undefined` e a página quebrar no carregamento
 * (defeito real pego pelo `wave:page-surface`: `pageLoads` FAILED com `pageerror`).
 */
export function EngineeringFindingsPage() {
  const { showToast } = useToast();
  const [findings, setFindings] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ status: '', severity: '' });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        listEngineeringFindings({ status: filters.status, severity: filters.severity, limit: 100 }),
        getEngineeringFindingsSummary(),
      ]);
      const items = list.findings || [];
      setFindings(items);
      setSummary(sum);
      setSelected((current) => (current && items.some((f) => f.id === current) ? current : (items[0]?.id || null)));
    } catch (err) {
      showToast?.(err.message || 'Falha ao carregar findings', 'error');
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.severity, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const sweep = async () => {
    try {
      const result = await runEngineeringBugLoopSweep({ limit: 10 });
      showToast?.(`varredura: ${result.triaged} triados, ${result.fixed} corrigidos`, 'success');
      load();
    } catch (err) {
      showToast?.(err.message || 'Falha na varredura do ciclo de bug', 'error');
    }
  };

  const counters = useMemo(() => ([
    ['total', summary?.total],
    ['confirmados abertos', summary?.openConfirmed],
    ['críticos não resolvidos', summary?.unresolvedCritical],
    ['self-modification', summary?.selfModification],
  ]), [summary]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-text-primary">⚙️ Engineering • Findings (ciclo de bug)</h1>
          <p className="text-xs text-text-secondary mt-1">
            Detecção → reprodução → confirmação → task → correção → regressão → retomada da missão.
            O RAP corrige o que ele mesmo reproduziu; nada aqui declara FIXED sem as provas.
          </p>
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="px-3 py-1.5 rounded-lg border border-border-default bg-bg-primary text-xs text-text-primary">
            <option value="">todos os status</option>
            {['SUSPECTED', 'REPRODUCING', 'CONFIRMED', 'NOT_REPRODUCED', 'DUPLICATE', 'FIXING', 'FIXED', 'REGRESSION_VALIDATED', 'CLOSED', 'BLOCKED'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filters.severity} onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value }))} className="px-3 py-1.5 rounded-lg border border-border-default bg-bg-primary text-xs text-text-primary">
            <option value="">todas as severidades</option>
            {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="button" onClick={load} data-testid="refresh-button" aria-label="Atualizar" disabled={loading} className="px-3 py-1.5 rounded-lg border border-border-default bg-bg-primary text-xs text-text-primary disabled:opacity-50">
            {loading ? 'Atualizando...' : 'Atualizar'}
          </button>
          <button type="button" onClick={sweep} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium">
            Rodar varredura do loop
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        {counters.map(([label, value]) => <KeyValue key={label} label={label} value={value} />)}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4">
          <h2 className="text-sm font-bold text-text-primary mb-3">Findings ({findings.length})</h2>
          <ul className="space-y-2 max-h-[560px] overflow-auto">
            {findings.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => setSelected(f.id)}
                  className={`w-full text-left rounded-lg border p-3 transition-colors ${selected === f.id ? 'border-blue-500/50 bg-blue-500/5' : 'border-border-default bg-bg-primary'}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <FindingStatusBadge status={f.status} />
                    <span className={`text-xs font-bold ${SEVERITY_BADGE[f.severity] || 'text-text-secondary'}`}>{f.severity}</span>
                    <span className="text-xs text-text-secondary">{f.category} · {f.source}</span>
                    {f.self_modification ? <span className="text-xs text-orange-500">SELF-MODIFICATION</span> : null}
                  </div>
                  <div className="text-xs text-text-primary mt-1 break-words">{f.title}</div>
                  <div className="text-xs text-text-secondary mt-1">
                    ocorrências: {f.occurrences} · reincidências: {f.recurrence_count} · task: {f.fix_task_id ? 'sim' : 'não'}
                  </div>
                </button>
              </li>
            ))}
            {findings.length === 0 ? <li className="text-xs text-text-secondary">Nenhum finding registrado.</li> : null}
          </ul>
        </div>

        {selected ? <FindingDetail findingId={selected} onChanged={load} /> : null}
      </div>
    </div>
  );
}
