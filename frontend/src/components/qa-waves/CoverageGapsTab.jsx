import React, { useCallback, useEffect, useState } from 'react';
import { fetchJson } from '../../api/client';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function CoverageBar({ value }) {
  const pctNum = Math.round((value || 0) * 100);
  const color = pctNum >= 80 ? '#16a34a' : pctNum >= 50 ? '#ca8a04' : '#dc2626';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          flex: 1,
          height: 10,
          borderRadius: 5,
          background: '#e5e7eb',
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
      <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 36 }}>{pctNum}%</span>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    draft_ai: { label: 'Rascunho IA', bg: '#fef9c3', color: '#854d0e' },
    approved: { label: 'Aprovado', bg: '#dcfce7', color: '#166534' },
    rejected: { label: 'Rejeitado', bg: '#fee2e2', color: '#991b1b' },
    draft: { label: 'Rascunho', bg: '#f3f4f6', color: '#374151' },
    reviewed: { label: 'Revisado', bg: '#dbeafe', color: '#1e40af' },
    active: { label: 'Ativo', bg: '#d1fae5', color: '#065f46' },
    deprecated: { label: 'Obsoleto', bg: '#f3f4f6', color: '#9ca3af' },
  };
  const s = map[status] || { label: status, bg: '#f3f4f6', color: '#6b7280' };
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

