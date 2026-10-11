import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import { buildWaiverOptions } from '../shared/securityIntel/waiverOptions';
import {
  indexWaiversByFinding,
  selectPendingFindings,
  semCorrecaoPublicada,
  summarizePendingFindings,
} from '../shared/securityIntel/pendingFindings';
import {
  approveSecurityWaiver,
  createSecurityPatchMission,
  createSecurityWaiver,
  generateSecurityPatchPlans,
  getSecurityFindingTimeline,
  getSecurityIntelSummary,
  getSecurityInventory,
  getSecurityVectorIndex,
  listSecurityAdvisories,
  listSecurityFindings,
  listSecurityPatches,
  listSecurityWaivers,
  getSecurityTriage,
  revokeSecurityWaiver,
  runSecurityScan,
} from '../api/securityIntel';

/**
 * Inteligência de versões e segurança (superfície de ENGENHARIA / DEVELOPMENT).
 *
 * A tela não afirma segurança: ela mostra o que foi medido, com que idade, e o
 * que NÃO foi medido. Uma base de advisories vencida ou um índice vetorial não
 * saudável aparecem como alerta bloqueante — "0 achados" nunca é apresentado
 * como "sem vulnerabilidades".
 *
 * Estilo: classes utilitárias com os tokens semânticos do tema
 * (`bg-bg-elevated`, `border-border-default`, `text-text-primary/secondary`),
 * o mesmo padrão das outras páginas de engenharia.
 */

const PAGE = 'p-6 max-w-6xl mx-auto';
const CARD = 'bg-bg-elevated rounded-xl border border-border-default p-5';
const TABLE_WRAP = 'bg-bg-elevated rounded-xl border border-border-default overflow-x-auto';
const TH = 'p-3 border-b border-border-default text-left text-text-secondary text-xs uppercase tracking-wide';
const TD = 'p-3 border-b border-border-default last:border-0 align-top text-sm text-text-primary';
const BTN_PRIMARY = 'px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50';
const BTN_SECONDARY = 'px-3 py-2 rounded-lg border border-border-default bg-bg-primary text-sm text-text-primary hover:bg-bg-hover disabled:opacity-50';
const BTN_SMALL = 'px-2 py-1 rounded-lg border border-border-default bg-bg-primary text-xs text-text-primary hover:bg-bg-hover';
const FIELD = 'border border-border-default rounded-lg px-3 py-2 bg-bg-primary text-sm text-text-primary';

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL'];

/** Linhas exibidas por tabela: corte de EXIBIÇÃO, sempre declarado na tela. */
const INVENTORY_ROWS = 25;
const TRIAGE_ROWS = 40;

const SEVERITY_LABELS = {
  CRITICAL: 'Crítica',
  HIGH: 'Alta',
  MEDIUM: 'Média',
  LOW: 'Baixa',
  INFORMATIONAL: 'Informativa',
  UNKNOWN: 'Desconhecida',
};

const SEVERITY_TONES = {
  CRITICAL: 'bg-red-500/15 text-red-500 border-red-500/30',
  HIGH: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
  MEDIUM: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  LOW: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
};

const STATUS_LABELS = {
  DETECTED: 'Detectado',
  CONFIRMED_APPLICABLE: 'Aplicável',
  NOT_AFFECTED: 'Não afetado',
  MITIGATED: 'Mitigado',
  FIX_AVAILABLE: 'Correção disponível',
  NO_FIX_AVAILABLE: 'Sem correção publicada',
  UNDER_INVESTIGATION: 'Em investigação',
  FALSE_POSITIVE: 'Falso positivo',
  RESOLVED: 'Resolvido',
};

const AUTONOMY_LABELS = {
  LEVEL_A_AUTOMATIC: 'Nível A — automático',
  LEVEL_B_ISOLATED: 'Nível B — isolado',
  LEVEL_C_PRODUCTION: 'Nível C — produção (exige aprovação)',
};

const KIND_LABELS = {
  DIRECT_BUMP: 'Bump direto',
  TRANSITIVE_OVERRIDE: 'Override transitivo',
  IMAGE_REBUILD: 'Rebuild de imagem',
  RUNTIME_UPGRADE: 'Upgrade de runtime',
  NO_PATCH: 'Sem patch',
  NOT_APPLICABLE: 'Não aplicável',
};

const VECTOR_VERDICT_LABELS = {
  HEALTHY: 'Saudável',
  DEGRADED: 'Degradado',
  INVALID: 'Inválido',
  UNKNOWN: 'Não medido',
};

/** Rótulos curtos dos buckets da fila de triagem (o motivo completo vem do dado). */
const TRIAGE_BUCKET_LABELS = {
  WAIVER_OR_COMPENSATING_CONTROL: 'Sem correção publicada',
  HUMAN_APPROVAL: 'Exige aprovação humana',
  AUTO_ISOLATED: 'Missão isolada (Nível B)',
};

const TRIAGE_BUCKET_TONES = {
  WAIVER_OR_COMPENSATING_CONTROL: 'bg-red-500/15 text-red-500 border-red-500/30',
  HUMAN_APPROVAL: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  AUTO_ISOLATED: 'bg-bg-tertiary text-text-secondary border-border-default',
};

