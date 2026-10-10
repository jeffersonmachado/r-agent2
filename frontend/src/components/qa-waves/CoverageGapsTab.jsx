import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson } from '../../api/client';
import { useToast } from '../Toast';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function CoverageBar({ value }) {
  const pctNum = Math.round((value || 0) * 100);
  const color = pctNum >= 80 ? 'var(--color-status-success)' : pctNum >= 50 ? 'var(--color-status-warning)' : 'var(--color-status-error)';
  return (
    <div className="flex items-center gap-2">
      <div
        style={{
          flex: 1,
          height: 10,
          borderRadius: 5,
          background: 'var(--color-border-default)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pctNum}%`,
            height: '100%',
            background: color,
            transition: 'width 0.4s',
          }}
        />
      </div>
      <span className="text-xs font-semibold min-w-[36px]" style={{ color }}>{pctNum}%</span>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    draft_ai: { label: 'Rascunho IA', bg: 'var(--color-bg-secondary)', color: 'var(--color-status-warning)' },
    approved: { label: 'Aprovado', bg: 'var(--color-bg-secondary)', color: 'var(--color-status-success)' },
    rejected: { label: 'Rejeitado', bg: 'var(--color-bg-secondary)', color: 'var(--color-status-error)' },
    draft: { label: 'Rascunho', bg: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' },
    reviewed: { label: 'Revisado', bg: 'var(--color-bg-secondary)', color: 'var(--color-status-info)' },
    active: { label: 'Ativo', bg: 'var(--color-bg-secondary)', color: 'var(--color-status-success)' },
    deprecated: { label: 'Obsoleto', bg: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' },
  };
  const s = map[status] || { label: status, bg: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' };
  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
        background: s.bg,
        color: s.color,
      }}
    >
      {s.label}
    </span>
  );
}

// ─── Componente Principal ─────────────────────────────────────────────────────