export function CoverageGapsTab() {
  const [coverage, setCoverage] = useState(null);
  const [gaps, setGaps] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [governance, setGovernance] = useState([]);
  const [loadingCoverage, setLoadingCoverage] = useState(false);
  const [loadingGaps, setLoadingGaps] = useState(false);
  const [loadingGenerate, setLoadingGenerate] = useState(false);
  const [loadingReview, setLoadingReview] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Formulário de gap
  const [gapForm, setGapForm] = useState({
    vertical: 'fitness',
    journey: '',
    stage: '',
    gap: '',
    context: '',
  });

  // ─── Carregamento inicial ────────────────────────────────────────────────

  const loadCoverage = useCallback(async () => {
    setLoadingCoverage(true);
    setError('');
    try {
      const data = await fetchJson('/api/qa-waves/intelligence/coverage');
      setCoverage(data);
    } catch (err) {
      setError(err?.message || 'Falha ao carregar cobertura');
    } finally {
      setLoadingCoverage(false);
    }
  }, []);

  const loadDrafts = useCallback(async () => {
    try {
      const data = await fetchJson('/api/qa-waves/intelligence/drafts');
      setDrafts(Array.isArray(data?.items) ? data.items : []);
    } catch (_) {
      // silencioso
    }
  }, []);

  const loadGovernance = useCallback(async () => {
    try {
      const data = await fetchJson('/api/qa-waves/governance');
      setGovernance(Array.isArray(data?.items) ? data.items : []);
    } catch (_) {
      // silencioso
    }
  }, []);

  useEffect(() => {
    loadCoverage();
    loadDrafts();
    loadGovernance();
  }, [loadCoverage, loadDrafts, loadGovernance]);

  // ─── Análise de gaps ─────────────────────────────────────────────────────

  async function analyzeGaps() {
    setLoadingGaps(true);
    setGaps(null);
    setError('');
    try {
      const data = await fetchJson('/api/qa-waves/intelligence/analyze-gaps', {
        method: 'POST',
        body: JSON.stringify({
          vertical: gapForm.vertical,
          journey: gapForm.journey || undefined,
        }),
      });
      setGaps(data);
    } catch (err) {
      setError(err?.message || 'Falha ao analisar gaps');
    } finally {
      setLoadingGaps(false);
    }
  }

  // ─── Geração por IA ──────────────────────────────────────────────────────

  async function generateScenario() {
    if (!gapForm.stage || !gapForm.gap) {
      setError('Preencha etapa e gap para gerar um cenário.');
      return;
    }
    setLoadingGenerate(true);
    setError('');
    setSuccess('');
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
      setSuccess(`Cenário gerado: ${data.id} (status: ${data.status}). Revise e aprove antes de executar.`);
      await loadDrafts();
    } catch (err) {
      setError(err?.message || 'Falha ao gerar cenário por IA');
    } finally {
      setLoadingGenerate(false);
    }
  }

  // ─── Aprovação / Rejeição ────────────────────────────────────────────────

  async function reviewDraft(draftId, action) {
    setLoadingReview(draftId);
    setError('');
    setSuccess('');
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

      setSuccess(`Cenário ${draftId} ${action === 'approve' ? 'aprovado' : 'rejeitado'} com sucesso.`);
      await loadDrafts();
    } catch (err) {
      setError(err?.message || 'Falha ao processar revisão');
    } finally {
      setLoadingReview(null);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {error && (
        <div className="qa-waves-feedback error" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="qa-waves-feedback success" role="status">
          {success}
        </div>
      )}

      {/* ── Cobertura por vertical ── */}
      <section className="qa-waves-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 className="qa-waves-section-title" style={{ marginBottom: 0 }}>Cobertura por Vertical e Jornada</h2>
          <button type="button" onClick={loadCoverage} disabled={loadingCoverage} className="qa-btn-primary">
            {loadingCoverage ? 'Carregando…' : '↻ Atualizar'}
          </button>
        </div>

        {coverage && (coverage.verticals || []).map((vert) => (
          <details key={vert.vertical} open style={{ marginBottom: 12, border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 15, display: 'flex', justifyContent: 'space-between' }}>
              <span>{vert.vertical}</span>
              <CoverageBar value={vert.coverage} />
            </summary>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(vert.journeys || []).map((j) => (
                <div key={j.journeyId} style={{ paddingLeft: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, flex: 1 }}>{j.journeyName || j.journeyId}</span>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>
                      {j.totalCovered}/{j.totalRequired} cenários
                    </span>
                    <div style={{ width: 160 }}>
                      <CoverageBar value={j.coverage} />
                    </div>
                  </div>
                  {(j.missingCount > 0 || j.weakCount > 0) && (
                    <div style={{ marginTop: 4, fontSize: 11, color: '#9ca3af' }}>
                      {j.missingCount > 0 && <span style={{ color: '#dc2626' }}>▼ {j.missingCount} faltando </span>}
                      {j.weakCount > 0 && <span style={{ color: '#ca8a04' }}>⚠ {j.weakCount} frágeis</span>}
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
              placeholder="fitness, beauty, pbx, core"
            />
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Jornada</span>
            <input
              type="text"
              value={gapForm.journey}
              onChange={(e) => setGapForm((p) => ({ ...p, journey: e.target.value }))}
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
          <button type="button" onClick={analyzeGaps} disabled={loadingGaps} className="qa-btn-primary">
            {loadingGaps ? 'Analisando…' : '🔍 Analisar Gaps'}
          </button>
          <button type="button" onClick={generateScenario} disabled={loadingGenerate}>
            {loadingGenerate ? 'Gerando…' : '✦ Gerar Cenário por IA'}
          </button>
        </div>

        {gaps && (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
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
                <div style={{ fontSize: 20, fontWeight: 700, color: '#dc2626' }}>{gaps.missingScenarios?.length || 0}</div>
              </div>
              <div>
                <strong>Frágeis</strong>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#ca8a04' }}>{gaps.weakScenarios?.length || 0}</div>
              </div>
            </div>

            {(gaps.missingScenarios || []).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <strong style={{ fontSize: 13, color: '#dc2626' }}>Cenários faltando:</strong>
                <ul style={{ margin: '4px 0 0 16px', fontSize: 12 }}>
                  {gaps.missingScenarios.map((id) => (
                    <li key={id}>{id}</li>
                  ))}
                </ul>
              </div>
            )}

            {(gaps.weakScenarios || []).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <strong style={{ fontSize: 13, color: '#ca8a04' }}>Cenários frágeis:</strong>
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

      {/* ── Revisão de drafts de IA ── */}
      <section className="qa-waves-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 className="qa-waves-section-title" style={{ marginBottom: 0 }}>
            Revisão de Cenários Gerados por IA
          </h2>
          <button type="button" onClick={loadDrafts} style={{ fontSize: 12 }}>↻</button>
        </div>

        {drafts.length === 0 && (
          <p className="qa-empty">Nenhum rascunho de IA pendente.</p>
        )}

        {drafts.map((draft) => (
          <div
            key={draft.id}
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              padding: 12,
              marginBottom: 10,
              background: draft.status === 'draft_ai' ? '#fefce8' : '#f9fafb',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <strong style={{ fontSize: 14 }}>{draft.title || draft.id}</strong>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{draft.id}</div>
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
                      style={{ fontSize: 12, background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
                    >
                      ✓ Aprovar
                    </button>
                    <button
                      type="button"
                      onClick={() => reviewDraft(draft.id, 'reject')}
                      disabled={loadingReview === draft.id}
                      style={{ fontSize: 12, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
                    >
                      ✗ Rejeitar
                    </button>
                  </>
                )}
              </div>
            </div>

            {(draft.semanticSteps || []).length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#374151' }}>
                <strong>Passos:</strong>{' '}
                {draft.semanticSteps.map((s, i) => (
                  <span key={i} style={{ marginRight: 6 }}>
                    {i + 1}. {s.type}
                  </span>
                ))}
              </div>
            )}

            {draft.status === 'draft_ai' && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#92400e', background: '#fef3c7', borderRadius: 4, padding: '4px 8px' }}>
                ⚠ Este cenário NÃO será executado até ser aprovado manualmente.
              </div>
            )}
          </div>
        ))}
      </section>

      {/* ── Governança ── */}
      <section className="qa-waves-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 className="qa-waves-section-title" style={{ marginBottom: 0 }}>Governança de Waves</h2>
          <button type="button" onClick={loadGovernance} style={{ fontSize: 12 }}>↻</button>
        </div>

        {governance.length === 0 && (
          <p className="qa-empty">Nenhum relatório de governança disponível. Execute uma avaliação via API.</p>
        )}

        {governance.map((report) => (
          <div
            key={report.waveId}
            style={{
              border: `2px solid ${report.status === 'GO' ? '#16a34a' : '#dc2626'}`,
              borderRadius: 8,
              padding: 12,
              marginBottom: 10,
              background: report.status === 'GO' ? '#f0fdf4' : '#fef2f2',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong style={{ fontSize: 14 }}>{report.waveId}</strong>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  Avaliado em: {report.evaluatedAt ? new Date(report.evaluatedAt).toLocaleString('pt-BR') : '—'}
                </div>
              </div>
              <div style={{
                fontSize: 20,
                fontWeight: 800,
                color: report.status === 'GO' ? '#16a34a' : '#dc2626',
              }}>
                {report.status}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 8, fontSize: 13 }}>
              <div>Cobertura: <strong>{pct(report.coverage)}</strong></div>
              <div>Qualidade: <strong>{pct(report.quality)}</strong></div>
              <div>Falhas críticas: <strong style={{ color: report.criticalFailures > 0 ? '#dc2626' : 'inherit' }}>{report.criticalFailures}</strong></div>
              <div>Cenários: <strong>{report.coveredScenarios}/{report.totalScenarios}</strong></div>
            </div>

            {(report.reasons || []).length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  {report.reasons.length} motivo(s)
                </summary>
                <ul style={{ margin: '4px 0 0 16px', fontSize: 11 }}>
                  {report.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </details>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

export default CoverageGapsTab;
