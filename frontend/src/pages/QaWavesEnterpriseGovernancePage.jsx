import React, { useCallback, useEffect, useState } from 'react';
import { fetchJson } from '../api/client';

function Badge({ value }) {
  const go = String(value || '').toUpperCase() === 'GO';
  return (
    <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${go ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {value || 'N/A'}
    </span>
  );
}

function Tile({ label, value, good }) {
  return (
    <div className="bg-bg-elevated border border-border rounded-lg p-4">
      <div className="text-xs text-text-secondary">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${good === false ? 'text-red-600' : good === true ? 'text-green-600' : 'text-text-primary'}`}>{value}</div>
    </div>
  );
}

export function QaWavesEnterpriseGovernancePage() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReport(await fetchJson('/api/qa-waves/enterprise-governance'));
    } catch (err) {
      setError(err?.message || 'Falha ao carregar Enterprise Governance');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const blockers = report?.activeBlockers || [];
  const failedProofs = report?.failedProofs || [];
  const deployAllowed = report?.deploymentSafety?.deployAllowed === true;
  const globalDecision = report?.globalGoNoGo || report?.governanceStatus || 'N/A';
  const runtimeGateStatus = String(report?.runtimeGovernance?.gateStatus || '').toLowerCase();
  const runtimeGovernanceGood = runtimeGateStatus === 'go' || runtimeGateStatus === 'go_degraded';
  const runtimeGovernanceLabel = report?.runtimeGovernance
    ? `${report.runtimeGovernance.gateStatus || 'N/A'} / ${report.runtimeGovernance.classification || 'N/A'}`
    : 'N/A';

  return (
    <div className="p-6 space-y-4" data-testid="qa-waves-enterprise-governance-page">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">QA Waves Enterprise Governance</h1>
          <p className="text-sm text-text-secondary">Governanca operacional unificada para release, runtime e deploy.</p>
        </div>
        <button type="button" className="btn-default px-4 py-2" onClick={load} disabled={loading}>
          {loading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>

      {error ? <div className="border border-red-300 bg-red-50 text-red-700 rounded-md p-3 text-sm">{error}</div> : null}

      <section className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <Tile label="Global GO/NO_GO" value={<Badge value={globalDecision} />} good={String(globalDecision).startsWith('GO')} />
        <Tile label="Operational Confidence" value={`${report?.operationalConfidence ?? 0}%`} good={(report?.operationalConfidence || 0) >= (report?.threshold || 95)} />
        <Tile label="Runtime Governance" value={runtimeGovernanceLabel} good={runtimeGovernanceGood} />
        <Tile label="Release Readiness" value={report?.releaseReadiness?.go ? 'READY' : 'BLOCKED'} good={report?.releaseReadiness?.go === true} />
        <Tile label="Deployment Safety" value={deployAllowed ? 'ALLOWED' : 'BLOCKED'} good={deployAllowed} />
      </section>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Tile label="Replay Integrity" value={report?.replayIntegrity?.valid ? 'VALID' : 'INVALID'} good={report?.replayIntegrity?.valid === true} />
        <Tile label="Governance Signatures" value={report?.governanceSignature?.valid ? 'VALID' : 'INVALID'} good={report?.governanceSignature?.valid === true} />
        <Tile label="Failed Proofs" value={failedProofs.length} good={failedProofs.length === 0} />
        <Tile label="Runtime Risk" value={report?.riskLevel || 'N/A'} good={report?.riskLevel === 'LOW'} />
      </section>

      <section className="bg-bg-elevated border border-border rounded-lg p-4">
        <h2 className="text-base font-semibold mb-3">Smoke Lineage</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-text-secondary">Last smoke</div>
            <div className="font-medium">{report?.lastSmokeExecution?.generatedAt || 'N/A'}</div>
          </div>
          <div>
            <div className="text-text-secondary">Continuous validation</div>
            <div className="font-medium">{report?.continuousValidationStatus?.status || 'N/A'}</div>
          </div>
          <div>
            <div className="text-text-secondary">Tenant</div>
            <div className="font-medium break-all">{report?.lastSmokeExecution?.tenantId || 'N/A'}</div>
          </div>
        </div>
      </section>

      <section className="bg-bg-elevated border border-border rounded-lg p-4">
        <h2 className="text-base font-semibold mb-3">Replay Artifacts</h2>
        <div className="space-y-2 text-sm">
          {(report?.replayArtifacts || []).map((artifact) => (
            <div key={artifact.journeyId} className="rounded border border-border bg-bg-default p-3">
              <div className="font-semibold">{artifact.journeyId}</div>
              <div className="text-xs text-text-secondary break-all">hash: {artifact.replayHash}</div>
              <div className="text-xs text-text-secondary break-all">checksum: {artifact.replayChecksum}</div>
              <div className="text-xs text-text-secondary break-all">signature: {artifact.governanceSignature}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-bg-elevated border border-border rounded-lg p-4">
        <h2 className="text-base font-semibold mb-3">Active Blockers</h2>
        {blockers.length === 0 ? (
          <p className="text-sm text-text-secondary">Zero active blockers.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {blockers.slice(0, 50).map((item, index) => (
              <li key={`blocker-${index}`}>{item.journeyId || '*'}: {item.reason || JSON.stringify(item)}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-bg-elevated border border-border rounded-lg p-4">
        <h2 className="text-base font-semibold mb-3">Failed Proofs</h2>
        {failedProofs.length === 0 ? (
          <p className="text-sm text-text-secondary">Zero failed proofs.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {failedProofs.slice(0, 50).map((item, index) => (
              <li key={`proof-${index}`}>{item.journeyId || '*'}: {item.reason || JSON.stringify(item)}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
