import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../api/client';

function StatusBadge({ value }) {
  const isGo = String(value || '').toUpperCase() === 'GO';
  return (
    <span className={`inline-flex items-center rounded px-2 py-1 text-xs font-semibold ${isGo ? 'bg-status-success/10 text-status-success' : 'bg-status-error/10 text-status-error'}`}>
      {value || 'N/A'}
    </span>
  );
}

function Metric({ label, value, tone = 'neutral' }) {
  const toneClass = tone === 'good' ? 'text-status-success' : tone === 'bad' ? 'text-status-error' : 'text-text-primary';
  return (
    <div className="bg-bg-elevated border border-border-default rounded-lg p-4">
      <div className="text-xs text-text-secondary">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}

function countBlockers(blockers = [], reason) {
  return blockers.filter((item) => String(item?.reason || '').includes(reason)).length;
}

export function QaWavesOperationalHealthPage() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (recompute = false) => {
    setLoading(true);
    setError('');
    try {
      if (recompute) {
        await fetchJson('/api/qa-waves/operational/recompute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ persist: true }),
        });
      }
      setReport(await fetchJson('/api/qa-waves/operational/summary'));
    } catch (err) {
      setError(err?.message || 'Falha ao carregar QA Waves Operational Health');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const blockers = useMemo(() => report?.governance?.blockers || [], [report]);
  // Sem relatório carregado NÃO existe veredito. Este painel renderizava
  // "OK"/"Clean"/"0" em VERDE e "NO_GO"/"N/A" em vermelho a partir de um
  // relatório nulo — saúde de governança que não foi medida.
  const hasReport = report !== null && typeof report === 'object';
  const pendingLabel = '—';
  const metricValue = (value) => (hasReport ? value : pendingLabel);
  const metricTone = (tone) => (hasReport ? tone : 'neutral');
  const goNoGo = report?.summary?.goNoGo || report?.governance?.goNoGo || 'N/A';
  const confidence = Math.max(0, Math.min(100, Number(report?.summary?.operationalConfidenceScore || report?.confidenceScore || 0)));
  const mutationMismatches = countBlockers(blockers, 'mutation');
  const provenanceMismatches = countBlockers(blockers, 'provenance');
  const failedProofs = blockers.length;

  return (
    <div className="p-6 space-y-4" data-testid="qa-waves-operational-health-page">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">QA Waves Operational Health</h1>
          <p className="text-sm text-text-secondary">Governança contínua, integridade de replay e saúde operacional.</p>
        </div>
        <button type="button" className="btn-default px-4 py-2" onClick={() => load(true)} disabled={loading}>
          {loading ? 'Atualizando...' : 'Recomputar'}
        </button>
      </div>

      {error ? <div className="border border-status-error/30 bg-status-error/10 text-status-error rounded-md p-3 text-sm">{error}</div> : null}

      <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Metric label="GO/NO_GO" value={hasReport ? <StatusBadge value={goNoGo} /> : pendingLabel} tone={metricTone(goNoGo === 'GO' ? 'good' : 'bad')} />
        <Metric label="Replay Integrity" value={metricValue(failedProofs === 0 ? 'OK' : 'NO_GO')} tone={metricTone(failedProofs === 0 ? 'good' : 'bad')} />
        <Metric label="Governance Status" value={metricValue(report?.governance?.goNoGo || goNoGo)} tone={metricTone(goNoGo === 'GO' ? 'good' : 'bad')} />
        <Metric label="Confidence" value={metricValue(`${confidence}%`)} tone={metricTone(confidence >= 90 ? 'good' : 'neutral')} />
      </section>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Metric label="Failed Proofs" value={metricValue(failedProofs)} tone={metricTone(failedProofs === 0 ? 'good' : 'bad')} />
        <Metric label="Mutation Mismatches" value={metricValue(mutationMismatches)} tone={metricTone(mutationMismatches === 0 ? 'good' : 'bad')} />
        <Metric label="Provenance Mismatches" value={metricValue(provenanceMismatches)} tone={metricTone(provenanceMismatches === 0 ? 'good' : 'bad')} />
        <Metric label="Replay Health" value={metricValue(failedProofs === 0 ? 'Clean' : 'Blocked')} tone={metricTone(failedProofs === 0 ? 'good' : 'bad')} />
      </section>

      <section className="bg-bg-elevated border border-border-default rounded-lg p-4">
        <h2 className="text-base font-semibold mb-3">Smoke History</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-text-secondary">Última geração</div>
            <div className="font-medium">{report?.generatedAt || report?.updatedAt || 'N/A'}</div>
          </div>
          <div>
            <div className="text-text-secondary">Capabilities</div>
            <div className="font-medium">{report?.summary?.capabilities || 0}</div>
          </div>
          <div>
            <div className="text-text-secondary">Journeys</div>
            <div className="font-medium">{report?.summary?.journeys || 0}</div>
          </div>
        </div>
      </section>

      <section className="bg-bg-elevated border border-border-default rounded-lg p-4">
        <h2 className="text-base font-semibold mb-3">Governance Reasoning</h2>
        {blockers.length === 0 ? (
          <p className="text-sm text-text-secondary">Zero blockers ativos.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {blockers.slice(0, 40).map((item, index) => (
              <li key={`blocker-${index}`}>{item.capability || item.journeyId || '*'}: {item.reason || 'blocker'}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