const ERROR_MESSAGES = {
  unauthorized: 'Sessão expirada. Autentique-se novamente.',
  classification_required: 'Sua classificação não permite acessar a superfície de engenharia (DEVELOPMENT).',
  tenant_required: 'Selecione um tenant antes de consultar a inteligência de segurança.',
  tenant_invalid: 'Tenant inválido para esta consulta.',
  persistence_required: 'O banco de dados não está disponível: a leitura seria degradada, então foi recusada.',
  // Autoridade de aprovação: a identidade vem da sessão e a permissão é por ação.
  forbidden: 'Sua sessão não tem permissão para esta ação (aceitar risco, revogar isenção ou submeter correção).',
  approval_identity_not_accepted: 'A identidade de quem aprova é derivada da sessão autenticada — ela não é declarada na requisição.',
  approval_identity_unresolvable: 'Sessão sem identidade utilizável para assinar a operação.',
  route_action_undeclared: 'Rota sem autorização declarada (falha de configuração, não do seu acesso).',
  patch_candidate_requires_authorization: 'Candidato de Nível C (produção) exige autorização explícita da sessão autenticada.',
  patch_candidate_not_found: 'Candidato de patch não encontrado.',
  waiver_expiry_required: 'Informe o prazo em dias: isenção sem expiração não é permitida.',
  waiver_expiry_not_in_future: 'O prazo precisa estar no futuro.',
  waiver_exceeds_max_days: 'Prazo acima do limite da política de waivers.',
  waiver_reason_required: 'Descreva o motivo da aceitação do risco (mínimo de 20 caracteres).',
  waiver_requester_required: 'A solicitação precisa ter solicitante identificado (derivado da sessão).',
  waiver_approver_required: 'A sessão autenticada precisa ter identidade utilizável para aprovar.',
  waiver_self_approval_forbidden: 'Quem solicita a isenção não pode aprová-la: a aprovação exige outro usuário.',
  waiver_scope_changed: 'O escopo mudou desde a solicitação (pacote, serviço, severidade ou prazo): a aprovação não vale para o escopo novo.',
  waiver_approval_conflict: 'A isenção já foi decidida por outra sessão (aprovação concorrente).',
  waiver_revoked_cannot_approve: 'Isenção revogada não pode ser aprovada.',
  waiver_expired_cannot_approve: 'Isenção expirada não pode ser aprovada.',
  waiver_not_needed_for_vex_state: 'Este achado não é risco aberto (já descartado por VEX ou resolvido) — não precisa de isenção.',
  waiver_finding_not_found: 'Achado não encontrado no inventário atual.',
  waiver_not_found: 'Waiver não encontrado.',
};

function messageOf(error) {
  const raw = String(error?.message || '');
  const match = Object.keys(ERROR_MESSAGES).find((code) => raw.includes(code));
  return match ? ERROR_MESSAGES[match] : raw || 'Falha inesperada na consulta.';
}

function formatHours(hours) {
  if (hours === null || hours === undefined) return 'não medida';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round(hours / 24)} d`;
}

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('pt-BR');
  } catch {
    return String(value);
  }
}

function Badge({ tone = '', className = '', children }) {
  // O tom neutro usa o token de fundo terciário de @theme (frontend/src/index.css).
  // Um token "subtle" de fundo NÃO existe neste tema — classe inexistente vira
  // no-op silencioso e o badge ficaria sem fundo.
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${tone || 'bg-bg-tertiary text-text-secondary border-border-default'} ${className}`}>
      {children}
    </span>
  );
}

function KpiCard({ label, value, tone = 'text-text-primary' }) {
  return (
    <div className={CARD}>
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      <div className="text-xs text-text-secondary mt-1">{label}</div>
    </div>
  );
}

