import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from '../../hooks/useRouter';
import {
  listEngineeringMissions,
  compileEngineeringMission,
  getEngineeringMissionPolicy,
  setEngineeringMissionPolicy,
  resumeInterruptedEngineeringMissions,
  getEngineeringMissionSelfAssessment,
} from '../../api/engineeringMissions';
import { useToast } from '../../components/Toast';

/**
 * Missões de engenharia (DEVELOPMENT): o usuário escreve a intenção em linguagem NATURAL e o
 * sistema compila, enriquece e mostra exatamente o que foi acrescentado antes de executar.
 */

const DISPLAY_BADGE = {
  CREATED: 'bg-bg-elevated text-text-secondary border-border-default',
  ENRICHING: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
  AWAITING_APPROVAL: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  AUTO_APPROVED: 'bg-purple-500/15 text-purple-500 border-purple-500/30',
  APPROVED: 'bg-cyan-500/15 text-cyan-500 border-cyan-500/30',
  RUNNING: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  GREEN: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  BLOCKED: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  FAILED: 'bg-red-500/15 text-red-500 border-red-500/30',
  DEGRADED: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
  REJECTED: 'bg-red-500/15 text-red-400 border-red-500/30',
  CANCELLED: 'bg-bg-elevated text-text-secondary border-border-default',
};

const RISK_BADGE = {
  LOW: 'text-emerald-500',
  MEDIUM: 'text-amber-500',
  HIGH: 'text-orange-500',
  CRITICAL: 'text-red-500',
};

