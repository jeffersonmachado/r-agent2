import React, { useCallback, useEffect, useState } from 'react';
import { fetchJson } from '../api/client';

function Badge({ value, neutral = false }) {
  if (neutral) {
    return (
      <span className="inline-flex rounded px-2 py-1 text-xs font-semibold bg-bg-secondary text-text-secondary">
        —
      </span>
    );
  }
  const go = String(value || '').toUpperCase() === 'GO';
  return (
    <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${go ? 'bg-status-success/10 text-status-success' : 'bg-status-error/10 text-status-error'}`}>
      {value || 'N/A'}
    </span>
  );
}

function Tile({ label, value, good }) {
  return (
    <div className="bg-bg-elevated border border-border-default rounded-lg p-4">
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
  // Sem relatório carregado NÃO existe veredito. Renderizar "BLOCKED"/"INVALID"
  // durante o carregamento (ou após erro) apresenta falha de governança que não
  // foi medida — num console de governança isso é indistinguível de falha real.
  const hasReport = report !== null && typeof report === 'object';
  const pendingLabel = '—';
  const tileValue = (value) => (hasReport ? value : pendingLabel);
  const tileGood = (value) => (hasReport ? value : undefined);
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

      {error ? <div className="border border-status-error/30 bg-status-error/10 text-status-error rounded-md p-3 text-sm">{error}</div> : null}

      <section className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <Tile label="Global GO/NO_GO" value={<Badge value={globalDecision} neutral={!hasReport} />} good={tileGood(String(globalDecision).startsWith('GO'))} />
        <Tile label="Operational Confidence" value={tileValue(`${report?.operationalConfidence ?? 0}%`)} good={tileGood((report?.operationalConfidence || 0) >= (report?.threshold || 95))} />
        <Tile label="Runtime Governance" value={tileValue(runtimeGovernanceLabel)} good={tileGood(runtimeGovernanceGood)} />
        <Tile label="Release Readiness" value={tileValue(report?.releaseReadiness?.go ? 'READY' : 'BLOCKED')} good={tileGood(report?.releaseReadiness?.go === true)} />
        <Tile label="Deployment Safety" value={tileValue(deployAllowed ? 'ALLOWED' : 'BLOCKED')} good={tileGood(deployAllowed)} />
      </section>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Tile label="Replay Integrity" value={tileValue(report?.replayIntegrity?.valid ? 'VALID' : 'INVALID')} good={tileGood(report?.replayIntegrity?.valid === true)} />
        <Tile label="Governance Signatures" value={tileValue(report?.governanceSignature?.valid ? 'VALID' : 'INVALID')} good={tileGood(report?.governanceSignature?.valid === true)} />
        <Tile label="Failed Proofs" value={tileValue(failedProofs.length)} good={tileGood(failedProofs.length === 0)} />
        <Tile label="Runtime Risk" value={tileValue(report?.riskLevel || 'N/A')} good={tileGood(report?.riskLevel === 'LOW')} />
      </section>

      <section className="bg-bg-elevated border border-border-default rounded-lg p-4">
        <h2 className="text-base font-semibold mb-3">Smoke Lineage</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-text-secondary">Last smoke</div>
            <div className="font-medium">{tileValue(report?.lastSmokeExecution?.generatedAt || 'N/A')}</div>
          </div>
          <div>
            <div className="text-text-secondary">Continuous validation</div>
            <div className="font-medium">{tileValue(report?.continuousValidationStatus?.status || 'N/A')}</div>
          </div>
          <div>
            <div className="text-text-secondary">Tenant</div>
            <div className="font-medium break-all">{tileValue(report?.lastSmokeExecution?.tenantId || 'N/A')}</div>
          </div>
        </div>
      </section>

      <section className="bg-bg-elevated border border-border-default rounded-lg p-4">
        <h2 className="text-base font-semibold mb-3">Replay Artifacts</h2>
        <div className="space-y-2 text-sm">
          {(report?.replayArtifacts || []).map((artifact) => (
            <div key={artifact.journeyId} className="rounded border border-border-default bg-bg-default p-3">
              <div className="font-semibold">{artifact.journeyId}</div>
              <div className="text-xs text-text-secondary break-all">hash: {artifact.replayHash}</div>
              <div className="text-xs text-text-secondary break-all">checksum: {artifact.replayChecksum}</div>
              <div className="text-xs text-text-secondary break-all">signature: {artifact.governanceSignature}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-bg-elevated border border-border-default rounded-lg p-4">
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

      <section className="bg-bg-elevated border border-border-default rounded-lg p-4">
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