function Banner({ variant = 'danger', children }) {
  const tones = {
    danger: 'border-red-500/40 bg-red-500/5 text-red-400',
    warning: 'border-amber-500/40 bg-amber-500/5 text-amber-400',
  };
  return (
    <div className={`mb-4 rounded-lg border p-3 text-sm ${tones[variant]}`} role={variant === 'danger' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function SecurityIntelligencePage() {
  const { showToast, ToastContainer } = useToast();

  const [summary, setSummary] = useState(null);
  const [findings, setFindings] = useState({ items: [], total: 0 });
  const [patches, setPatches] = useState({ items: [], total: 0 });
  const [vectorIndex, setVectorIndex] = useState(null);
  const [advisories, setAdvisories] = useState(null);
  const [inventory, setInventory] = useState({ items: [], total: 0 });
  const [inventorySearch, setInventorySearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [onlyKev, setOnlyKev] = useState(false);
  // Filtro "apenas pendências": restringe a lista ao que EXIGE DECISÃO HUMANA —
  // achado sem correção publicada (`NO_FIX_AVAILABLE`, só sai por isenção) ou com
  // isenção aguardando aprovação. Severidade alta COM correção disponível NÃO
  // entra: isso é missão de correção, não pendência de decisão. O cálculo é sobre
  // os achados CARREGADOS (a lista é paginada pelo backend) e a tela declara isso.
  const [onlyPending, setOnlyPending] = useState(false);
  // Achados descartados por VEX (não afetado / falso positivo) são registros
  // auditáveis, mas NÃO são risco: ficam fora da contagem por padrão, como no KPI.
  const [includeVex, setIncludeVex] = useState(false);
  const [timeline, setTimeline] = useState(null);
  const [waivers, setWaivers] = useState({ items: [], total: 0, maxWaiverDays: null });
  const [triage, setTriage] = useState(null);
  const [waiverForm, setWaiverForm] = useState({
    findingKey: '', reason: '', expiresInDays: 30, compensatingControl: '',
  });
  const [waiverFilter, setWaiverFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Refs de navegação interna: a ação "Isentar" do grid leva o operador até o
  // formulário de isenção e foca o motivo. Sem esse retorno visível o clique
  // parece não fazer nada (foi o defeito relatado).
  const waiverFormRef = useRef(null);
  const waiverReasonRef = useRef(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryData, findingsData, patchesData, advisoryData, waiverData] = await Promise.all([
        getSecurityIntelSummary(),
        // `limit` explícito no teto aceito pela API: sem isso o padrão do backend
        // (100) cortava a lista e o seletor de isenção não alcançava achados.
        listSecurityFindings({
          severity: severityFilter || undefined,
          kev: onlyKev ? 'true' : undefined,
          // KEV significa risco explorado: usa sempre a definição de risco aberto.
          // Fora disso, o VEX só aparece se o usuário pedir explicitamente.
          riskOnly: onlyKev || !includeVex ? 'true' : undefined,
          limit: 500,
        }),
        listSecurityPatches({ limit: 100 }),
        listSecurityAdvisories(),
        // `ALL`: a tela precisa ver as SOLICITAÇÕES pendentes (para aprová-las)
        // além das isenções vigentes. O gate só considera ACTIVE.
        listSecurityWaivers({ state: 'ALL' }),
      ]);
      setSummary(summaryData);
      setFindings(findingsData || { items: [], total: 0 });
      setPatches(patchesData || { items: [], total: 0 });
      setAdvisories(advisoryData);
      setWaivers(waiverData || { items: [], total: 0, maxWaiverDays: null });
    } catch (err) {
      setError(messageOf(err));
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [severityFilter, onlyKev, includeVex]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const loadVectorIndex = useCallback(async () => {
    try {
      setVectorIndex(await getSecurityVectorIndex());
    } catch (err) {
      setVectorIndex({ verdict: 'UNKNOWN', summary: messageOf(err), findings: [], unmeasured: [] });
    }
  }, []);

  useEffect(() => {
    loadVectorIndex();
  }, [loadVectorIndex]);

  const loadTriage = useCallback(async () => {
    try {
      setTriage(await getSecurityTriage());
    } catch (err) {
      setTriage(null);
      showToast(messageOf(err), 'error');
    }
  }, [showToast]);

  useEffect(() => {
    loadTriage();
  }, [loadTriage]);

  const searchInventory = useCallback(async () => {
    try {
      setInventory(await getSecurityInventory({ search: inventorySearch || undefined, limit: 50 }));
    } catch (err) {
      showToast(messageOf(err), 'error');
    }
  }, [inventorySearch, showToast]);

  /**
   * Achados exibidos com "Apenas pendências".
   *
   * O CRITÉRIO vive no módulo puro `shared/securityIntel/pendingFindings.js`
   * (testado fora do React) — não reimplemente aqui. Resumo: pendência é o que
   * exige decisão humana AGORA — achado sem correção publicada
   * (`NO_FIX_AVAILABLE`) ou com isenção aguardando aprovação. Severidade alta COM
   * correção disponível NÃO é pendência: é missão de correção.
   */
  const pendingFindings = useMemo(
    () => selectPendingFindings({ findings, waivers }),
    [findings, waivers],
  );
  const pendingSummary = useMemo(
    () => summarizePendingFindings({ loaded: findings.items, pending: pendingFindings }),
    [findings, pendingFindings],
  );
  const visibleFindings = onlyPending ? pendingFindings : (findings.items || []);

  /**
   * Índices que permitem decidir NA LINHA do grid, sem caçar a decisão em outra
   * tabela: isenção (pendente ou vigente) por achado e candidato de correção por
   * pacote. Um pacote pode ter vários achados — a mesma correção resolve todos.
   */
  const waiversByFinding = useMemo(() => indexWaiversByFinding(waivers), [waivers]);

  const patchesByPackage = useMemo(() => {
    const map = new Map();
    (patches.items || []).forEach((candidate) => {
      const name = candidate.package_name;
      if (!name) return;
      const atual = map.get(name);
      if (!atual) {
        map.set(name, candidate);
        return;
      }
      // Preferir o candidato ainda SEM missão: é o que continua acionável.
      if (atual.mission_id && !candidate.mission_id) map.set(name, candidate);
    });
    return map;
  }, [patches]);

  // Opções do seletor de achado para isenção: os achados de decisão vêm da FILA
  // (sempre completos) e o filtro só estreita os demais — nenhum corte silencioso.
  const waiverOptions = useMemo(
    () => buildWaiverOptions({ findings, triage, filter: waiverFilter }),
    [findings, triage, waiverFilter],
  );

  const showTimeline = useCallback(async (findingKey) => {
    try {
      const data = await getSecurityFindingTimeline(findingKey);
      setTimeline({ findingKey, items: data.items || [] });
    } catch (err) {
      showToast(messageOf(err), 'error');
    }
  }, [showToast]);

  const handleScan = useCallback(async () => {
    setBusy(true);
    try {
      const report = await runSecurityScan({ scope: 'installed' });
      showToast(
        `Correlação concluída: ${report.findings} achados em ${report.componentsScanned} componentes (${report.durationMs} ms).`,
        'success',
      );
      await loadAll();
      await loadVectorIndex();
    } catch (err) {
      showToast(messageOf(err), 'error');
    } finally {
      setBusy(false);
    }
  }, [loadAll, loadVectorIndex, showToast]);

  const handleGeneratePlans = useCallback(async () => {
    setBusy(true);
    try {
      const result = await generateSecurityPatchPlans({ onlyBlocking: false });
      showToast(`Plano de correção regerado: ${result.candidates} candidatos.`, 'success');
      await loadAll();
    } catch (err) {
      showToast(messageOf(err), 'error');
    } finally {
      setBusy(false);
    }
  }, [loadAll, showToast]);

  const handleCopyCommand = useCallback(async (command) => {
    try {
      await navigator.clipboard.writeText(command);
      showToast('Comando copiado. Ele NÃO aplica nada sozinho: submeter missão não altera produção.', 'success');
    } catch {
      showToast('Não foi possível copiar automaticamente — selecione o texto do comando.', 'error');
    }
  }, [showToast]);

  const handleCreateWaiver = useCallback(async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await createSecurityWaiver({
        findingKey: waiverForm.findingKey,
        reason: waiverForm.reason,
        expiresInDays: Number(waiverForm.expiresInDays),
        compensatingControl: waiverForm.compensatingControl || null,
      });
      showToast(
        result.created
          ? `Isenção SOLICITADA para ${result.findingKey} — aguarda aprovação de outro usuário (ainda NÃO vigente).`
          : 'Este achado já possuía uma solicitação com o mesmo prazo (nada foi duplicado).',
        result.created ? 'success' : 'info',
      );
      setWaiverForm({ findingKey: '', reason: '', expiresInDays: 30, compensatingControl: '' });
      await loadAll();
    } catch (err) {
      showToast(messageOf(err), 'error');
    } finally {
      setBusy(false);
    }
  }, [loadAll, showToast, waiverForm]);

  const handleApproveWaiver = useCallback(async (waiver) => {
    setBusy(true);
    try {
      const result = await approveSecurityWaiver({ waiverKey: waiver.waiver_key });
      showToast(
        result.approved
          ? `Isenção aprovada por ${result.approvedBy}: ${waiver.finding_key} passa a contar como risco aceito.`
          : `Isenção não foi aprovada (${result.reason || 'sem motivo informado'}).`,
        result.approved ? 'success' : 'info',
      );
      await loadAll();
    } catch (err) {
      showToast(messageOf(err), 'error');
    } finally {
      setBusy(false);
    }
  }, [loadAll, showToast]);

  const handleRevokeWaiver = useCallback(async (waiver) => {
    setBusy(true);
    try {
      const result = await revokeSecurityWaiver({ waiverKey: waiver.waiver_key, reason: 'Revogado pela tela de engenharia.' });
      showToast(
        result.revoked
          ? `Waiver revogado: ${waiver.finding_key} volta a contar como risco aberto.`
          : 'Waiver já estava revogado.',
        result.revoked ? 'success' : 'info',
      );
      await loadAll();
    } catch (err) {
      showToast(messageOf(err), 'error');
    } finally {
      setBusy(false);
    }
  }, [loadAll, showToast]);

  /**
   * Ação "Isentar" do grid: pré-seleciona o achado no formulário de isenção e
   * leva o operador até ele. A isenção nasce como SOLICITAÇÃO (`PENDING_APPROVAL`)
   * e não vigora enquanto outro usuário não aprovar — o texto diz isso na tela.
   */
  const handleRequestWaiverFor = useCallback((row) => {
    const key = row.finding_key || row.findingKey;
    setWaiverForm((prev) => ({ ...prev, findingKey: key }));
    showToast(
      `Achado selecionado para isenção: ${row.package_name}@${row.installed_version || '—'} · ${row.advisory_id}. `
      + 'Nasce como SOLICITAÇÃO — só vigora com aprovação de outro usuário.',
      'info',
    );
    requestAnimationFrame(() => {
      waiverFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      waiverReasonRef.current?.focus();
    });
  }, [showToast]);

  const handleCreateMission = useCallback(async (candidate) => {
    setBusy(true);
    try {
      const result = await createSecurityPatchMission({
        candidateKey: candidate.candidate_key,
      });
      showToast(
        result.created
          ? `Missão criada para ${candidate.package_name} (${result.missionId}).`
          : `Candidato já possui missão vinculada (${result.reason || 'já vinculada'}).`,
        result.created ? 'success' : 'info',
      );
      await loadAll();
    } catch (err) {
      showToast(messageOf(err), 'error');
    } finally {
      setBusy(false);
    }
  }, [loadAll, showToast]);

  const kpis = useMemo(() => {
    if (!summary) return [];
    const byStatus = summary.findings?.byStatus || {};
    const blocking = summary.blockingFindings ?? 0;
    const noFix = byStatus.NO_FIX_AVAILABLE || 0;
    const kev = summary.findings?.kevOpen ?? 0;
    const vectorTone = vectorIndex?.verdict === 'HEALTHY' ? 'text-emerald-500' : 'text-amber-500';
    return [
      { label: 'Componentes inventariados', value: summary.inventory?.total ?? 0 },
      { label: 'Achados abertos (risco)', value: summary.findings?.open ?? 0 },
      { label: 'Achados de severidade bloqueante', value: blocking, tone: blocking > 0 ? 'text-red-500' : 'text-emerald-500' },
      { label: 'Sem correção publicada', value: noFix, tone: noFix > 0 ? 'text-orange-500' : 'text-emerald-500' },
      { label: 'Candidatos de correção', value: summary.patchCandidates ?? 0 },
      { label: 'Achados em KEV (risco aberto)', value: kev, tone: kev > 0 ? 'text-orange-500' : 'text-emerald-500' },
      { label: 'Índice vetorial', value: VECTOR_VERDICT_LABELS[vectorIndex?.verdict] || 'não medido', tone: vectorTone },
      { label: 'Base de advisories', value: summary.advisoryBase?.stale ? `vencida (${formatHours(summary.advisoryBase?.ageHours)})` : formatHours(summary.advisoryBase?.ageHours), tone: summary.advisoryBase?.stale ? 'text-red-500' : 'text-emerald-500' },
      { label: 'Descartados por VEX (evidência)', value: summary.vexEvaluations ?? 0 },
    ];
  }, [summary, vectorIndex]);

  return (
    <div className={PAGE}>
      <ToastContainer />

      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">🛡️ Versões e Segurança</h1>
          <p className="text-sm text-text-secondary mt-1 max-w-3xl">
            Inventário real de componentes, correlação com advisories, plano de correção e integridade do
            índice vetorial. Superfície de engenharia (DEVELOPMENT).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className={BTN_SECONDARY}
            onClick={loadAll}
            disabled={loading || busy}
            data-testid="refresh-button"
          >
            Atualizar
          </button>
          <button type="button" className={BTN_PRIMARY} onClick={handleScan} disabled={busy} data-testid="scan-button">
            Reexecutar correlação
          </button>
          <button type="button" className={BTN_SECONDARY} onClick={handleGeneratePlans} disabled={busy}>
            Regerar plano de correção
          </button>
        </div>
      </div>

      {error && <Banner variant="danger">{error}</Banner>}

      {summary?.advisoryBase?.stale && (
        <Banner variant="danger">
          A base de advisories está vencida ({formatHours(summary.advisoryBase.ageHours)} desde a última
          sincronização; limite {summary.advisoryBase.staleAfterHours} h). Ausência de achados aqui NÃO é
          evidência de segurança.
        </Banner>
      )}

      {vectorIndex && vectorIndex.verdict !== 'HEALTHY' && (
        <Banner variant="warning">
          Índice vetorial: {VECTOR_VERDICT_LABELS[vectorIndex.verdict] || vectorIndex.verdict} — {vectorIndex.summary}
          {vectorIndex.unmeasured?.length > 0 && (
            <span> Eixos não medidos: {vectorIndex.unmeasured.join(', ')}.</span>
          )}
        </Banner>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} label={kpi.label} value={kpi.value} tone={kpi.tone} />
        ))}
      </div>

      <section className="mb-8">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
          <h2 className="text-lg font-bold text-text-primary">Achados de segurança</h2>
          <div className="flex items-center gap-3 flex-wrap">
            <select
              className={FIELD}
              value={severityFilter}
              onChange={(event) => setSeverityFilter(event.target.value)}
              aria-label="Filtrar por severidade"
            >
              <option value="">Todas as severidades</option>
              {SEVERITY_ORDER.map((severity) => (
                <option key={severity} value={severity}>{SEVERITY_LABELS[severity]}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input type="checkbox" checked={onlyKev} onChange={(event) => setOnlyKev(event.target.checked)} />
              Somente KEV (risco aberto)
            </label>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={onlyPending}
                onChange={(event) => setOnlyPending(event.target.checked)}
                data-testid="findings-only-pending"
              />
              Apenas pendências
            </label>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={includeVex}
                onChange={(event) => setIncludeVex(event.target.checked)}
                data-testid="findings-include-vex"
              />
              Incluir descartados por VEX (auditoria)
            </label>
          </div>
        </div>

        {/* Feedback do filtro: sem isto o operador liga "Apenas pendências", a
            lista continua longa e parece que nada aconteceu — reportado assim. */}
        {onlyPending && (
          <p className="mb-3 text-sm text-text-secondary" data-testid="findings-pending-summary">
            Exibindo <strong className="text-text-primary">{pendingSummary.pendingTotal}</strong> de{' '}
            {pendingSummary.loadedTotal} achados carregados:{' '}
            {pendingSummary.semCorrecao} sem correção publicada e{' '}
            {pendingSummary.aguardandoAprovacao} com isenção aguardando aprovação.
            {' '}Destes, <strong className="text-text-primary">{pendingSummary.bloqueantes}</strong> bloqueiam
            o release e {pendingSummary.devOnly} são de dependência de build/teste
            (o gate os trata como aviso, não bloqueio).
            {' '}Desmarque para ver todos.
          </p>
        )}

        <div className={TABLE_WRAP}>
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Severidade</th>
                <th className={TH}>Pacote</th>
                <th className={TH}>Serviço</th>
                <th className={TH}>Advisory</th>
                <th className={TH}>Status</th>
                <th className={TH}>Correção</th>
                <th className={TH}>CVSS / EPSS</th>
                <th className={TH}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {visibleFindings.map((row) => {
                const waiverEntry = waiversByFinding.get(row.finding_key || row.findingKey);
                const patchCandidate = patchesByPackage.get(row.package_name);
                return (
                <tr key={row.finding_key}>
                  <td className={TD}>
                    <Badge tone={SEVERITY_TONES[row.severity]}>{SEVERITY_LABELS[row.severity] || row.severity}</Badge>
                    {row.kev && <Badge tone="bg-red-500/15 text-red-500 border-red-500/30" className="ml-1">KEV</Badge>}
                  </td>
                  <td className={TD}>{row.package_name}@{row.installed_version || '—'}</td>
                  <td className={TD}>{row.service || '—'}</td>
                  <td className={TD}>{row.advisory_id}</td>
                  <td className={TD}>
                    {STATUS_LABELS[row.status] || row.status}
                    {row.applicability === 'UNKNOWN' && (
                      <span className="block text-xs text-text-secondary">aplicabilidade não confirmada</span>
                    )}
                    {row.dev_only === true && (
                      <span className="block text-xs text-text-secondary" data-testid={`finding-dev-only-${row.finding_key}`}>
                        dev-only (build/teste) — não bloqueia o release
                      </span>
                    )}
                  </td>
                  <td className={TD}>
                    {(row.fixed_versions || []).length > 0
                      ? (row.fixed_versions || []).join(', ')
                      : <span className="text-xs text-text-secondary">sem versão corrigida publicada</span>}
                  </td>
                  <td className={TD}>{row.cvss_score ?? '—'} / {row.epss ?? '—'}</td>
                  <td className={TD}>
                    {/*
                      Decisão NA LINHA (defeito relatado: as ações não estavam no
                      grid inicial e não havia como saber o que fazer com cada
                      achado). Só aparece ação que aquele achado realmente admite:
                      isenção (solicitar / aprovar / revogar) e correção.
                    */}
                    <div className="flex flex-col items-start gap-1" data-testid={`finding-actions-${row.finding_key}`}>
                      <button type="button" className={BTN_SMALL} onClick={() => showTimeline(row.finding_key)}>
                        Histórico
                      </button>

                      {waiverEntry?.pending && (
                        <>
                          <span className="text-xs text-amber-500">isenção aguardando aprovação</span>
                          <button
                            type="button"
                            className={BTN_PRIMARY}
                            onClick={() => handleApproveWaiver(waiverEntry.pending)}
                            disabled={busy}
                            data-testid={`finding-approve-${row.finding_key}`}
                          >
                            Aprovar isenção
                          </button>
                        </>
                      )}

                      {!waiverEntry?.pending && waiverEntry?.active && (
                        <>
                          <span className="text-xs text-text-secondary">
                            isenção vigente até {formatDate(waiverEntry.active.expires_at)}
                          </span>
                          <button
                            type="button"
                            className={BTN_SMALL}
                            onClick={() => handleRevokeWaiver(waiverEntry.active)}
                            disabled={busy}
                            data-testid={`finding-revoke-${row.finding_key}`}
                          >
                            Revogar isenção
                          </button>
                        </>
                      )}

                      {!waiverEntry?.pending && !waiverEntry?.active && (
                        <button
                          type="button"
                          className={BTN_SMALL}
                          onClick={() => handleRequestWaiverFor(row)}
                          disabled={busy}
                          title="Solicita isenção com prazo para este achado. Nasce PENDENTE e exige aprovação de outro usuário."
                          data-testid={`finding-waive-${row.finding_key}`}
                        >
                          Isentar (solicitar)
                        </button>
                      )}

                      {patchCandidate && (
                        patchCandidate.mission_id ? (
                          <span className="text-xs text-text-secondary">
                            correção já enviada ao roteador
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={BTN_SMALL}
                            onClick={() => handleCreateMission(patchCandidate)}
                            disabled={busy}
                            title={`Cria missão de correção ${patchCandidate.current_version || '—'} → ${patchCandidate.target_version || '—'} (${patchCandidate.kind}). Não aplica nada sozinho.`}
                            data-testid={`finding-patch-${row.finding_key}`}
                          >
                            Criar missão de correção
                          </button>
                        )
                      )}

                      {!patchCandidate && semCorrecaoPublicada(row) && (
                        <span className="text-xs text-text-secondary">
                          sem versão corrigida publicada — a saída é isenção com prazo ou controle compensatório
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
              {visibleFindings.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-4 text-center text-sm text-text-secondary">
                    Nenhum achado para os filtros atuais. Isto não significa ausência de vulnerabilidade — consulte
                    a idade da base de advisories e a cobertura do inventário.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-text-secondary mt-2" data-testid="findings-totals">
          {includeVex
            ? `${findings.total ?? 0} achados registrados, incluindo ${summary?.vexEvaluations ?? 0} descartados por VEX (não são risco)`
            : `${findings.total ?? 0} achados em risco aberto`}
          {(summary?.vexEvaluations ?? 0) > 0 && !includeVex
            ? ` · ${summary.vexEvaluations} descartados por VEX (não afetado / falso positivo) ficam FORA desta contagem — marque "Incluir descartados por VEX" para auditá-los`
            : ''}
          {onlyKev ? ' · filtro "somente KEV" na mesma definição do KPI acima' : ''}
        </p>

        {timeline && (
          <div className={`${CARD} mt-4`}>
            <h3 className="text-sm font-bold text-text-primary mb-2">Histórico · {timeline.findingKey}</h3>
            <ul className="space-y-1 text-sm text-text-secondary">
              {timeline.items.map((event) => (
                <li key={event.id}>
                  <strong className="text-text-primary">{formatDate(event.at ?? event.createdAt ?? event.created_at)}</strong> — {STATUS_LABELS[event.to_status] || event.to_status}
                  {event.actor ? ` · ${event.actor}` : ''}
                </li>
              ))}
              {timeline.items.length === 0 && <li>Sem eventos registrados.</li>}
            </ul>
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-text-primary mb-4">Plano de correção</h2>
        <div className={TABLE_WRAP}>
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Severidade</th>
                <th className={TH}>Pacote</th>
                <th className={TH}>Atual → alvo</th>
                <th className={TH}>Tipo</th>
                <th className={TH}>Risco da atualização</th>
                <th className={TH}>Autonomia</th>
                <th className={TH}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {(patches.items || []).map((row) => (
                <tr key={row.candidate_key}>
                  <td className={TD}>
                    <Badge tone={SEVERITY_TONES[row.severity]}>{SEVERITY_LABELS[row.severity] || row.severity}</Badge>
                    {row.dev_only && <Badge className="ml-1">dev</Badge>}
                  </td>
                  <td className={TD}>{row.package_name}</td>
                  <td className={TD}>{row.current_version || '—'} → {row.target_version || '—'}</td>
                  <td className={TD}>{KIND_LABELS[row.kind] || row.kind}</td>
                  <td className={TD}>{row.update_risk}</td>
                  <td className={TD}>{AUTONOMY_LABELS[row.autonomy] || row.autonomy}</td>
                  <td className={TD}>
                    {row.mission_id ? (
                      <span className="text-xs text-text-secondary">missão vinculada</span>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        {row.requires_human_approval && (
                          <span className="text-xs text-text-secondary" data-testid="patch-mission-authorization-note">
                            Nível C: a autorização é registrada em nome do usuário autenticado.
                          </span>
                        )}
                        <button type="button" className={BTN_SMALL} onClick={() => handleCreateMission(row)} disabled={busy}>
                          Criar missão
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {(patches.items || []).length === 0 && (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-sm text-text-secondary">
                    Nenhum candidato de correção. Rode "Regerar plano de correção" após uma correlação.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-text-secondary mt-2">
          Criar missão NÃO aplica a correção: submete o trabalho ao Roteador Engenheiro. Nada é executado sem
          aprovação humana para candidatos de Nível C.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-text-primary mb-4">Inventário de componentes</h2>
        <div className="flex items-center gap-3 flex-wrap mb-4">
          <input
            type="text"
            className={FIELD}
            value={inventorySearch}
            placeholder="Nome do pacote"
            onChange={(event) => setInventorySearch(event.target.value)}
            aria-label="Buscar componente"
          />
          <button type="button" className={BTN_SECONDARY} onClick={searchInventory}>Buscar</button>
          <span className="text-xs text-text-secondary">
            {inventory.total ?? 0} componentes correspondentes
            {(inventory.items || []).length > INVENTORY_ROWS
              ? ` · exibindo os ${INVENTORY_ROWS} primeiros`
              : ''}
          </span>
        </div>
        <div className={TABLE_WRAP}>
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Nome</th>
                <th className={TH}>Versão</th>
                <th className={TH}>Classe</th>
                <th className={TH}>Ecossistema</th>
                <th className={TH}>Serviço</th>
              </tr>
            </thead>
            <tbody>
              {(inventory.items || []).slice(0, INVENTORY_ROWS).map((row) => (
                <tr key={row.id || row.bom_ref}>
                  <td className={TD}>{row.name}</td>
                  <td className={TD}>{row.version || '—'}</td>
                  <td className={TD}>{row.version_class}</td>
                  <td className={TD}>{row.ecosystem}</td>
                  <td className={TD}>{row.service || '—'}</td>
                </tr>
              ))}
              {(inventory.items || []).length === 0 && (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-sm text-text-secondary">
                    Faça uma busca para listar componentes.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-bold text-text-primary mb-4">Base de advisories</h2>
        <p className="text-xs text-text-secondary mb-4">
          {advisories
            ? `${advisories.advisoriesTotal} advisories persistidos · ${advisories.kevTotal} em KEV (CISA).`
            : 'Não medido.'}
        </p>
        <div className={TABLE_WRAP}>
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Status</th>
                <th className={TH}>Quando</th>
                <th className={TH}>Idade</th>
                <th className={TH}>Pacotes consultados</th>
                <th className={TH}>Advisories gravados</th>
                <th className={TH}>Falhas</th>
              </tr>
            </thead>
            <tbody>
              {(advisories?.syncs || []).map((row) => (
                <tr key={row.id}>
                  <td className={TD}>{row.status}</td>
                  <td className={TD}>{formatDate(row.startedAt)}</td>
                  <td className={TD}>{formatHours(row.ageHours)}</td>
                  <td className={TD}>{row.packagesQueried}</td>
                  <td className={TD}>{row.advisoriesUpserted}</td>
                  <td className={TD}>{(row.failures || []).length > 0 ? (row.failures || []).length : '—'}</td>
                </tr>
              ))}
              {(advisories?.syncs || []).length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-sm text-text-secondary">
                    Nenhuma sincronização registrada: a base de advisories pode estar vazia, e a correlação atual
                    não prova ausência de vulnerabilidade.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
          <h2 className="text-lg font-bold text-text-primary">Fila de triagem (ordenada por efeito no gate)</h2>
          <button type="button" className={BTN_SECONDARY} onClick={loadTriage} disabled={busy}>
            Recalcular fila
          </button>
        </div>
        {triage ? (
          <>
            <p className="text-xs text-text-secondary mb-3">
              {triage.blockingImpact.gateBlockingPackagesInQueue.length} de {triage.blockingImpact.gateBlockingPackages} pacotes
              que bloqueiam o release estão na fila
              {triage.blockingImpact.gateBlockingPackagesOutOfQueue.length > 0
                ? ` — fora: ${triage.blockingImpact.gateBlockingPackagesOutOfQueue.join(', ')}`
                : ' (nenhum bloqueador ficou fora)'}
              {' · '}{triage.totals.groups} pacotes, {triage.totals.autoIsolated} isolados,
              {' '}{triage.totals.requiringHumanApproval} exigem aprovação,
              {' '}{triage.totals.withoutPublishedFix} sem correção publicada.
              Nada aqui é aplicado pela tela.
            </p>
            {triage.groups.length > TRIAGE_ROWS && (
              <p className="text-xs text-amber-500 mb-3" data-testid="triage-truncation-notice">
                Exibindo os {TRIAGE_ROWS} primeiros de {triage.groups.length} grupos — a fila completa
                (e o comando de cada grupo) sai por `node scripts/security-intel.js triage`.
              </p>
            )}
            <div className={TABLE_WRAP}>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={TH}>Bucket</th>
                    <th className={TH}>Pacote</th>
                    <th className={TH}>Atual → alvo</th>
                    <th className={TH}>Impacto (bloqueantes)</th>
                    <th className={TH}>Motivo</th>
                    <th className={TH}>Comando</th>
                  </tr>
                </thead>
                <tbody>
                  {triage.groups.slice(0, TRIAGE_ROWS).map((group) => (
                    <tr key={group.key}>
                      <td className={TD}>
                        <Badge tone={TRIAGE_BUCKET_TONES[group.bucket]}>
                          {TRIAGE_BUCKET_LABELS[group.bucket] || group.bucket}
                        </Badge>
                        {group.kev && <Badge tone="bg-red-500/15 text-red-500 border-red-500/30" className="ml-1">KEV</Badge>}
                        {group.devOnly && <Badge className="ml-1">dev</Badge>}
                      </td>
                      <td className={TD}>{group.packageName}{group.service ? ` · ${group.service}` : ''}</td>
                      <td className={TD}>{group.currentVersion || '—'} → {group.recommendedVersion || 'sem alvo'}</td>
                      <td className={TD}>
                        {group.blockingFindingsOpen}
                        {group.blockingFindingsDevOnly > 0 && (
                          <span className="text-xs text-text-secondary"> (+{group.blockingFindingsDevOnly} dev-only)</span>
                        )}
                      </td>
                      <td className={`${TD} max-w-md`}>{group.rationale}</td>
                      <td className={TD}>
                        <div className="flex flex-col gap-1">
                          <code className="text-xs text-text-secondary break-all">{group.command}</code>
                          <button type="button" className={BTN_SMALL} onClick={() => handleCopyCommand(group.command)}>
                            Copiar comando
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-text-secondary mt-2">
              {triage.blockingImpact.unitWarning}
            </p>
          </>
        ) : (
          <p className="text-sm text-text-secondary">Fila não calculada nesta sessão.</p>
        )}
      </section>

      <section className="mb-8" ref={waiverFormRef}>
        <h2 className="text-lg font-bold text-text-primary mb-4">Waivers de risco (isenção formal com prazo)</h2>
        <p className="text-xs text-text-secondary mb-4">
          Nada é isentado por padrão. A isenção vale <strong className="text-text-primary">com prazo</strong>
          {' '}e exige <strong className="text-text-primary">duas decisões</strong>: alguém solicita e outro
          usuário aprova — quem solicita não pode aprovar. Enquanto estiver PENDING_APPROVAL nada está
          isentado. O achado volta a contar como risco aberto quando a isenção expira ou é revogada; o gate
          revalida a expiração e o ESCOPO a cada leitura.
          {' '}{waivers.maxWaiverDays ? `Prazo máximo permitido: ${waivers.maxWaiverDays} dias.` : ''}
        </p>

        <div className={`${CARD} mb-4`}>
          <h3 className="text-sm font-bold text-text-primary mb-3">Solicitar isenção (não vigora até a aprovação)</h3>
          <form onSubmit={handleCreateWaiver} className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-xs text-text-secondary">Achado</span>
              <select
                className={FIELD}
                value={waiverForm.findingKey}
                onChange={(event) => setWaiverForm((prev) => ({ ...prev, findingKey: event.target.value }))}
                required
                data-testid="waiver-finding-select"
              >
                <option value="">Selecione um achado aberto…</option>
                {waiverOptions.decision.length > 0 && (
                  <optgroup label={`Exigem decisão (fila de triagem) — ${waiverOptions.decisionTotal}`}>
                    {waiverOptions.decision.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.withoutFix ? 'sem correção publicada · ' : ''}{option.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label={`Demais achados abertos — ${waiverOptions.others.length}${waiverFilter ? ' (filtrados)' : ''}`}>
                  {waiverOptions.others.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-xs text-text-secondary">
                Filtrar demais achados (pacote, versão ou advisory)
              </span>
              <input
                type="text"
                className={FIELD}
                value={waiverFilter}
                onChange={(event) => setWaiverFilter(event.target.value)}
                placeholder="Ex.: nodemailer, 8.0.7, GHSA-p6gq"
                data-testid="waiver-findings-filter"
              />
            </label>
            <p className="md:col-span-2 text-xs text-text-secondary" data-testid="waiver-options-summary">
              {waiverOptions.decisionTotal} achados exigem decisão (sempre listados, independentemente do filtro)
              {' · '}{waiverOptions.others.length} demais selecionáveis
              {' · '}{waiverOptions.loaded} de {waiverOptions.totalOpen} achados abertos carregados
              {waiverOptions.capped
                ? ' — a lista da API é limitada: os achados de decisão continuam acessíveis acima; para os demais, use o filtro ou o comando da fila.'
                : ''}
            </p>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-xs text-text-secondary">Motivo da aceitação (mínimo 20 caracteres)</span>
              <textarea
                ref={waiverReasonRef}
                className={FIELD}
                rows={2}
                value={waiverForm.reason}
                onChange={(event) => setWaiverForm((prev) => ({ ...prev, reason: event.target.value }))}
                placeholder="Ex.: sem versão corrigida publicada; risco aceito até o upgrade do runtime, com WAF no vetor de exploração."
                required
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-secondary">Solicitado por</span>
              <p className="text-xs text-text-primary" data-testid="waiver-approver-note">
                Registrado em nome do usuário autenticado (identidade derivada da sessão). A aprovação exige
                outro usuário com permissão própria — solicitar não concede isenção.
              </p>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-text-secondary">Prazo em dias</span>
              <input
                type="number"
                min={1}
                max={waivers.maxWaiverDays || 90}
                className={FIELD}
                value={waiverForm.expiresInDays}
                onChange={(event) => setWaiverForm((prev) => ({ ...prev, expiresInDays: event.target.value }))}
                required
              />
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-xs text-text-secondary">Controle compensatório (opcional)</span>
              <input
                type="text"
                className={FIELD}
                value={waiverForm.compensatingControl}
                onChange={(event) => setWaiverForm((prev) => ({ ...prev, compensatingControl: event.target.value }))}
                placeholder="o que reduz o risco enquanto a correção não sai"
              />
            </label>
            <div className="md:col-span-2">
              <button type="submit" className={BTN_PRIMARY} disabled={busy} data-testid="waiver-submit-button">
                Solicitar isenção com prazo
              </button>
            </div>
          </form>
        </div>

        <div className={TABLE_WRAP}>
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>Achado</th>
                <th className={TH}>Expira em</th>
                <th className={TH}>Aprovado por</th>
                <th className={TH}>Motivo</th>
                <th className={TH}>Estado</th>
                <th className={TH}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {(waivers.items || []).map((row) => (
                <tr key={row.waiver_key}>
                  <td className={TD}>{row.finding_key}</td>
                  <td className={TD}>{formatDate(row.expires_at)}</td>
                  <td className={TD}>{row.approved_by}</td>
                  <td className={TD}>{row.reason}</td>
                  <td className={TD}>{row.state}</td>
                  <td className={TD}>
                    <div className="flex items-center gap-2 flex-wrap">
                      {String(row.state || '').toUpperCase() === 'PENDING_APPROVAL' && (
                        <button
                          type="button"
                          className={BTN_PRIMARY}
                          onClick={() => handleApproveWaiver(row)}
                          disabled={busy}
                          data-testid={`waiver-approve-${row.waiver_key}`}
                        >
                          Aprovar
                        </button>
                      )}
                      <button type="button" className={BTN_SMALL} onClick={() => handleRevokeWaiver(row)} disabled={busy}>
                        Revogar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {(waivers.items || []).length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-sm text-text-secondary">
                    Nenhum risco isentado. O gate avalia todos os achados abertos — é o estado desejado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-text-secondary">
        Limites declarados: o inventário cobre os manifestos e imagens do repositório, o runtime do host e os
        serviços sondáveis. Componentes fora dessas fontes não são cobertos — cobertura parcial é reportada como
        tal, nunca convertida em "sem risco".
      </p>
    </div>
  );
}

// O `lazyPage` do main.jsx resolve a página pelo EXPORT NOMEADO (segundo
// argumento). Exportar só default deixava o React com tipo inválido
// ("Lazy element type must resolve to a class or function") — defeito real
// observado no browser em 2026-10-08.
export default SecurityIntelligencePage;
