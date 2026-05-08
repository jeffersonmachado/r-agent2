import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../api/client';

function normalizeCoverageRows(coverage = {}) {
  return Object.entries(coverage).map(([capability, value]) => ({ capability, ...value }));
}

function GapSection({ title, items }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <section className="bg-bg-elevated border border-border rounded-lg p-4">
      <h3 className="text-base font-semibold mb-2">{title}</h3>
      {list.length === 0 ? (
        <p className="text-sm text-text-secondary">Nenhum gap detectado.</p>
      ) : (
        <ul className="text-sm space-y-1">
          {list.slice(0, 20).map((item, index) => (
            <li key={`${title}-${index}`} className="text-text-primary">
              {item.capability || item.type || 'item'}: {item.gap || item.reason || item.message || 'gap'}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CoverageMetric({ label, value }) {
  const number = Number.isFinite(Number(value)) ? Number(value) : 0;
  const blocked = number <= 0;
  return (
    <div className="bg-bg-elevated border border-border rounded-lg p-3">
      <div className="text-xs text-text-secondary">{label}</div>
      <div className={`text-xl font-bold ${blocked ? 'text-red-500' : 'text-green-500'}`}>{number}%</div>
    </div>
  );
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

  const { remediations, closure } = suggestions;

  return (
    <section className="bg-bg-elevated border border-border rounded-lg p-4">
      <h2 className="text-base font-semibold mb-4">Autonomous Gap Closure Suggestions</h2>

      {error ? <p className="text-sm text-red-500 mb-3">{error}</p> : null}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-bg-default p-3 rounded border border-border/50">
          <div className="text-xs text-text-secondary">Scenarios to Generate</div>
          <div className="text-lg font-bold text-blue-500">{remediations.scenarios.length}</div>
        </div>
        <div className="bg-bg-default p-3 rounded border border-border/50">
          <div className="text-xs text-text-secondary">UI Steps Coverage</div>
          <div className="text-lg font-bold text-green-500">{remediations.uiSteps.coverage}</div>
        </div>
        <div className="bg-bg-default p-3 rounded border border-border/50">
          <div className="text-xs text-text-secondary">Validators Coverage</div>
          <div className="text-lg font-bold text-purple-500">{remediations.validators.coverage}</div>
        </div>
        <div className="bg-bg-default p-3 rounded border border-border/50">
          <div className="text-xs text-text-secondary">Automation Potential</div>
          <div className="text-lg font-bold text-orange-500">{closure.automationPotential}%</div>
        </div>
      </div>

      {remediations.scenarios.length > 0 ? (
        <div className="mb-4 pb-4 border-b border-border/50">
          <h3 className="text-sm font-semibold mb-2">Auto-Generated Scenarios</h3>
          <ul className="text-xs space-y-1 max-h-32 overflow-auto">
            {remediations.scenarios.slice(0, 10).map((s, i) => (
              <li key={`scenario-${i}`} className="text-text-secondary">
                {s.name} ({s.seedType}) — {s.steps?.length || 0} steps
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {remediations.preflightSuggestions.length > 0 ? (
        <div className="mb-4 pb-4 border-b border-border/50">
          <h3 className="text-sm font-semibold mb-2 text-yellow-600">Preflight Issues</h3>
          <ul className="text-xs space-y-1">
            {remediations.preflightSuggestions.slice(0, 5).map((s, i) => (
              <li key={`preflight-${i}`} className="text-text-secondary">
                {s.capability}: {s.missing.length} missing preconditions
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {remediations.replayImprovements.length > 0 ? (
        <div className="mb-4 pb-4 border-b border-border/50">
          <h3 className="text-sm font-semibold mb-2 text-red-600">Replay Improvements Needed</h3>
          <ul className="text-xs space-y-1">
            {remediations.replayImprovements.slice(0, 5).map((s, i) => (
              <li key={`replay-${i}`} className="text-text-secondary">
                {s.type} ({s.severity}): {s.action}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-xs text-text-secondary">
        Status: <strong>{closure.closureStatus === 'ready_to_automate' ? '✓ Ready' : '⚠ Blockers'}</strong>
      </p>
    </section>
  );
}


const DEFAULT_POLICY = { replayDays: 7, requireTrace: true, requireScreenshot: true };

function PolicyForm({ policy, onChange }) {
  return (
    <details className="border border-border rounded-lg">
      <summary className="cursor-pointer px-4 py-2 text-sm font-semibold select-none">
        Política GO/NO_GO — ajustar parâmetros
      </summary>
      <div className="flex flex-wrap gap-6 p-4 text-sm">
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
          <span>Exigir trace em capabilities críticas</span>
        </label>
        <label className="flex items-center gap-2 mt-5">
          <input
            type="checkbox"
            checked={policy.requireScreenshot}
            onChange={(e) => onChange({ ...policy, requireScreenshot: e.target.checked })}
          />
          <span>Exigir screenshot em capabilities críticas</span>
        </label>
      </div>
    </details>
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

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">QA Gaps Operacionais</h1>
          <p className="text-sm text-text-secondary">
            Discovery autonomo de capacidades, jornadas, dependencias e governanca GO/NO_GO operacional.
          </p>
        </div>
        <button
          type="button"
          className="btn-default px-4 py-2"
          onClick={() => loadReport(true)}
          disabled={loading}
        >
          {loading ? 'Atualizando...' : 'Recomputar'}
        </button>
      </div>

      <PolicyForm policy={policy} onChange={setPolicy} />

      {report?.policy ? (
        <div className="text-xs text-text-secondary">
          Política aplicada: janela {report.policy.requireFreshReplayDays ?? 7}d
          {report.policy.requireTraceForCritical ? ' · trace ativo' : ''}
          {report.policy.requireScreenshotsForCritical ? ' · screenshot ativo' : ''}
        </div>
      ) : null}

      {error ? (
        <div className="border border-red-300 bg-red-50 text-red-700 rounded-md p-3 text-sm">{error}</div>
      ) : null}

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-bg-elevated border border-border rounded-lg p-4">
          <div className="text-sm text-text-secondary">Decisao</div>
          <div className="text-2xl font-bold">{report?.summary?.goNoGo || report?.governance?.goNoGo || 'N/A'}</div>
        </div>
        <div className="bg-bg-elevated border border-border rounded-lg p-4">
          <div className="text-sm text-text-secondary">Capabilities</div>
          <div className="text-2xl font-bold">{report?.summary?.capabilities || 0}</div>
        </div>
        <div className="bg-bg-elevated border border-border rounded-lg p-4">
          <div className="text-sm text-text-secondary">Journeys</div>
          <div className="text-2xl font-bold">{report?.summary?.journeys || 0}</div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <CoverageMetric label="Transition Coverage" value={finalCoverage.transitionCoverage} />
        <CoverageMetric label="State Validation Coverage" value={finalCoverage.stateValidationCoverage} />
        <CoverageMetric label="Side Effect Coverage" value={finalCoverage.sideEffectCoverage} />
        <CoverageMetric label="Operational Consequence Coverage" value={finalCoverage.operationalConsequenceCoverage} />
      </section>

      {report?.governance?.blockers?.length > 0 ? (
        <section className="bg-bg-elevated border border-border rounded-lg p-4">
          <h2 className="text-base font-semibold mb-2">Bloqueadores GO/NO_GO</h2>
          <ul className="text-sm space-y-1">
            {report.governance.blockers.slice(0, 30).map((item, index) => (
              <li key={`blocker-${index}`} className="text-text-primary">
                {item.capability || '*'}: {item.reason || 'blocker'}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="bg-bg-elevated border border-border rounded-lg p-4 overflow-auto">
        <h2 className="text-base font-semibold mb-2">Coverage por Capability</h2>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left border-b border-border">
              <th className="py-2 pr-3">Capability</th>
              <th className="py-2 pr-3">Implemented</th>
              <th className="py-2 pr-3">Replayed</th>
              <th className="py-2 pr-3">Validated</th>
              <th className="py-2 pr-3">Operationally Verified</th>
            </tr>
          </thead>
          <tbody>
            {coverageRows.map((row) => (
              <tr key={row.capability} className="border-b border-border/50">
                <td className="py-2 pr-3">{row.capability}</td>
                <td className="py-2 pr-3">{row.implemented ? 'yes' : 'no'}</td>
                <td className="py-2 pr-3">{row.replayed ? 'yes' : 'no'}</td>
                <td className="py-2 pr-3">{row.validated ? 'yes' : 'no'}</td>
                <td className="py-2 pr-3">{row.operationallyVerified ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <GapSection title="Gap Implementacao" items={report?.gaps?.implementation} />
        <GapSection title="Gap E2E" items={report?.gaps?.e2e} />
        <GapSection title="Gap Replay" items={report?.gaps?.replay} />
        <GapSection title="Gap UX" items={report?.gaps?.ux} />
        <GapSection title="Gap Operacional" items={report?.gaps?.operational} />
        <GapSection title="Gap Estado / Transição" items={report?.gaps?.stateBased} />
      </section>

      <section className="bg-bg-elevated border border-border rounded-lg p-4">
        <h2 className="text-base font-semibold mb-2">Auto-generation</h2>
        <ul className="text-sm space-y-1">
          {(report?.autoGeneration || []).slice(0, 30).map((item, index) => (
            <li key={`auto-${index}`}>
              {item.type}: {item.message}
            </li>
          ))}
        </ul>
      </section>

      <AutoClosureSuggestions loading={loading} />
    </div>
  );
}

export default QaGapsPage;
