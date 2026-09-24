import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from '../../hooks/useRouter';
import {
  getEngineeringMission,
  approveEngineeringMission,
  rejectEngineeringMission,
  editEngineeringMission,
  reEnrichEngineeringMission,
  executeEngineeringMission,
  getEngineeringMissionReport,
} from '../../api/engineeringMissions';
import { useToast } from '../../components/Toast';
import { StatusBadge } from './EngineeringMissionsPage';
import { MissionReviewPanel } from './MissionReviewPanel';

/**
 * Detalhe da missão enriquecida: ORIGINAL × ENRIQUECIDO lado a lado, com provenance, aprovação,
 * histórico de versões/decisões e execução real (task do Engineer Router).
 *
 * Regras de honestidade aplicadas na tela (§42): "enriquecido" ≠ "aprovado"; "aprovado" ≠
 * "concluído"; DEGRADED (patch validado, promoção incompleta) nunca é mostrado como GREEN.
 */

const CATEGORY_STYLE = {
  POLICY_REQUIRED: { label: 'Obrigatório por política', className: 'border-amber-500/40 bg-amber-500/5' },
  INFERRED: { label: 'Inferido do contexto', className: 'border-blue-500/40 bg-blue-500/5' },
  ADDED: { label: 'Adicionado', className: 'border-emerald-500/40 bg-emerald-500/5' },
  MODIFIED: { label: 'Modificado', className: 'border-purple-500/40 bg-purple-500/5' },
  UNCHANGED: { label: 'Sem alteração', className: 'border-border-default bg-bg-primary' },
};

