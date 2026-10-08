import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../components/Toast';
import {
  createSecurityPatchMission,
  generateSecurityPatchPlans,
  getSecurityFindingTimeline,
  getSecurityIntelSummary,
  getSecurityInventory,
  getSecurityVectorIndex,
  listSecurityAdvisories,
  listSecurityFindings,
  listSecurityPatches,
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

const ERROR_MESSAGES = {
  unauthorized: 'Sessão expirada. Autentique-se novamente.',
  classification_required: 'Sua classificação não permite acessar a superfície de engenharia (DEVELOPMENT).',
  tenant_required: 'Selecione um tenant antes de consultar a inteligência de segurança.',
  tenant_invalid: 'Tenant inválido para esta consulta.',
  persistence_required: 'O banco de dados não está disponível: a leitura seria degradada, então foi recusada.',
  patch_candidate_requires_authorization: 'Candidato de Nível C (produção) exige autorização explícita.',
  patch_candidate_not_found: 'Candidato de patch não encontrado.',
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
  const [timeline, setTimeline] = useState(null);
  const [authorizedBy, setAuthorizedBy] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryData, findingsData, patchesData, advisoryData] = await Promise.all([
        getSecurityIntelSummary(),
        listSecurityFindings({ severity: severityFilter || undefined, kev: onlyKev ? 'true' : undefined }),
        listSecurityPatches({ limit: 100 }),
        listSecurityAdvisories(),
      ]);
      setSummary(summaryData);
      setFindings(findingsData || { items: [], total: 0 });
      setPatches(patchesData || { items: [], total: 0 });
      setAdvisories(advisoryData);
    } catch (err) {
      setError(messageOf(err));
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [severityFilter, onlyKev]);

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

  const searchInventory = useCallback(async () => {
    try {
      setInventory(await getSecurityInventory({ search: inventorySearch || undefined, limit: 50 }));
    } catch (err) {
      showToast(messageOf(err), 'error');
    }
  }, [inventorySearch, showToast]);

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

  const handleCreateMission = useCallback(async (candidate) => {
    setBusy(true);
    try {
      const result = await createSecurityPatchMission({
        candidateKey: candidate.candidate_key,
        authorizedBy: authorizedBy[candidate.candidate_key] || null,
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
  }, [authorizedBy, loadAll, showToast]);

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
      { label: 'Achados em KEV (explorado)', value: kev, tone: kev > 0 ? 'text-orange-500' : 'text-emerald-500' },
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
              Somente KEV
            </label>
          </div>
        </div>

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
              {(findings.items || []).map((row) => (
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
                  </td>
                  <td className={TD}>
                    {(row.fixed_versions || []).length > 0
                      ? (row.fixed_versions || []).join(', ')
                      : <span className="text-xs text-text-secondary">sem versão corrigida publicada</span>}
                  </td>
                  <td className={TD}>{row.cvss_score ?? '—'} / {row.epss ?? '—'}</td>
                  <td className={TD}>
                    <button type="button" className={BTN_SMALL} onClick={() => showTimeline(row.finding_key)}>
                      Histórico
                    </button>
                  </td>
                </tr>
              ))}
              {(findings.items || []).length === 0 && (
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
        <p className="text-xs text-text-secondary mt-2">Total: {findings.total ?? 0} achados abertos registrados.</p>

        {timeline && (
          <div className={`${CARD} mt-4`}>
            <h3 className="text-sm font-bold text-text-primary mb-2">Histórico · {timeline.findingKey}</h3>
            <ul className="space-y-1 text-sm text-text-secondary">
              {timeline.items.map((event) => (
                <li key={event.id}>
                  <strong className="text-text-primary">{formatDate(event.created_at)}</strong> — {STATUS_LABELS[event.to_status] || event.to_status}
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
                          <input
                            type="text"
                            className={FIELD}
                            placeholder="autorizado por"
                            value={authorizedBy[row.candidate_key] || ''}
                            onChange={(event) => setAuthorizedBy((prev) => ({
                              ...prev,
                              [row.candidate_key]: event.target.value,
                            }))}
                            aria-label={`Autorizador para ${row.package_name}`}
                          />
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
          <span className="text-xs text-text-secondary">{inventory.total ?? 0} componentes correspondentes</span>
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
              {(inventory.items || []).slice(0, 25).map((row) => (
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
