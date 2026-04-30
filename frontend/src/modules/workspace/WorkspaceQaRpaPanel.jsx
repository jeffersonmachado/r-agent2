import React from 'react';

function ValidationBadge({ status }) {
  const tone = status === 'passed' ? 'healthy' : status === 'failed' ? 'critical' : 'warning';
  return <span className={`workspace-pill ${tone}`}>{status || 'pendente'}</span>;
}

function valueOrDash(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value);
}

function sourceRefOf(event = {}) {
  return event.payload?.source_ref || event.payload?.sourceRef || {};
}

function metadataOf(event = {}) {
  return event.payload?.metadata || {};
}

function checksOf(event = {}) {
  const metadata = metadataOf(event);
  return metadata.checks || metadata.checksSnapshot || event.payload?.checks || {};
}

function governanceOf(event = {}) {
  const metadata = metadataOf(event);
  return metadata.governance || event.payload?.governance || null;
}

function autocorrectionOf(event = {}) {
  const metadata = metadataOf(event);
  return metadata.autocorrection || event.payload?.autocorrection || null;
}

function governanceTone(decision) {
  if (decision === 'GO') return 'healthy';
  if (decision === 'GO_WITH_WARNINGS') return 'warning';
  if (decision === 'REVIEW') return 'warning';
  return 'critical';
}

