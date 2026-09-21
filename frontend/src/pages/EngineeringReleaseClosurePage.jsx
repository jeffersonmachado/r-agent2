import React, { useCallback, useEffect, useState } from 'react';
import { getEngineeringReleaseClosure } from '../api/engineeringRouter';
import { useToast } from '../components/Toast';

function Row({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border-default last:border-0">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className={`text-sm font-medium ${tone || 'text-text-primary'}`}>{value}</span>
    </div>
  );
}

export function EngineeringReleaseClosurePage() {
  const { showToast, ToastContainer } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getEngineeringReleaseClosure();
      setData(result);
    } catch (err) {
      showToast?.(err.message || 'Falha ao carregar release closure', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  if (loading || !data) {
    return <div className="p-6 text-sm text-text-secondary">Carregando…</div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <ToastContainer />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Release Closure</h1>
        <span className={`px-3 py-1 rounded-full text-sm font-medium border ${data.cleanReleaseState ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' : 'bg-amber-500/15 text-amber-500 border-amber-500/30'}`}>
          {data.cleanReleaseState ? 'CLEAN RELEASE STATE' : 'NÃO É UM RELEASE LIMPO'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-sm font-bold text-text-primary mb-2">Release Candidate</h2>
          <Row label="Run ID" value={data.releaseCandidate.runId || '—'} />
          <Row label="Source Fingerprint" value={data.releaseCandidate.sourceFingerprint ? `${data.releaseCandidate.sourceFingerprint.slice(0, 16)}…` : '—'} />
          <Row label="Source Commit" value={data.releaseCandidate.sourceCommit ? data.releaseCandidate.sourceCommit.slice(0, 12) : '—'} />
          <Row label="Status" value={data.releaseCandidate.status} />
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-sm font-bold text-text-primary mb-2">QA Mesh Go/No-Go</h2>
          <Row label="Status" value={data.goNoGo.status} tone={data.goNoGo.status === 'GO' ? 'text-emerald-500' : 'text-red-500'} />
          <Row label="Execution ID" value={data.goNoGo.executionId || '—'} />
          <Row label="Mesmo run corrente?" value={data.goNoGo.sameRun ? 'sim' : 'não (evidência de outro run)'} tone={data.goNoGo.sameRun ? 'text-emerald-500' : 'text-red-500'} />
          <Row label="Motivos" value={data.goNoGo.reasons.length ? data.goNoGo.reasons.join(', ') : 'nenhum'} />
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-sm font-bold text-text-primary mb-2">Final Readiness</h2>
          <Row label="Decisão" value={data.finalReadiness.finalDecision} />
          <Row label="Maturidade" value={data.finalReadiness.candidateMaturityLevel || '—'} />
          <Row label="Cobertura total" value={data.finalReadiness.totalCoverage != null ? `${data.finalReadiness.totalCoverage}%` : '—'} />
          <Row label="Mesmo run corrente?" value={data.finalReadiness.sameRun ? 'sim' : 'não (evidência de outro run)'} tone={data.finalReadiness.sameRun ? 'text-emerald-500' : 'text-red-500'} />
          <Row label="Bloqueios" value={data.finalReadiness.blockingReasons.length} tone={data.finalReadiness.blockingReasons.length > 0 ? 'text-red-500' : 'text-emerald-500'} />
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-sm font-bold text-text-primary mb-2">Final Consistency Gate</h2>
          <Row label="Decisão" value={data.finalConsistencyGate.decision} tone={data.finalConsistencyGate.decision === 'FINAL_CONSISTENCY_GO' ? 'text-emerald-500' : 'text-red-500'} />
          <Row label="Mesmo run corrente?" value={data.finalConsistencyGate.sameRun ? 'sim' : 'não (evidência de outro run)'} tone={data.finalConsistencyGate.sameRun ? 'text-emerald-500' : 'text-red-500'} />
          <Row label="Falhas" value={data.finalConsistencyGate.failures.length ? data.finalConsistencyGate.failures.length : 'nenhuma'} tone={data.finalConsistencyGate.failures.length > 0 ? 'text-red-500' : 'text-emerald-500'} />
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-sm font-bold text-text-primary mb-2">Engineering Model Router</h2>
          <Row label="Tasks totais" value={data.engineering.totals.total} />
          <Row label="GREEN" value={data.engineering.totals.green} tone="text-emerald-500" />
          <Row label="RED" value={data.engineering.totals.red} tone="text-red-500" />
          <Row label="Release blockers" value={data.engineering.releaseBlockers} tone={data.engineering.releaseBlockers > 0 ? 'text-amber-500' : 'text-emerald-500'} />
          <Row label="Post-release findings" value={data.engineering.postReleaseFindingsCount} />
        </div>
      </div>

      {!data.cleanReleaseState && data.lockReasons?.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 mt-4">
          <h2 className="text-sm font-bold text-red-500 mb-2">Motivo exato do bloqueio (nunca genérico)</h2>
          <ul className="text-sm text-text-primary list-disc list-inside space-y-1">
            {data.lockReasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      )}

      <div className="bg-bg-elevated rounded-xl border border-border-default p-5 mt-4 text-xs text-text-secondary">
        {data.offlineVerify.note}
      </div>
    </div>
  );
}

export default EngineeringReleaseClosurePage;