export function StatusBadge({ status }) {
  return (
    <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium border ${DISPLAY_BADGE[status] || 'bg-bg-elevated text-text-secondary border-border-default'}`}>
      {status}
    </span>
  );
}

function SelfAssessmentCard() {
  const { showToast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async (persist = false) => {
    setLoading(true);
    try {
      setData(await getEngineeringMissionSelfAssessment({ persist }));
      if (persist) showToast?.('Retrato persistido em reports/engineering-mission-self-assessment.json', 'success');
    } catch (err) {
      showToast?.(err.message || 'Falha ao calcular autoavaliação', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-5 mb-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-text-primary">Autoavaliação contínua</h3>
        <div className="flex gap-2">
          <button type="button" disabled={loading} onClick={() => load(false)} className="px-3 py-1.5 rounded-lg border border-border-default bg-bg-primary text-xs text-text-primary disabled:opacity-50">
            Calcular
          </button>
          <button type="button" disabled={loading} onClick={() => load(true)} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium disabled:opacity-50">
            Calcular e persistir
          </button>
        </div>
      </div>
      {!data ? (
        <p className="text-xs text-text-secondary mt-2">
          Mede taxa de aprovação humana, autoaprovação, edição pós-enriquecimento, degradação,
          desempenho por provedor/modelo e regressões. Campos nulos significam ausência de medição —
          nunca zero.
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
          {[
            ['missões analisadas', data.window.missionsAnalyzed],
            ['enriquecidas', data.enrichment.missionsEnriched],
            ['taxa aprovação humana', data.approval.humanApprovalRate],
            ['taxa autoaprovação', data.approval.autoApprovalRate],
            ['taxa rejeição', data.approval.rejectionRate],
            ['taxa de degradação', data.enrichment.degradedRate],
            ['confiança média', data.enrichment.avgConfidence],
            ['req. derivados (média)', data.enrichment.avgDerivedRequirements],
            ['executadas', data.execution.executed],
            ['review meta (runs)', data.reviews.metaRuns],
            ['ataques sem teste', data.reviews.uncoveredAdversarialCases],
            ['tokens totais', data.cost.totalTokens],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border-default p-2">
              <div className="text-text-secondary">{label}</div>
              <div className="text-text-primary font-semibold">{value === null || value === undefined ? '—' : String(value)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AutoApprovalPolicyPanel() {
  const { showToast } = useToast();
  const [policy, setPolicy] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getEngineeringMissionPolicy().then(setPolicy).catch(() => setPolicy(null));
  }, []);

  if (!policy) return null;

  const save = async (patch) => {
    setSaving(true);
    try {
      const next = { ...policy, ...patch };
      const saved = await setEngineeringMissionPolicy(next);
      setPolicy(saved);
      showToast?.('Política de autoaprovação atualizada', 'success');
    } catch (err) {
      showToast?.(err.message || 'Falha ao salvar política', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-5 mb-6">
      <h3 className="text-sm font-bold text-text-primary mb-3">Política de autoaprovação</h3>
      <p className="text-xs text-text-secondary mb-4">
        Autoaprovar autoriza apenas <strong>começar a executar</strong> a missão enriquecida. Não autoriza
        GREEN, não pula review, adversarial, regressão nem evidência — e o preview continua sendo
        gerado e persistido mesmo quando aprovada automaticamente.
      </p>
      <div className="space-y-3 text-sm">
        <label className="flex items-center gap-2 text-text-primary">
          <input
            type="checkbox"
            checked={policy.enabled === true}
            disabled={saving}
            onChange={(e) => save({ enabled: e.target.checked, mode: e.target.checked && policy.mode === 'MANUAL' ? 'POLICY_BASED' : policy.mode })}
          />
          Habilitar autoaprovação
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Modo
            <select
              value={policy.mode}
              disabled={saving}
              onChange={(e) => save({ mode: e.target.value })}
              className="px-3 py-2 rounded-lg border border-border-default bg-bg-primary text-sm text-text-primary"
            >
              <option value="MANUAL">MANUAL (toda missão aguarda humano)</option>
              <option value="SAFE_ONLY">SAFE_ONLY (apenas reversível/baixo risco)</option>
              <option value="POLICY_BASED">POLICY_BASED (segue política configurada)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Risco máximo
            <select
              value={policy.maxRisk}
              disabled={saving}
              onChange={(e) => save({ maxRisk: e.target.value })}
              className="px-3 py-2 rounded-lg border border-border-default bg-bg-primary text-sm text-text-primary"
            >
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Confiança mínima
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={policy.confidenceThreshold}
              disabled={saving}
              onChange={(e) => setPolicy((p) => ({ ...p, confidenceThreshold: Number(e.target.value) }))}
              onBlur={(e) => save({ confidenceThreshold: Number(e.target.value) })}
              className="px-3 py-2 rounded-lg border border-border-default bg-bg-primary text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Branches permitidas (separadas por vírgula)
            <input
              type="text"
              value={(policy.allowedBranches || []).join(', ')}
              disabled={saving}
              onChange={(e) => setPolicy((p) => ({ ...p, allowedBranches: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))}
              onBlur={(e) => save({ allowedBranches: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              className="px-3 py-2 rounded-lg border border-border-default bg-bg-primary text-sm text-text-primary"
            />
          </label>
        </div>
        <div className="text-xs text-text-secondary">
          Bloqueios por definição (nunca autoaprovados): tenant isolation, segredos/credenciais,
          RBAC, operação destrutiva/irreversível, schema incompatível e autorização explícita de
          escopo irrestrito.
        </div>
      </div>
    </div>
  );
}

export function EngineeringMissionsPage() {
  const { showToast } = useToast();
  const { navigate } = useRouter();
  const [missions, setMissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [missionText, setMissionText] = useState('');
  const [hints, setHints] = useState({ touchesDatabase: false, touchesMultiTenant: false, touchesSecrets: false, touchesFrontend: false });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listEngineeringMissions({ limit: 50 });
      setMissions(data.missions || []);
    } catch (err) {
      showToast?.(err.message || 'Falha ao listar missões', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (!missionText.trim()) return;
    setSubmitting(true);
    try {
      const result = await compileEngineeringMission({
        mission: missionText,
        contextHints: Object.fromEntries(Object.entries(hints).filter(([, v]) => v === true)),
      });
      showToast?.(
        result.autoApproved
          ? `Missão enriquecida e autoaprovada por política (v${result.mission.current_version})`
          : `Missão enriquecida — aguardando aprovação (v${result.mission.current_version})`,
        'success',
      );
      setMissionText('');
      navigate(`/dev/engineering/missions/${result.mission.id}`);
    } catch (err) {
      showToast?.(err.message || 'Falha ao compilar missão', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const resume = async () => {
    try {
      const summary = await resumeInterruptedEngineeringMissions();
      showToast?.(`Retomada: ${summary.enriched} enriquecidas, ${summary.executed} executadas, ${summary.reconciled} reconciliadas`, 'success');
      load();
    } catch (err) {
      showToast?.(err.message || 'Falha na retomada', 'error');
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Engineering Missions</h1>
          <p className="text-sm text-text-secondary">
            Descreva o que você quer em linguagem natural. O sistema investiga o contexto, enriquece a
            missão, mostra exatamente o que acrescentou e só então executa — com auditoria completa.
          </p>
        </div>
        <button
          type="button"
          onClick={resume}
          className="px-3 py-2 rounded-lg border border-border-default bg-bg-elevated text-sm text-text-primary"
        >
          Retomar missões interrompidas
        </button>
      </div>

      <form onSubmit={submit} className="bg-bg-elevated rounded-xl border border-border-default p-5 mb-6 space-y-3">
        <label className="block text-sm font-semibold text-text-primary">Missão (linguagem natural)</label>
        <textarea
          required
          rows={3}
          value={missionText}
          onChange={(e) => setMissionText(e.target.value)}
          placeholder="Ex.: Corrija definitivamente a importação do EVO e deixe tudo verde."
          className="w-full px-3 py-2 rounded-lg border border-border-default bg-bg-primary text-sm text-text-primary"
        />
        <div className="flex flex-wrap gap-4 text-xs text-text-secondary">
          {[
            ['touchesDatabase', 'toca banco/schema'],
            ['touchesMultiTenant', 'toca multi-tenant'],
            ['touchesSecrets', 'toca segredos/credenciais'],
            ['touchesFrontend', 'toca frontend'],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={hints[key]}
                onChange={(e) => setHints((h) => ({ ...h, [key]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
        >
          {submitting ? 'Enriquecendo…' : 'Enriquecer missão'}
        </button>
      </form>

      <AutoApprovalPolicyPanel />

      <SelfAssessmentCard />

      <div className="bg-bg-elevated rounded-xl border border-border-default overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-primary text-text-secondary text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2">Missão original</th>
              <th className="text-left px-4 py-2">Tipo</th>
              <th className="text-left px-4 py-2">Risco</th>
              <th className="text-left px-4 py-2">Versão</th>
              <th className="text-left px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-text-secondary">Carregando…</td></tr>
            )}
            {!loading && missions.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-text-secondary">Nenhuma missão ainda.</td></tr>
            )}
            {missions.map((m) => (
              <tr
                key={m.id}
                className="border-t border-border-default cursor-pointer hover:bg-bg-primary/50"
                onClick={() => navigate(`/dev/engineering/missions/${m.id}`)}
              >
                <td className="px-4 py-3 text-text-primary">{m.title || m.original_mission}</td>
                <td className="px-4 py-3 text-text-secondary">{m.mission_type}</td>
                <td className={`px-4 py-3 font-medium ${RISK_BADGE[m.risk] || ''}`}>{m.risk}</td>
                <td className="px-4 py-3 text-text-secondary">v{m.current_version}</td>
                <td className="px-4 py-3"><StatusBadge status={m.displayStatus || m.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