function pathLink(label, filePath) {
  if (!filePath) return null;
  return (
    <a className="workspace-link" href={`/${String(filePath).replace(/^\/+/, '')}`} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

function EvidenceWaveCard({ event }) {
  const ref = sourceRefOf(event);
  const metadata = metadataOf(event);
  const governance = governanceOf(event);
  const autocorrection = autocorrectionOf(event);
  const checks = checksOf(event);
  const failedChecks = metadata.failedChecks || Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
  const technicalStatus = metadata.qaWaveStatus || metadata.status || event.payload?.type || 'registrada';
  const operationalDecision = governance?.decision || (autocorrection?.required && !autocorrection?.created ? 'NO_GO' : 'GO');

  return (
    <article className="workspace-mini-card workspace-autocorrection-card">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="workspace-pill critical">Wave QA/RPA</span>
            <ValidationBadge status={technicalStatus} />
            <span className="workspace-pill subtle">{metadata.wave || event.payload?.source_id || 'workspace-core'}</span>
            <span className={`workspace-pill ${governanceTone(operationalDecision)}`}>Decisão: {operationalDecision}</span>
          </div>
          <h3 className="text-lg font-semibold mt-3">{event.summary}</h3>
          <p className="workspace-muted text-sm mt-1">{valueOrDash(metadata.reason || event.payload?.excerpt)}</p>
        </div>
        <div className="workspace-entity-meta">
          {pathLink('Replay', ref.replayUrl || ref.replayPath || metadata.replayPath)}
          {pathLink('Summary', ref.summaryPath || metadata.summaryPath)}
          {pathLink('Autocorrection', ref.autocorrectionPath)}
        </div>
      </div>

      <div className="workspace-autocorrection-grid mt-4">
        <div>
          <div className="workspace-section-label">Checks da wave</div>
          {Object.keys(checks).length === 0 ? <p className="workspace-muted text-sm">Sem snapshot de checks anexado.</p> : null}
          <ul className="workspace-check-list mt-2">
            {Object.entries(checks).map(([key, ok]) => (
              <li key={key} className={ok ? 'workspace-check-ok' : 'workspace-check-failed'}>
                {ok ? '✓' : '✗'} {key}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="workspace-section-label">Falhas</div>
          {failedChecks.length === 0 ? <p className="workspace-muted text-sm">Nenhuma falha informada no artefato.</p> : null}
          <ul className="workspace-check-list mt-2">
            {failedChecks.map((item) => <li key={item} className="workspace-check-failed">{item}</li>)}
          </ul>
          {autocorrection ? (
            <p className="workspace-muted text-sm mt-2">
              <strong>Autocorrection:</strong> required={String(Boolean(autocorrection.required))}, created={String(Boolean(autocorrection.created))}
            </p>
          ) : null}
          {autocorrection?.reason ? <p className="workspace-muted text-sm mt-1">{autocorrection.reason}</p> : null}
          <p className="workspace-muted text-xs mt-3">Evidence ID: {event.refId || event.payload?.id || '-'}</p>
        </div>
      </div>

      {governance ? (
        <div className="mt-4">
          <div className="workspace-section-label">Decisão de governança</div>
          <div className="workspace-entity-meta mt-2">
            <span className={`workspace-pill ${governanceTone(governance.decision)}`}>{governance.decision || '-'}</span>
            <span className={`workspace-pill ${governanceTone(governance.decision)}`}>Severidade: {governance.severity || '-'}</span>
          </div>
          <p className="workspace-muted text-sm mt-2">{governance.reason || '-'}</p>
          {(governance.failedChecks || []).length > 0 ? (
            <p className="workspace-muted text-sm mt-1"><strong>failedChecks:</strong> {governance.failedChecks.join(', ')}</p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function WorkspaceQaRpaPanel({ autocorrections, loading, timeline }) {
  const runs = autocorrections?.items || [];
  const evidenceEvents = (timeline?.items || []).filter((item) => item.type === 'evidence');
  const latestEvidence = evidenceEvents[0] || null;

  return (
    <section className="workspace-card workspace-scroll">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold">QA/RPA</h2>
          <p className="workspace-muted text-sm">Wave executada, evidence, replay, diagnóstico, patch sugerido e revisão humana.</p>
        </div>
        <span className="workspace-pill critical">{runs.length} autocorrection</span>
      </div>

      {loading ? <div className="workspace-skeleton-stack"><div className="workspace-skeleton h-28"></div><div className="workspace-skeleton h-28"></div></div> : null}

      {!loading && latestEvidence ? (
        <div className="mb-5">
          <div className="workspace-section-label">Última wave executada</div>
          <EvidenceWaveCard event={latestEvidence} />
        </div>
      ) : null}

      {!loading && runs.length === 0 && evidenceEvents.length === 0 ? (
        <div className="workspace-empty-state">
          <strong>Sem falhas QA/RPA vinculadas.</strong>
          <p className="workspace-muted text-sm mt-2">Quando uma wave, replay ou evidence falhar, o ciclo de autocorrection aparecerá aqui.</p>
        </div>
      ) : null}

      {runs.map((run) => (
        <article key={run.id} className="workspace-mini-card workspace-autocorrection-card">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="flex flex-wrap gap-2 items-center">
                <span className="workspace-pill critical">AutoCorrection</span>
                <span className="workspace-pill subtle">{run.source_type}</span>
                <ValidationBadge status={run.status || run.validation_result?.status} />
              </div>
              <h3 className="text-lg font-semibold mt-3">{run.diagnosis?.affectedModule || 'Módulo não identificado'}</h3>
              <p className="workspace-muted text-sm mt-1">Revisão humana obrigatória antes de qualquer aplicação de patch.</p>
            </div>
            <button type="button" className="workspace-secondary-button" disabled>
              Aguardando revisão humana
            </button>
          </div>

          <div className="workspace-autocorrection-grid mt-4">
            <div>
              <div className="workspace-section-label">Diagnóstico</div>
              <p><strong>Causa raiz:</strong> {run.diagnosis?.rootCause || '-'}</p>
              <p><strong>Correção recomendada:</strong> {run.diagnosis?.recommendedFix || '-'}</p>
              <p><strong>Risco:</strong> {run.diagnosis?.risk || '-'}</p>
              <p><strong>Confiança:</strong> {Math.round((run.diagnosis?.confidence || 0) * 100)}%</p>
              {(run.diagnosis?.failedChecks || []).length > 0 ? <p><strong>Checks falhos:</strong> {run.diagnosis.failedChecks.join(', ')}</p> : null}
              {run.diagnosis?.governance ? (
                <div className="mt-3">
                  <span className={`workspace-pill ${governanceTone(run.diagnosis.governance.decision)}`}>Governance: {run.diagnosis.governance.decision}</span>
                  <span className={`workspace-pill ${governanceTone(run.diagnosis.governance.decision)}`}>Severidade: {run.diagnosis.governance.severity || '-'}</span>
                  <p className="workspace-muted text-sm mt-1">{run.diagnosis.governance.reason || '-'}</p>
                </div>
              ) : null}
            </div>
            <div>
              <div className="workspace-section-label">Patch sugerido</div>
              <p>{run.proposed_patch?.patchSummary || '-'}</p>
              {(run.proposed_patch?.filesToChange || []).length > 0 ? <p><strong>Arquivos:</strong> {run.proposed_patch.filesToChange.join(', ')}</p> : null}
              <pre className="workspace-code-block">{run.proposed_patch?.diff || 'Nenhum diff candidato gerado.'}</pre>
            </div>
          </div>

          <div className="mt-4">
            <div className="workspace-section-label">Validação segura</div>
            <p className="workspace-muted text-sm">{run.validation_result?.summary || 'Sem validação registrada.'}</p>
            <ul className="workspace-check-list mt-2">
              {(run.validation_result?.steps || []).map((step) => <li key={step.command}>{step.status}: {step.command}</li>)}
              {(!run.validation_result?.steps || run.validation_result.steps.length === 0) && (run.proposed_patch?.testsToRun || []).map((testCommand) => <li key={testCommand}>sugerido: {testCommand}</li>)}
            </ul>
            <div className="workspace-entity-meta mt-3">
              {(run.actions || []).map((action) => <span key={action.id} className="workspace-pill warning">{action.type}: {action.status}</span>)}
            </div>
          </div>
        </article>
      ))}

      {!loading && evidenceEvents.length > 1 ? (
        <div className="mt-6">
          <div className="workspace-section-label">Evidências anteriores</div>
          {evidenceEvents.slice(1, 5).map((failure) => (
            <article key={failure.id || `${failure.refId}-${failure.createdAt}`} className="workspace-mini-card mt-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="workspace-pill critical">Evidence</span>
                <span className="workspace-muted text-xs">{failure.source}</span>
              </div>
              <p className="mt-2">{failure.summary}</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