function ProvenanceRow({ item }) {
  const style = CATEGORY_STYLE[item.enrichmentType] || CATEGORY_STYLE.UNCHANGED;
  return (
    <li className={`rounded-lg border p-3 text-xs ${style.className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-text-primary font-medium">{typeof item.enrichedValue === 'string' ? item.enrichedValue : JSON.stringify(item.enrichedValue)}</div>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-text-secondary">{item.riskImpact || 'LOW'}</span>
      </div>
      <div className="mt-2 text-text-secondary">
        <span className="font-semibold">fonte:</span> {item.source}
        {item.ruleId ? <> · <span className="font-semibold">regra:</span> {item.ruleId}</> : null}
        {item.confidence !== null && item.confidence !== undefined ? <> · <span className="font-semibold">confiança:</span> {item.confidence}</> : null}
      </div>
      <div className="mt-1 text-text-secondary"><span className="font-semibold">motivo:</span> {item.reason}</div>
    </li>
  );
}

export function EngineeringMissionDetailPage({ missionId }) {
  const { navigate } = useRouter();
  const { showToast } = useToast();
  const [mission, setMission] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editForm, setEditForm] = useState({ allowedPaths: '', testCommands: '', maxIterations: '' });
  const [report, setReport] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getEngineeringMission(missionId);
      setMission(data);
      setEditForm({
        allowedPaths: (data.currentSpec?.allowedPaths || []).join('\n'),
        testCommands: (data.currentSpec?.testCommands || []).join('\n'),
        maxIterations: data.currentSpec?.maxIterations ?? '',
      });
    } catch (err) {
      showToast?.(err.message || 'Falha ao carregar missão', 'error');
    } finally {
      setLoading(false);
    }
  }, [missionId, showToast]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn, successMessage) => {
    setBusy(true);
    try {
      await fn();
      showToast?.(successMessage, 'success');
      await load();
    } catch (err) {
      showToast?.(err.message || 'Falha na operação', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !mission) {
    return <div className="p-6 text-text-secondary">Carregando missão…</div>;
  }

  const preview = mission.preview || {};
  const enriched = preview.enriched || {};
  const approval = mission.executionApproval;
  const canApprove = ['AWAITING_APPROVAL', 'ENRICHING'].includes(mission.status);
  const canExecute = mission.status === 'APPROVED' || mission.status === 'DEGRADED';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <button type="button" onClick={() => navigate('/dev/engineering/missions')} className="text-xs text-text-secondary mb-1">
            ← Missões
          </button>
          <h1 className="text-xl font-bold text-text-primary">{mission.title}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm">
            <StatusBadge status={mission.displayStatus} />
            <span className="text-text-secondary">v{mission.current_version}</span>
            <span className="text-text-secondary">{mission.mission_type}</span>
            <span className="text-text-secondary">risco {mission.risk}</span>
            <span className="text-text-secondary">confiança {mission.enrichment_confidence}</span>
            <span className="text-text-secondary">modo {mission.approval_mode}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => act(() => reEnrichEngineeringMission(missionId, { contextHints: {} }), 'Missão re-enriquecida (nova versão)')}
            className="px-3 py-2 rounded-lg border border-border-default bg-bg-elevated text-sm text-text-primary disabled:opacity-50"
          >
            Reenriquecer
          </button>
          <button
            type="button"
            disabled={busy || !canApprove}
            onClick={() => act(() => approveEngineeringMission(missionId, { reason: 'aprovada na interface DEVELOPMENT' }), 'Missão aprovada')}
            className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:opacity-40"
          >
            Aprovar missão
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => act(() => rejectEngineeringMission(missionId, { reason: 'rejeitada na interface DEVELOPMENT' }), 'Missão rejeitada')}
            className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-medium disabled:opacity-40"
          >
            Rejeitar
          </button>
          <button
            type="button"
            disabled={busy || !canExecute}
            onClick={() => act(() => executeEngineeringMission(missionId, {}), 'Execução iniciada no Engineer Router')}
            className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-40"
          >
            Executar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              try {
                setReport(await getEngineeringMissionReport(missionId));
              } catch (err) {
                showToast?.(err.message || 'Falha ao carregar relatório', 'error');
              }
            }}
            className="px-3 py-2 rounded-lg border border-border-default bg-bg-elevated text-sm text-text-primary"
          >
            Relatório de auditoria
          </button>
        </div>
      </div>

      {approval?.state === 'AUTO_APPROVED' && (
        <div className="rounded-xl border border-purple-500/40 bg-purple-500/5 p-4 text-sm text-text-primary">
          <strong>Autoaprovada por política</strong> ({approval.policyId}) — o preview abaixo foi gerado e
          persistido. Autoaprovação autoriza execução, nunca GREEN.
          {approval.rulesEvaluated?.length ? <div className="text-xs text-text-secondary mt-1">regras avaliadas: {approval.rulesEvaluated.join(', ')}</div> : null}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-sm font-bold text-text-primary mb-2">Missão original (imutável)</h2>
          <p className="text-sm text-text-primary whitespace-pre-wrap">{preview.original?.mission || mission.original_mission}</p>
          <div className="mt-3 text-xs text-text-secondary break-all">
            hash: {mission.original_mission_hash}
          </div>
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-sm font-bold text-text-primary mb-2">Missão enriquecida</h2>
          <p className="text-sm text-text-primary whitespace-pre-wrap">{enriched.objective}</p>
          <div className="mt-3 space-y-1 text-xs text-text-secondary">
            <div><span className="font-semibold">subsistemas:</span> {(enriched.subsystems || []).join(', ') || '—'}</div>
            <div><span className="font-semibold">fontes de contexto:</span> {(enriched.contextSources || []).join(', ') || '—'}</div>
            <div><span className="font-semibold">validações derivadas:</span> {(enriched.testStrategy || []).join(', ') || '—'}</div>
            {enriched.missionTypeInferred ? <div>tipo de missão inferido do texto (revisável)</div> : null}
          </div>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
        <h2 className="text-sm font-bold text-text-primary mb-3">Diff do enriquecimento</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(preview.sections || []).filter((s) => s.category !== 'UNCHANGED' && s.items.length > 0).map((section) => (
            <div key={section.category}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
                {section.label} ({section.items.length})
              </h3>
              <ul className="space-y-2">
                {section.items.map((item, idx) => <ProvenanceRow key={`${section.category}-${idx}`} item={item} />)}
              </ul>
            </div>
          ))}
        </div>
        {preview.materiality ? (
          <div className="mt-4 text-xs text-text-secondary">
            materialidade: <strong>{preview.materiality.level}</strong>
            {preview.materiality.reasons?.length ? ` — ${preview.materiality.reasons.map((r) => r.code).join(', ')}` : ''}
          </div>
        ) : null}
        {preview.autoApproval?.blockers?.length ? (
          <div className="mt-2 text-xs text-amber-500">
            bloqueios de autoaprovação: {preview.autoApproval.blockers.map((b) => b.code).join(', ')}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-sm font-bold text-text-primary mb-3">Contrato de execução (editar e aprovar)</h2>
          <label className="block text-xs text-text-secondary">Arquivos permitidos (um por linha)</label>
          <textarea
            rows={3}
            value={editForm.allowedPaths}
            onChange={(e) => setEditForm((f) => ({ ...f, allowedPaths: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-border-default bg-bg-primary text-xs text-text-primary mb-2"
          />
          <label className="block text-xs text-text-secondary">Comandos de teste (um por linha)</label>
          <textarea
            rows={2}
            value={editForm.testCommands}
            onChange={(e) => setEditForm((f) => ({ ...f, testCommands: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-border-default bg-bg-primary text-xs text-text-primary mb-2"
          />
          <label className="block text-xs text-text-secondary">Máx. iterações</label>
          <input
            type="number"
            min="1"
            max="10"
            value={editForm.maxIterations}
            onChange={(e) => setEditForm((f) => ({ ...f, maxIterations: e.target.value }))}
            className="w-32 px-3 py-2 rounded-lg border border-border-default bg-bg-primary text-xs text-text-primary mb-3"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => act(() => editEngineeringMission(missionId, {
              patch: {
                allowedPaths: editForm.allowedPaths.split('\n').map((s) => s.trim()).filter(Boolean),
                testCommands: editForm.testCommands.split('\n').map((s) => s.trim()).filter(Boolean),
                ...(editForm.maxIterations ? { maxIterations: Number(editForm.maxIterations) } : {}),
              },
              reason: 'contrato de execução editado na interface DEVELOPMENT',
            }), 'Nova versão criada e aprovada')}
            className="px-3 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium disabled:opacity-50"
          >
            Editar e aprovar
          </button>
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-sm font-bold text-text-primary mb-3">Execução</h2>
          {mission.task ? (
            <div className="space-y-1 text-sm">
              <div className="text-text-primary">task <code className="text-xs">{mission.task.id}</code></div>
              <div className="text-text-secondary">status: <span className="text-text-primary">{mission.task.status}</span></div>
              <div className="text-text-secondary">tipo: {mission.task.taskType} · risco {mission.task.risk}</div>
              {mission.task.routingDecision?.coder ? (
                <div className="text-text-secondary text-xs">
                  coder: {mission.task.routingDecision.coder.providerId}:{mission.task.routingDecision.coder.modelId}
                  {mission.task.routingDecision.reviewer ? <> · reviewer: {mission.task.routingDecision.reviewer.providerId}:{mission.task.routingDecision.reviewer.modelId}</> : null}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-text-secondary">Ainda não executada. Aprovar autoriza a execução; GREEN só existe após os gates reais passarem.</p>
          )}
        </div>
      </div>

      <MissionReviewPanel missionId={missionId} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-sm font-bold text-text-primary mb-3">Histórico de versões</h2>
          <ul className="space-y-2 text-xs">
            {(mission.versions || []).map((v) => (
              <li key={v.version} className="flex items-center justify-between border border-border-default rounded-lg px-3 py-2">
                <span className="text-text-primary">v{v.version} · {v.event} · {v.materiality}</span>
                <span className="text-text-secondary">{new Date(v.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-sm font-bold text-text-primary mb-3">Histórico de decisões</h2>
          <ul className="space-y-2 text-xs">
            {(mission.approvals || []).map((a) => (
              <li key={a.id} className="border border-border-default rounded-lg px-3 py-2">
                <div className="text-text-primary font-medium">{a.state} · v{a.spec_version} · {a.mode}</div>
                <div className="text-text-secondary">{a.decision_reason}</div>
                <div className="text-text-secondary">ator: {a.actor || '—'} · {a.decided_at ? new Date(a.decided_at).toLocaleString() : 'pendente'}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {report && (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-sm font-bold text-text-primary mb-2">Relatório de auditoria</h2>
          <pre className="text-xs text-text-secondary overflow-auto max-h-96">{JSON.stringify({
            originalMission: report.originalMission,
            trace: report.trace,
            approvals: report.approvals.map((a) => ({ state: a.state, mode: a.mode, policyId: a.policyId, specVersion: a.specVersion })),
            execution: { taskStatus: report.execution.taskStatus, attempts: report.execution.attempts.length, reviews: report.execution.reviews },
          }, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default EngineeringMissionDetailPage;