export function CoverageGapsTab({ domainId = null }) {
  const [coverage, setCoverage] = useState(null);
  const [gaps, setGaps] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [loadingCoverage, setLoadingCoverage] = useState(false);
  const [loadingGaps, setLoadingGaps] = useState(false);
  const [businessGaps, setBusinessGaps] = useState(null);
  const [loadingBusinessGaps, setLoadingBusinessGaps] = useState(false);
  const [loadingGenerate, setLoadingGenerate] = useState(false);
  const [loadingReview, setLoadingReview] = useState(null);
  const [verticalReview, setVerticalReview] = useState(null);
  const [loadingVerticalReview, setLoadingVerticalReview] = useState(false);
  const [verticalReviewTarget, setVerticalReviewTarget] = useState(domainId || 'fitness');
  const [recordJourney, setRecordJourney] = useState(false);
  const { showToast, ToastContainer } = useToast();

  const notifyError = useCallback((message) => {
    if (!message) return;
    showToast(message, 'error');
  }, [showToast]);

  const notifySuccess = useCallback((message) => {
    if (!message) return;
    showToast(message, 'success');
  }, [showToast]);

  // Formulário de gap
  const [gapForm, setGapForm] = useState({
    vertical: domainId || 'fitness',
    journey: '',
    stage: '',
    gap: '',
    context: '',
  });
  const [analysisFilters, setAnalysisFilters] = useState({
    vertical: domainId || 'fitness',
    journey: '',
  });

  // Drafts de IA também ficam escopados pelo domínio selecionado.
  const visibleDrafts = useMemo(() => {
    if (!domainId) return drafts;
    return drafts.filter((draft) => draft.vertical === domainId);
  }, [drafts, domainId]);

  // Sequência de requisições: evita que respostas de um domínio anterior
  // (stale) sobrescrevam o resultado do domínio selecionado. Uma ref por
  // endpoint, pois as respostas chegam de forma independente.
  const coverageSeqRef = useRef(0);
  const businessGapsSeqRef = useRef(0);

  // Quando o domínio muda (pills no topo), reescopar a vertical do formulário,
  // da revisão e da análise de gaps.
  useEffect(() => {
    if (!domainId) return;
    setVerticalReviewTarget(domainId);
    setGapForm((prev) => (prev.vertical === domainId ? prev : { ...prev, vertical: domainId }));
    setAnalysisFilters((prev) => (prev.vertical === domainId ? prev : { ...prev, vertical: domainId }));
  }, [domainId]);

  // ─── Carregamento inicial ────────────────────────────────────────────────

  const loadCoverage = useCallback(async () => {
    const seq = ++coverageSeqRef.current;
    setLoadingCoverage(true);
    try {
      const query = domainId ? `?vertical=${encodeURIComponent(domainId)}` : '';
      const data = await fetchJson(`/api/qa-waves/intelligence/coverage${query}`);
      if (seq === coverageSeqRef.current) setCoverage(data);
    } catch (err) {
      if (seq === coverageSeqRef.current) notifyError(err?.message || 'Falha ao carregar cobertura');
    } finally {
      if (seq === coverageSeqRef.current) setLoadingCoverage(false);
    }
  }, [domainId, notifyError]);

  const loadDrafts = useCallback(async () => {
    try {
      const data = await fetchJson('/api/qa-waves/intelligence/drafts');
      setDrafts(Array.isArray(data?.items) ? data.items : []);
    } catch (_) {
      // silencioso
    }
  }, []);

  const loadBusinessGaps = useCallback(async () => {
    const seq = ++businessGapsSeqRef.current;
    setLoadingBusinessGaps(true);
    try {
      const query = domainId ? `?vertical=${encodeURIComponent(domainId)}` : '';
      const data = await fetchJson(`/api/qa-waves/intelligence/business-gaps${query}`);
      if (seq === businessGapsSeqRef.current) setBusinessGaps(data);
    } catch (_) {
      // silencioso
    } finally {
      if (seq === businessGapsSeqRef.current) setLoadingBusinessGaps(false);
    }
  }, [domainId]);

  useEffect(() => {
    loadCoverage();
    loadDrafts();
    loadBusinessGaps();
  }, [loadCoverage, loadDrafts, loadBusinessGaps]);

  // ─── Análise de gaps ─────────────────────────────────────────────────────

  const analyzeGaps = useCallback(async () => {
    if (!analysisFilters.vertical?.trim()) {
      setGaps(null);
      return;
    }

    setLoadingGaps(true);
    setGaps(null);
    try {
      const data = await fetchJson('/api/qa-waves/intelligence/analyze-gaps', {
        method: 'POST',
        body: JSON.stringify({
          vertical: analysisFilters.vertical,
          journey: analysisFilters.journey || undefined,
        }),
      });
      setGaps(data);
    } catch (err) {
      notifyError(err?.message || 'Falha ao analisar gaps');
    } finally {
      setLoadingGaps(false);
    }
  }, [analysisFilters.vertical, analysisFilters.journey, notifyError]);

  const syncAnalysisFilters = useCallback(() => {
    const nextVertical = gapForm.vertical?.trim() || '';
    const nextJourney = gapForm.journey?.trim() || '';
    setAnalysisFilters((prev) => {
      if (prev.vertical === nextVertical && prev.journey === nextJourney) return prev;
      return {
        vertical: nextVertical,
        journey: nextJourney,
      };
    });
  }, [gapForm.vertical, gapForm.journey]);

  useEffect(() => {
    const timer = setTimeout(() => {
      analyzeGaps();
    }, 300);

    return () => clearTimeout(timer);
  }, [analyzeGaps]);

  // ─── Geração por IA ──────────────────────────────────────────────────────

  async function generateScenario() {
    if (!gapForm.stage || !gapForm.gap) {
      notifyError('Preencha etapa e gap para gerar um cenário.');
      return;
    }
    setLoadingGenerate(true);
    try {
      let ctx = {};
      if (gapForm.context) {
        try { ctx = JSON.parse(gapForm.context); } catch (_) { ctx = {}; }
      }
      const data = await fetchJson('/api/qa-waves/intelligence/generate-scenario', {
        method: 'POST',
        body: JSON.stringify({
          vertical: gapForm.vertical,
          journey: gapForm.journey || gapForm.vertical,
          stage: gapForm.stage,
          gap: gapForm.gap,
          context: ctx,
        }),
      });
      notifySuccess(`Cenário gerado: ${data.id} (status: ${data.status}). Revise e aprove antes de executar.`);
      await loadDrafts();
    } catch (err) {
      notifyError(err?.message || 'Falha ao gerar cenário por IA');
    } finally {
      setLoadingGenerate(false);
    }
  }

  // ─── Aprovação / Rejeição ────────────────────────────────────────────────

  async function reviewDraft(draftId, action) {
    setLoadingReview(draftId);
    try {
      const endpoint =
        action === 'approve'
          ? '/api/qa-waves/intelligence/approve-scenario'
          : '/api/qa-waves/intelligence/reject-scenario';

      const body =
        action === 'approve'
          ? { draftId, approvedBy: 'review_ui' }
          : { draftId, rejectedBy: 'review_ui', reason: 'Rejeitado via interface de revisão' };

      await fetchJson(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      notifySuccess(`Cenário ${draftId} ${action === 'approve' ? 'aprovado' : 'rejeitado'} com sucesso.`);
      await loadDrafts();
    } catch (err) {
      notifyError(err?.message || 'Falha ao processar revisão');
    } finally {
      setLoadingReview(null);
    }
  }

  // ─── Revisão da Vertical (orquestrada por QA) ───────────────────────────

  async function runVerticalReview() {
    const vertical = verticalReviewTarget?.trim();
    if (!vertical) {
      notifyError('Informe a vertical a revisar.');
      return;
    }
    setLoadingVerticalReview(true);
    setVerticalReview(null);
    try {
      const data = await fetchJson('/api/qa-waves/vertical-review', {
        method: 'POST',
        body: JSON.stringify({
          vertical,
          autoGenerateDrafts: true,
          maxDrafts: 5,
          recordJourney,
          maxRecordings: 3,
        }),
      });
      setVerticalReview(data);
      const recorded = data.recordedJourney;
      const recMsg = recorded && recorded.queued?.length > 0
        ? `, ${recorded.queued.length} jornada(s) gravada(s) em RPA/replay`
        : '';
      notifySuccess(`Revisão da vertical "${data.vertical}" concluída: ${data.gapCount} gap(s), ${data.draftsGenerated} draft(s) gerado(s)${recMsg}.`);
      await loadDrafts();
    } catch (err) {
      notifyError(err?.message || 'Falha ao revisar a vertical');
    } finally {
      setLoadingVerticalReview(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      {/* ── Revisão da Vertical (IA infere + QA persiste) ── */}
      <section className="qa-waves-panel">
        <div className="flex justify-between items-center mb-3">
          <div>
            <h2 className="qa-waves-section-title mb-0">🔍 Revisão da Vertical</h2>
            <p className="qa-empty" style={{ margin: '2px 0 0', fontSize: 12 }}>
              A IA infere jornadas e gaps da vertical e gera drafts de cenário. Gravação RPA exige seleção explícita abaixo.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <input
            type="text"
            value={verticalReviewTarget}
            onChange={(e) => setVerticalReviewTarget(e.target.value)}
            placeholder="fitness, beauty, food…"
            style={{ flex: 1, maxWidth: 260 }}
          />
          <button
            type="button"
            onClick={runVerticalReview}
            disabled={loadingVerticalReview}
            className="qa-btn-primary"
            data-testid="qa-waves-vertical-review-button"
          >
            {loadingVerticalReview ? 'Revisando…' : '🔍 Revisar vertical'}
          </button>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={recordJourney}
            onChange={(e) => setRecordJourney(e.target.checked)}
          />
          🎬 Gravar jornada em RPA/replay (revisão, treinamento e mentoria/tutoria)
        </label>

        {verticalReview && (
          <div style={{ border: '1px solid var(--color-border-default)', borderRadius: 8, padding: 12, background: 'var(--color-bg-elevated)' }}>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
              <div>
                <strong>Vertical</strong>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{verticalReview.vertical}</div>
              </div>
              <div>
                <strong>Gaps</strong>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-status-error)' }}>{verticalReview.gapCount}</div>
              </div>
              <div>
                <strong>Drafts gerados</strong>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-status-warning)' }}>{verticalReview.draftsGenerated}</div>
              </div>
              <div>
                <strong>Capabilities da vertical</strong>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{verticalReview.discovery?.verticalCapabilities || 0}</div>
              </div>
              <div>
                <strong>Jornadas inferidas</strong>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{verticalReview.journeyInference?.candidates?.length || 0}</div>
              </div>
            </div>

            {verticalReview.reviewId && (
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 8 }}>
                Revisão {verticalReview.reviewId} · {verticalReview.durationMs}ms
              </div>
            )}

            {(verticalReview.gaps || []).length > 0 && (
              <details>
                <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  Gaps detectados ({verticalReview.gaps.length})
                </summary>
                <ul style={{ margin: '6px 0 0 16px', fontSize: 12 }}>
                  {verticalReview.gaps.map((gap, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      <strong style={{ color: 'var(--color-status-warning)' }}>[{gap.type}]</strong>{' '}
                      {gap.journeyId !== 'unknown' && <span style={{ color: 'var(--color-text-secondary)' }}>{gap.journeyId} — </span>}
                      {gap.gap}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {(verticalReview.drafts || []).length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  Drafts gerados ({verticalReview.drafts.length}) — revise na seção "Revisão de Cenários Gerados por IA"
                </summary>
                <ul style={{ margin: '6px 0 0 16px', fontSize: 12 }}>
                  {verticalReview.drafts.map((draft, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      {draft.status === 'failed' ? '❌' : '✓'}{' '}
                      <strong>{draft.id || '(falha)'}</strong>
                      {draft.title && draft.title !== draft.id ? ` — ${draft.title}` : ''}
                      {draft.error ? ` — ${draft.error}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {verticalReview.recordedJourney && (
              <div style={{ marginTop: 10, borderTop: '1px dashed var(--color-border-default)', paddingTop: 8 }}>
                <strong style={{ fontSize: 13 }}>🎬 Jornada gravada em RPA/replay</strong>
                {verticalReview.recordedJourney.requested > 0 ? (
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    {verticalReview.recordedJourney.queued.length > 0 ? (
                      <ul style={{ margin: '4px 0 0 16px' }}>
                        {verticalReview.recordedJourney.queued.map((item, i) => (
                          <li key={i} style={{ marginBottom: 4 }}>
                            <strong>{item.scenarioId}</strong>{' '}
                            {item.journeyId ? `(${item.journeyId})` : ''} — execução{' '}
                            <strong>{item.executionId || 'enfileirada'}</strong>
                            {item.replayId && (
                              <>
                                {' · replay '}
                                <a
                                  href={`/dev/rpa-replays?search=${encodeURIComponent(item.replayId)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ color: 'var(--color-accent-primary)' }}
                                >
                                  {item.replayId} ↗
                                </a>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span>Nenhuma jornada enfileirada para gravação.</span>
                    )}
                    {verticalReview.recordedJourney.failed.length > 0 && (
                      <details style={{ marginTop: 4 }}>
                        <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--color-status-warning)' }}>
                          {verticalReview.recordedJourney.failed.length} falha(s) de gravação
                        </summary>
                        <ul style={{ margin: '4px 0 0 16px', fontSize: 12 }}>
                          {verticalReview.recordedJourney.failed.map((f, i) => (
                            <li key={i}>{f.scenarioId}: {f.reason}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {verticalReview.recordedJourney.skipped?.length > 0 && (
                      <div style={{ fontSize: 12, marginTop: 4, color: 'var(--color-text-tertiary)' }}>
                        Adiadas para a próxima revisão (mesh processa uma onda por vez):{' '}
                        {verticalReview.recordedJourney.skipped.map((s) => s.scenarioId).join(', ')}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                      Replays ficam em /dev/rpa-replays e alimentam treinamento (RAG training:*) e mentoria/tutoria.
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, marginTop: 4, color: 'var(--color-text-tertiary)' }}>
                    Nenhum cenário executável (approved + seeds de browser) encontrado para gravação.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Cobertura por vertical ── */}
      <section className="qa-waves-panel">
        <div className="flex justify-between items-center mb-3">
          <h2 className="qa-waves-section-title mb-0">Cobertura por Vertical e Jornada</h2>
          <button type="button" onClick={loadCoverage} disabled={loadingCoverage} className="qa-btn-primary">
            {loadingCoverage ? 'Carregando…' : '↻ Atualizar'}
          </button>
        </div>

        {coverage && (coverage.verticals || []).map((vert) => (
          <details key={vert.vertical} open style={{ marginBottom: 12, border: '1px solid var(--color-border-default)', borderRadius: 8, padding: 12 }}>
            <summary className="cursor-pointer font-bold text-[15px] flex justify-between">
              <span>{vert.vertical}</span>
              <CoverageBar value={vert.coverage} />
            </summary>
            <div className="mt-3 flex flex-col gap-2">
              {(vert.journeys || []).map((j) => (
                <div key={j.journeyId} className="pl-3">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span className="text-[13px] flex-1">{j.journeyName || j.journeyId}</span>
                    <span className="text-xs text-muted">
                      {j.totalCovered}/{j.totalRequired} cenários
                    </span>
                    <div style={{ width: 160 }}>
                      <CoverageBar value={j.coverage} />
                    </div>
                  </div>
                  {(j.missingCount > 0 || j.weakCount > 0) && (
                    <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                      {j.missingCount > 0 && <span style={{ color: 'var(--color-status-error)' }}>▼ {j.missingCount} faltando </span>}
                      {j.weakCount > 0 && <span style={{ color: 'var(--color-status-warning)' }}>⚠ {j.weakCount} frágeis</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </details>
        ))}

        {!coverage && !loadingCoverage && (
          <p className="qa-empty">Clique em "Atualizar" para calcular a cobertura.</p>
        )}
      </section>

      {/* ── Análise de gaps ── */}
      <section className="qa-waves-panel">
        <h2 className="qa-waves-section-title">Análise de Gaps e Geração por IA</h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Vertical *</span>
            <input
              type="text"
              value={gapForm.vertical}
              onChange={(e) => setGapForm((p) => ({ ...p, vertical: e.target.value }))}
              onBlur={syncAnalysisFilters}
              placeholder="fitness, beauty, pbx, core"
            />
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Jornada</span>
            <input
              type="text"
              value={gapForm.journey}
              onChange={(e) => setGapForm((p) => ({ ...p, journey: e.target.value }))}
              onBlur={syncAnalysisFilters}
              placeholder="fitness_new_customer"
            />
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Etapa (para geração) *</span>
            <input
              type="text"
              value={gapForm.stage}
              onChange={(e) => setGapForm((p) => ({ ...p, stage: e.target.value }))}
              placeholder="agendamento, onboarding…"
            />
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Gap identificado *</span>
            <input
              type="text"
              value={gapForm.gap}
              onChange={(e) => setGapForm((p) => ({ ...p, gap: e.target.value }))}
              placeholder="pagamento antes do acesso"
            />
          </label>

          <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Contexto adicional (JSON)</span>
            <input
              type="text"
              value={gapForm.context}
              onChange={(e) => setGapForm((p) => ({ ...p, context: e.target.value }))}
              placeholder='{"canal":"whatsapp"}'
            />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button type="button" onClick={generateScenario} disabled={loadingGenerate}>
            {loadingGenerate ? 'Gerando…' : '✦ Gerar Cenário por IA'}
          </button>
        </div>

        {loadingGaps && !gaps && (
          <p style={{ marginBottom: 12, fontSize: 12, color: 'var(--color-text-secondary)' }}>
            Analisando gaps automaticamente…
          </p>
        )}

        {gaps && (
          <div style={{ border: '1px solid var(--color-border-default)', borderRadius: 8, padding: 12, background: 'var(--color-bg-elevated)' }}>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
              <div>
                <strong>Cobertura</strong>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{pct(gaps.coverage)}</div>
              </div>
              <div>
                <strong>Obrigatórios</strong>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{gaps.totalRequired}</div>
              </div>
              <div>
                <strong>Cobertos</strong>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{gaps.totalCovered}</div>
              </div>
              <div>
                <strong>Faltando</strong>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-status-error)' }}>{gaps.missingScenarios?.length || 0}</div>
              </div>
              <div>
                <strong>Frágeis</strong>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-status-warning)' }}>{gaps.weakScenarios?.length || 0}</div>
              </div>
            </div>

            {(gaps.missingScenarios || []).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <strong style={{ fontSize: 13, color: 'var(--color-status-error)' }}>Cenários faltando:</strong>
                <ul style={{ margin: '4px 0 0 16px', fontSize: 12 }}>
                  {gaps.missingScenarios.map((id) => (
                    <li key={id}>{id}</li>
                  ))}
                </ul>
              </div>
            )}

            {(gaps.weakScenarios || []).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <strong style={{ fontSize: 13, color: 'var(--color-status-warning)' }}>Cenários frágeis:</strong>
                <ul style={{ margin: '4px 0 0 16px', fontSize: 12 }}>
                  {gaps.weakScenarios.map((s) => (
                    <li key={s.id}>
                      <strong>{s.id}</strong>
                      {' — '}
                      {(s.reasons || []).join(', ')}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(gaps.recommendedActions || []).length > 0 && (
              <details>
                <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  Ações recomendadas ({gaps.recommendedActions.length})
                </summary>
                <ul style={{ margin: '4px 0 0 16px', fontSize: 12 }}>
                  {gaps.recommendedActions.map((action, i) => (
                    <li key={i}>{action}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>

      {/* ── Business Gaps (contratos x cobertura) ── */}
      <section className="qa-waves-panel">
        <div className="flex justify-between items-center mb-3">
          <h2 className="qa-waves-section-title mb-0">
            📋 Gaps de Negócio (Contratos × Cobertura)
          </h2>
          <button type="button" onClick={loadBusinessGaps} disabled={loadingBusinessGaps} className="qa-btn-primary" style={{ fontSize: 12 }}>
            {loadingBusinessGaps ? 'Carregando…' : '↻ Atualizar'}
          </button>
        </div>

        {businessGaps && (
          <div style={{ marginBottom: 8, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
            <span><strong>{businessGaps.summary?.totalJourneys || 0}</strong> jornadas</span>
            <span style={{ color: 'var(--color-status-error)' }}><strong>{businessGaps.summary?.journeysWithGaps || 0}</strong> com gaps</span>
            <span>Confiança média: <strong>{(businessGaps.summary?.averageConfidence * 100).toFixed(0)}%</strong></span>
          </div>
        )}

        {businessGaps && (businessGaps.verticals || []).map((item) => (
          <details key={item.vertical + '/' + item.journeyId} style={{ marginBottom: 8, border: '1px solid var(--color-border-default)', borderRadius: 8, padding: '8px 12px' }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{item.vertical}/{item.journeyId}</span>
              <span style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                <span>Conf: {(item.contract.confidence * 100).toFixed(0)}%</span>
                <span>{item.coverage.approvedScenarios}/{item.coverage.targetScenarios} cenários</span>
                {item.gaps.hasGaps ? (
                  <span style={{ color: 'var(--color-status-error)' }}>🔴 {item.gaps.missingCount} gaps</span>
                ) : (
                  <span style={{ color: 'var(--color-status-success)' }}>✅</span>
                )}
              </span>
            </summary>
            <div style={{ marginTop: 8 }}>
              {item.contract.requiredCapabilities.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Capabilities requeridas: </span>
                  {item.contract.requiredCapabilities.map(cap => {
                    const isGap = (item.gaps.capabilityGaps || []).includes(cap);
                    return (
                      <span key={cap} style={{
                        display: 'inline-block',
                        margin: '2px 4px 2px 0',
                        padding: '2px 8px',
                        borderRadius: 10,
                        fontSize: 11,
                        background: isGap ? 'var(--color-status-error)' : 'var(--color-status-success)',
                        color: isGap ? 'var(--color-status-error)' : 'var(--color-status-success)',
                      }}>{isGap ? '✗ ' : '✓ '}{cap}</span>
                    );
                  })}
                </div>
              )}
              {(item.gaps.capabilityGaps || []).length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--color-status-error)' }}>
                  ⚠️ Sem cenário QA para: {item.gaps.capabilityGaps.join(', ')}
                </div>
              )}
            </div>
          </details>
        ))}

        {!businessGaps && !loadingBusinessGaps && (
          <p className="qa-empty">Clique em "Atualizar" para carregar os gaps de negócio.</p>
        )}
      </section>

      {/* ── Revisão de drafts de IA ── */}
      <section className="qa-waves-panel">
        <div className="flex justify-between items-center mb-3">
          <h2 className="qa-waves-section-title mb-0">
            Revisão de Cenários Gerados por IA
          </h2>
          <button type="button" onClick={loadDrafts} style={{ fontSize: 12 }}>↻</button>
        </div>

        {visibleDrafts.length === 0 && (
          <p className="qa-empty">Nenhum rascunho de IA pendente.</p>
        )}

        {visibleDrafts.map((draft) => (
          <div
            key={draft.id}
            style={{
              border: '1px solid var(--color-border-default)',
              borderRadius: 8,
              padding: 12,
              marginBottom: 10,
              background: draft.status === 'draft_ai' ? 'var(--color-bg-secondary)' : 'var(--color-bg-elevated)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <strong style={{ fontSize: 14 }}>{draft.title || draft.id}</strong>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{draft.id}</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  {draft.vertical} / {draft.journey} / {draft.stage}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <StatusPill status={draft.status} />
                {draft.status === 'draft_ai' && (
                  <>
                    <button
                      type="button"
                      onClick={() => reviewDraft(draft.id, 'approve')}
                      disabled={loadingReview === draft.id}
                      style={{ fontSize: 12, background: 'var(--color-status-success)', color: 'var(--color-bg-primary)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
                    >
                      ✓ Aprovar
                    </button>
                    <button
                      type="button"
                      onClick={() => reviewDraft(draft.id, 'reject')}
                      disabled={loadingReview === draft.id}
                      style={{ fontSize: 12, background: 'var(--color-status-error)', color: 'var(--color-bg-primary)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
                    >
                      ✗ Rejeitar
                    </button>
                  </>
                )}
              </div>
            </div>

            {(draft.semanticSteps || []).length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                <strong>Passos:</strong>{' '}
                {draft.semanticSteps.map((s, i) => (
                  <span key={i} style={{ marginRight: 6 }}>
                    {i + 1}. {s.type}
                  </span>
                ))}
              </div>
            )}

            {draft.status === 'draft_ai' && (
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-status-warning)', background: 'var(--color-bg-secondary)', borderRadius: 4, padding: '4px 8px' }}>
                ⚠ Este cenário NÃO será executado até ser aprovado manualmente.
              </div>
            )}
          </div>
        ))}
      </section>
      <ToastContainer />
    </div>
  );
}

export default CoverageGapsTab;
