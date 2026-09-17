import React, { useCallback, useEffect, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import {
  applyProposal,
  approveProposal,
  createProposal,
  getProposal,
  listProposals,
  rejectProposal,
  startReview,
} from '../api/benchmarkResearch';
import './BenchmarkResearchGovernancePage.css';

const STATUS_LABELS = {
  proposed: 'Proposta',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
  applied: 'Aplicada',
};

const STATUS_TONES = {
  proposed: 'info',
  approved: 'success',
  rejected: 'danger',
  applied: 'accent',
};

const VERDICT_LABELS = {
  recommended: 'Recomendada',
  caution: 'Recomendada com cautela',
  not_recommended: 'Não recomendada',
};

const VERDICT_TONES = {
  recommended: 'success',
  caution: 'warning',
  not_recommended: 'danger',
};

const CHANGE_TYPE_LABELS = {
  add: 'Adicionar',
  remove: 'Remover',
  update: 'Atualizar',
};

const CHANGE_TYPE_TONES = {
  add: 'success',
  remove: 'danger',
  update: 'warning',
};

const ERROR_MESSAGES = {
  proposal_not_found: 'Proposta não encontrada.',
  proposal_invalid_status: 'A proposta não está em um estado que permite esta ação.',
  patch_tampered: 'O conteúdo da proposta foi alterado após a avaliação. Gere uma nova proposta.',
  self_approval_denied: 'O aprovador deve ser diferente do autor da proposta.',
  review_token_required: 'Inicie a revisão antes de aprovar a proposta.',
  review_token_invalid: 'Token de revisão inválido. Inicie a revisão novamente.',
  review_token_expired: 'A revisão expirou. Inicie a revisão novamente.',
  review_reviewer_mismatch: 'A revisão foi iniciada por outro usuário. Inicie uma nova revisão.',
  approval_required: 'A proposta precisa estar aprovada antes de ser aplicada.',
};

const DEFAULT_VERTICAL = 'fitness';

function resolveErrorMessage(err, fallback) {
  const code = typeof err?.body?.error === 'string' ? err.body.error : err?.code;
  if (typeof code === 'string' && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  return err?.message || fallback;
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('pt-BR');
}

function shortId(value) {
  const raw = String(value || '');
  return raw.length > 12 ? `${raw.slice(0, 12)}…` : raw || '—';
}

function formatReadableLabel(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function formatMetricValue(value) {
  if (value == null) return '—';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return `${value.length} itens`;
  return `${Object.keys(value).length} campos`;
}

function Badge({ tone = 'neutral', children }) {
  return <span className={`brg-badge brg-tone-${tone}`}>{children}</span>;
}

function StatusBadge({ status }) {
  return <Badge tone={STATUS_TONES[status] || 'neutral'}>{STATUS_LABELS[status] || status || '—'}</Badge>;
}

function VerdictBadge({ verdict }) {
  if (!verdict) return null;
  return <Badge tone={VERDICT_TONES[verdict] || 'neutral'}>{VERDICT_LABELS[verdict] || verdict}</Badge>;
}

function MetricCard({ label, value }) {
  return (
    <div className="brg-metric">
      <span className="brg-metric__label">{label}</span>
      <strong className="brg-metric__value">{value}</strong>
    </div>
  );
}

function ObjectMetrics({ data }) {
  const entries = Object.entries(data || {});
  if (entries.length === 0) return <p className="brg-muted">Sem dados.</p>;
  return (
    <div className="brg-metric-grid">
      {entries.map(([key, value]) => (
        <MetricCard key={key} label={formatReadableLabel(key)} value={formatMetricValue(value)} />
      ))}
    </div>
  );
}

function TextList({ items, emptyLabel = 'Nenhum item.' }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (list.length === 0) return <p className="brg-muted">{emptyLabel}</p>;
  return (
    <ul className="brg-list">
      {list.map((item, index) => (
        <li key={`${index}-${String(item).slice(0, 24)}`}>{item}</li>
      ))}
    </ul>
  );
}

function EvaluationDetail({ evaluation }) {
  if (!evaluation || typeof evaluation !== 'object') {
    return <p className="brg-muted">Avaliação não disponível para esta proposta.</p>;
  }

  const context = evaluation.context || {};
  const sufficiency = evaluation.sufficiency || {};
  const recommendation = evaluation.recommendation || {};
  const whatChanges = Array.isArray(evaluation.whatChanges) ? evaluation.whatChanges : [];
  const gatesFlipping = Array.isArray(sufficiency.gatesFlipping) ? sufficiency.gatesFlipping : [];

  return (
    <div className="brg-evaluation">
      <section className="brg-section">
        <h3>Contexto da pesquisa</h3>
        <div className="brg-metric-grid">
          <MetricCard label="Vertical" value={context.vertical || '—'} />
          <MetricCard label="Benchmarks na amostra" value={formatMetricValue(context.benchmarksInSample)} />
          <MetricCard label="Fontes pesquisadas" value={formatMetricValue(context.sourcesResearched)} />
          <MetricCard label="Evidências" value={formatMetricValue(context.evidenceCount)} />
          <MetricCard label="Gerado em" value={formatDateTime(context.generatedAt)} />
        </div>
        <div className="brg-context-groups">
          <div>
            <h4>Achados por tipo</h4>
            <ObjectMetrics data={context.findingsByKind} />
          </div>
          <div>
            <h4>Novidade por classificação</h4>
            <ObjectMetrics data={context.noveltyByClassification} />
          </div>
        </div>
      </section>

      <section className="brg-section">
        <h3>O que muda na amostra</h3>
        {whatChanges.length === 0 ? (
          <p className="brg-muted">Nenhuma mudança proposta.</p>
        ) : (
          <ul className="brg-changes">
            {whatChanges.map((change, index) => (
              <li key={`${change.type}-${change.benchmarkId}-${index}`} className="brg-change">
                <Badge tone={CHANGE_TYPE_TONES[change.type] || 'neutral'}>
                  {CHANGE_TYPE_LABELS[change.type] || change.type}
                </Badge>
                <div className="brg-change__body">
                  <strong>{change.benchmarkId}</strong>
                  <span>{change.reason}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="brg-section">
        <h3>Suficiência da amostra</h3>
        <div className="brg-sufficiency">
          <div className="brg-sufficiency__col">
            <h4>Antes</h4>
            <ObjectMetrics data={sufficiency.before} />
          </div>
          <div className="brg-sufficiency__col">
            <h4>Depois</h4>
            <ObjectMetrics data={sufficiency.after} />
          </div>
        </div>
        {gatesFlipping.length > 0 ? (
          <div className="brg-gates">
            <h4>Gates que mudam de estado</h4>
            <div className="brg-gates__chips">
              {gatesFlipping.map((gate) => (
                <Badge key={gate} tone="warning">{gate}</Badge>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="brg-section">
        <div className="brg-columns">
          <div className="brg-column brg-column--pros">
            <h3>Prós</h3>
            <TextList items={evaluation.pros} emptyLabel="Nenhum pró registrado." />
          </div>
          <div className="brg-column brg-column--cons">
            <h3>Contras</h3>
            <TextList items={evaluation.cons} emptyLabel="Nenhum contra registrado." />
          </div>
          <div className="brg-column brg-column--risks">
            <h3>Riscos</h3>
            <TextList items={evaluation.risks} emptyLabel="Nenhum risco registrado." />
          </div>
        </div>
      </section>

      <section className="brg-section">
        <h3>Avaliação prática</h3>
        <p className="brg-prose">{evaluation.practicalAssessment || 'Não registrada.'}</p>
      </section>

      <section className={`brg-section brg-recommendation brg-tone-${VERDICT_TONES[recommendation.verdict] || 'neutral'}`}>
        <div className="brg-recommendation__header">
          <h3>Recomendação da pesquisa (advisory)</h3>
          <VerdictBadge verdict={recommendation.verdict} />
        </div>
        <TextList items={recommendation.reasons} emptyLabel="Sem justificativas registradas." />
      </section>

      <section className="brg-section">
        <h3>Fora de escopo</h3>
        <TextList items={evaluation.nonGoals} emptyLabel="Nenhum não-objetivo registrado." />
      </section>
    </div>
  );
}

function AuditTrail({ proposal }) {
  const caveats = Array.isArray(proposal.caveats) ? proposal.caveats : [];
  return (
    <section className="brg-section">
      <h3>Trilha de decisão</h3>
      <dl className="brg-trail">
        <div>
          <dt>Proposta por</dt>
          <dd>{proposal.proposedBy || '—'} · {formatDateTime(proposal.proposedAt)}</dd>
        </div>
        {proposal.reviewedBy || proposal.reviewedAt ? (
          <div>
            <dt>Revisada por</dt>
            <dd>{proposal.reviewedBy || '—'} · {formatDateTime(proposal.reviewedAt)}</dd>
          </div>
        ) : null}
        {proposal.appliedBy || proposal.appliedAt ? (
          <div>
            <dt>Aplicada por</dt>
            <dd>{proposal.appliedBy || '—'} · {formatDateTime(proposal.appliedAt)}</dd>
          </div>
        ) : null}
        {proposal.decisionReason ? (
          <div>
            <dt>Motivo da decisão</dt>
            <dd>{proposal.decisionReason}</dd>
          </div>
        ) : null}
      </dl>
      {caveats.length > 0 ? (
        <div className="brg-caveats">
          <h4>Ressalvas registradas</h4>
          <TextList items={caveats} />
        </div>
      ) : null}
    </section>
  );
}

export function BenchmarkResearchGovernancePage() {
  const { showToast, ToastContainer } = useToast();

  const [proposals, setProposals] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [verticalFilter, setVerticalFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [reviewSession, setReviewSession] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newVertical, setNewVertical] = useState(DEFAULT_VERTICAL);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveCaveats, setApproveCaveats] = useState('');
  const [approveReason, setApproveReason] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [applyOpen, setApplyOpen] = useState(false);

  const loadProposals = useCallback(async () => {
    setListLoading(true);
    try {
      const data = await listProposals({
        vertical: verticalFilter || undefined,
        status: statusFilter || undefined,
      });
      setProposals(Array.isArray(data?.proposals) ? data.proposals : []);
    } catch (err) {
      showToast(resolveErrorMessage(err, 'Falha ao carregar propostas.'), 'error');
    } finally {
      setListLoading(false);
    }
  }, [verticalFilter, statusFilter, showToast]);

  useEffect(() => {
    loadProposals();
  }, [loadProposals]);

  const selectProposal = useCallback(async (id) => {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const data = await getProposal(id);
      setDetail(data?.proposal || null);
    } catch (err) {
      showToast(resolveErrorMessage(err, 'Falha ao carregar a proposta.'), 'error');
    } finally {
      setDetailLoading(false);
    }
  }, [showToast]);

  const refreshAfterAction = useCallback(async (proposal) => {
    if (proposal) setDetail(proposal);
    await loadProposals();
  }, [loadProposals]);

  const handleCreate = async () => {
    const vertical = newVertical.trim() || DEFAULT_VERTICAL;
    setActionBusy(true);
    try {
      const data = await createProposal(vertical);
      const proposal = data?.proposal;
      showToast('Proposta criada. Revise a avaliação documentada antes de decidir.', 'success');
      setCreateOpen(false);
      setNewVertical(DEFAULT_VERTICAL);
      await loadProposals();
      if (proposal?.id) {
        setSelectedId(proposal.id);
        setDetail(proposal);
        setReviewSession(null);
      }
    } catch (err) {
      showToast(resolveErrorMessage(err, 'Falha ao criar a proposta.'), 'error');
    } finally {
      setActionBusy(false);
    }
  };

  const handleStartReview = async () => {
    if (!detail) return;
    setActionBusy(true);
    try {
      const data = await startReview(detail.id);
      setReviewSession({ proposalId: detail.id, token: data?.reviewToken, expiresAt: data?.expiresAt });
      showToast('Revisão iniciada. Avalie a proposta e registre sua decisão.', 'success');
    } catch (err) {
      showToast(resolveErrorMessage(err, 'Falha ao iniciar a revisão.'), 'error');
    } finally {
      setActionBusy(false);
    }
  };

  const handleApprove = async () => {
    if (!detail || !reviewSession?.token) {
      showToast('Inicie a revisão antes de aprovar a proposta.', 'warning');
      return;
    }
    const caveats = approveCaveats
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const reason = approveReason.trim();

    setActionBusy(true);
    try {
      const data = await approveProposal(detail.id, {
        reviewToken: reviewSession.token,
        caveats,
        reason: reason || undefined,
      });
      showToast('Proposta aprovada com ressalvas registradas.', 'success');
      setApproveOpen(false);
      setApproveCaveats('');
      setApproveReason('');
      setReviewSession(null);
      await refreshAfterAction(data?.proposal);
    } catch (err) {
      showToast(resolveErrorMessage(err, 'Falha ao aprovar a proposta.'), 'error');
    } finally {
      setActionBusy(false);
    }
  };

  const handleReject = async () => {
    if (!detail) return;
    const reason = rejectReason.trim();
    if (!reason) {
      showToast('Informe o motivo da rejeição.', 'warning');
      return;
    }
    setActionBusy(true);
    try {
      const data = await rejectProposal(detail.id, reason);
      showToast('Proposta rejeitada.', 'success');
      setRejectOpen(false);
      setRejectReason('');
      setReviewSession(null);
      await refreshAfterAction(data?.proposal);
    } catch (err) {
      showToast(resolveErrorMessage(err, 'Falha ao rejeitar a proposta.'), 'error');
    } finally {
      setActionBusy(false);
    }
  };

  const handleApply = async () => {
    if (!detail) return;
    setActionBusy(true);
    try {
      const data = await applyProposal(detail.id);
      showToast('Proposta aplicada à amostra da vertical.', 'success');
      setReviewSession(null);
      await refreshAfterAction(data?.proposal);
    } catch (err) {
      showToast(resolveErrorMessage(err, 'Falha ao aplicar a proposta.'), 'error');
    } finally {
      setActionBusy(false);
    }
  };

  const reviewActive = Boolean(detail && reviewSession?.proposalId === detail.id && reviewSession?.token);

  return (
    <div className="brg-shell">
      <main className="brg-container">
        <header className="brg-header">
          <div>
            <h2>Pesquisa de Benchmark</h2>
            <p className="brg-header__policy">
              Pesquisa nunca aplica mudanças diretamente. Toda mudança de amostra exige avaliação
              documentada e aprovação humana.
            </p>
          </div>
          <button type="button" className="brg-btn brg-btn--primary" onClick={() => setCreateOpen(true)}>
            Nova proposta
          </button>
        </header>

        <div className="brg-filters">
          <label className="brg-field">
            <span>Vertical</span>
            <input
              type="text"
              value={verticalFilter}
              placeholder="Todas"
              onChange={(event) => setVerticalFilter(event.target.value)}
            />
          </label>
          <label className="brg-field">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">Todos</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="brg-btn brg-btn--secondary"
            onClick={loadProposals}
            disabled={listLoading}
          >
            {listLoading ? 'Carregando…' : 'Atualizar'}
          </button>
        </div>

        <div className="brg-layout">
          <section className="brg-list-panel" aria-label="Propostas">
            {listLoading && proposals.length === 0 ? (
              <p className="brg-muted">Carregando propostas…</p>
            ) : proposals.length === 0 ? (
              <p className="brg-muted">Nenhuma proposta encontrada.</p>
            ) : (
              <ul className="brg-cards">
                {proposals.map((proposal) => (
                  <li key={proposal.id}>
                    <button
                      type="button"
                      className={`brg-card ${selectedId === proposal.id ? 'brg-card--selected' : ''}`}
                      onClick={() => selectProposal(proposal.id)}
                    >
                      <div className="brg-card__top">
                        <span className="brg-card__id">#{shortId(proposal.id)}</span>
                        <StatusBadge status={proposal.status} />
                      </div>
                      <div className="brg-card__meta">
                        <strong>{proposal.vertical}</strong>
                        <VerdictBadge verdict={proposal.evaluation?.recommendation?.verdict} />
                      </div>
                      <div className="brg-card__footer">
                        <span>{proposal.proposedBy || '—'}</span>
                        <span>{formatDateTime(proposal.proposedAt)}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="brg-detail-panel" aria-label="Detalhe da proposta">
            {!selectedId ? (
              <p className="brg-muted">Selecione uma proposta para ver a avaliação documentada.</p>
            ) : detailLoading || !detail ? (
              <p className="brg-muted">Carregando avaliação…</p>
            ) : (
              <div className="brg-detail">
                <div className="brg-detail__header">
                  <div>
                    <h3>Proposta #{shortId(detail.id)}</h3>
                    <p className="brg-muted">
                      Vertical <strong>{detail.vertical}</strong> · patch {shortId(detail.patchSha256)}
                    </p>
                  </div>
                  <StatusBadge status={detail.status} />
                </div>

                <EvaluationDetail evaluation={detail.evaluation} />
                <AuditTrail proposal={detail} />

                <div className="brg-actions">
                  {detail.status === 'proposed' && !reviewActive ? (
                    <button
                      type="button"
                      className="brg-btn brg-btn--primary"
                      onClick={handleStartReview}
                      disabled={actionBusy}
                    >
                      Iniciar revisão
                    </button>
                  ) : null}
                  {detail.status === 'proposed' && reviewActive ? (
                    <>
                      <button
                        type="button"
                        className="brg-btn brg-btn--success"
                        onClick={() => setApproveOpen(true)}
                        disabled={actionBusy}
                      >
                        Aprovar com ressalvas
                      </button>
                      <button
                        type="button"
                        className="brg-btn brg-btn--danger"
                        onClick={() => setRejectOpen(true)}
                        disabled={actionBusy}
                      >
                        Rejeitar
                      </button>
                    </>
                  ) : null}
                  {detail.status === 'approved' ? (
                    <button
                      type="button"
                      className="brg-btn brg-btn--primary"
                      onClick={() => setApplyOpen(true)}
                      disabled={actionBusy}
                    >
                      Aplicar
                    </button>
                  ) : null}
                  {detail.status === 'applied' || detail.status === 'rejected' ? (
                    <p className="brg-muted">Decisão final registrada. Esta proposta é somente leitura.</p>
                  ) : null}
                </div>
              </div>
            )}
          </section>
        </div>
      </main>

      <Dialog
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nova proposta de mudança de amostra"
        size="sm"
        draggable={false}
        resizable={false}
      >
        <div className="brg-dialog-body">
          <p className="brg-muted">
            A pesquisa avalia a amostra da vertical e documenta a proposta. Nenhuma mudança é
            aplicada sem aprovação humana.
          </p>
          <label className="brg-field">
            <span>Vertical</span>
            <input
              type="text"
              value={newVertical}
              onChange={(event) => setNewVertical(event.target.value)}
              placeholder={DEFAULT_VERTICAL}
            />
          </label>
          <div className="brg-dialog-actions">
            <button type="button" className="brg-btn brg-btn--secondary" onClick={() => setCreateOpen(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="brg-btn brg-btn--primary"
              onClick={handleCreate}
              disabled={actionBusy}
            >
              Gerar proposta
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        isOpen={approveOpen}
        onClose={() => setApproveOpen(false)}
        title="Aprovar proposta com ressalvas"
        size="md"
        draggable={false}
        resizable={false}
      >
        <div className="brg-dialog-body">
          <label className="brg-field">
            <span>Ressalvas (uma por linha)</span>
            <textarea
              rows={5}
              value={approveCaveats}
              onChange={(event) => setApproveCaveats(event.target.value)}
              placeholder="Ex.: Validar cobertura da jornada crítica antes do próximo release"
            />
          </label>
          <label className="brg-field">
            <span>Justificativa (opcional)</span>
            <textarea
              rows={3}
              value={approveReason}
              onChange={(event) => setApproveReason(event.target.value)}
            />
          </label>
          <div className="brg-dialog-actions">
            <button type="button" className="brg-btn brg-btn--secondary" onClick={() => setApproveOpen(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="brg-btn brg-btn--success"
              onClick={handleApprove}
              disabled={actionBusy}
            >
              Aprovar
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        isOpen={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Rejeitar proposta"
        size="sm"
        draggable={false}
        resizable={false}
      >
        <div className="brg-dialog-body">
          <label className="brg-field">
            <span>Motivo da rejeição (obrigatório)</span>
            <textarea
              rows={4}
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
            />
          </label>
          <div className="brg-dialog-actions">
            <button type="button" className="brg-btn brg-btn--secondary" onClick={() => setRejectOpen(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="brg-btn brg-btn--danger"
              onClick={handleReject}
              disabled={actionBusy}
            >
              Confirmar rejeição
            </button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        isOpen={applyOpen}
        onClose={() => setApplyOpen(false)}
        onConfirm={handleApply}
        title="Aplicar proposta"
        confirmLabel="Aplicar"
        variant="warning"
        message={detail ? (
          <div className="brg-dialog-body">
            <p>
              Aplicar a mudança de amostra da vertical <strong>{detail.vertical}</strong>?
            </p>
            <p className="brg-muted">Patch aprovado: {shortId(detail.patchSha256)}</p>
            {Array.isArray(detail.caveats) && detail.caveats.length > 0 ? (
              <div className="brg-caveats">
                <h4>Ressalvas registradas</h4>
                <TextList items={detail.caveats} />
              </div>
            ) : (
              <p className="brg-muted">Aprovada sem ressalvas.</p>
            )}
          </div>
        ) : ''}
      />

      <ToastContainer />
    </div>
  );
}

export default BenchmarkResearchGovernancePage;
