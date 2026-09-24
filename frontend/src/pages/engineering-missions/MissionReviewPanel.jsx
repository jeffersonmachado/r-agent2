import React, { useCallback, useEffect, useState } from 'react';
import {
  getEngineeringMissionReview,
  runEngineeringMissionReview,
} from '../../api/engineeringMissions';
import { useToast } from '../../components/Toast';

/**
 * Painel de revisão da missão: Meta Reviewer (§23) e Adversarial Review (§24).
 *
 * Regra de honestidade exibida aqui: o Meta Reviewer NÃO declara GREEN. Ele produz findings, e
 * findings BLOQUEANTES da versão corrente impedem GREEN — a tela mostra o bloqueio, o motivo e a
 * evidência, e também o que NÃO foi verificável (nada de "tudo certo" quando houve item não
 * verificado).
 */

const SEVERITY_STYLE = {
  BLOCKER: 'border-red-500/40 bg-red-500/5 text-red-400',
  REGRESSION: 'border-orange-500/40 bg-orange-500/5 text-orange-400',
  POST_RELEASE: 'border-amber-500/40 bg-amber-500/5 text-amber-400',
  INFO: 'border-border-default bg-bg-primary text-text-secondary',
};

function FindingRow({ finding }) {
  const style = SEVERITY_STYLE[finding.severity] || SEVERITY_STYLE.INFO;
  return (
    <li className={`rounded-lg border p-3 text-xs ${style}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="font-medium text-text-primary">
          <span className="mr-2 opacity-70">{finding.id}</span>
          {finding.title}
        </div>
        <span className="shrink-0 uppercase tracking-wide">{finding.status} · {finding.severity}</span>
      </div>
      <div className="mt-1 text-text-secondary">{finding.detail}</div>
      {finding.mechanism ? (
        <div className="mt-1 text-text-secondary opacity-80">
          <span className="font-semibold">como tornar verificável:</span> {finding.mechanism}
        </div>
      ) : null}
      {Array.isArray(finding.evidence) && finding.evidence.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-text-secondary">evidência ({finding.evidence.length})</summary>
          <pre className="mt-1 overflow-auto max-h-40 text-[10px] text-text-secondary">{JSON.stringify(finding.evidence, null, 1)}</pre>
        </details>
      ) : null}
    </li>
  );
}

export function MissionReviewPanel({ missionId }) {
  const { showToast } = useToast();
  const [review, setReview] = useState(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      setReview(await getEngineeringMissionReview(missionId));
    } catch (_) {
      setReview(null);
    }
  }, [missionId]);

  useEffect(() => { load(); }, [load]);

  const run = async (kinds) => {
    setRunning(true);
    try {
      const result = await runEngineeringMissionReview(missionId, { kinds });
      showToast?.(
        result.blocking
          ? `Revisão encontrou finding bloqueante (${result.blocking.kind}): GREEN recusado`
          : 'Revisão concluída sem findings bloqueantes',
        result.blocking ? 'error' : 'success',
      );
      await load();
    } catch (err) {
      showToast?.(err.message || 'Falha na revisão', 'error');
    } finally {
      setRunning(false);
    }
  };

  const meta = review?.latest?.meta;
  const adversarial = review?.latest?.adversarial;

  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-bold text-text-primary">Revisão (Meta + Adversarial)</h2>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={running}
            onClick={() => run(['META'])}
            className="px-3 py-1.5 rounded-lg border border-border-default bg-bg-primary text-xs text-text-primary disabled:opacity-50"
          >
            Rodar Meta Review
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => run(['META', 'ADVERSARIAL'])}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
          >
            {running ? 'Revisando…' : 'Rodar revisão completa'}
          </button>
        </div>
      </div>

      {review?.blocking ? (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-400">
          <strong>GREEN recusado.</strong> Findings bloqueantes ({review.blocking.kind}) da versão
          corrente:
          <ul className="mt-1 list-disc list-inside">
            {review.blocking.blockingFindings.map((f) => (
              <li key={f.id}>{f.id} · {f.checkId} · {f.title}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!meta && !adversarial ? (
        <p className="text-xs text-text-secondary">
          Nenhuma revisão registrada para esta missão. A revisão produz findings objetivos sobre o
          código entregue — sem ela, GREEN depende apenas dos gates do Router.
        </p>
      ) : null}

      {meta ? (
        <div className="mb-4">
          <div className="text-xs text-text-secondary mb-2">
            Meta Review · status <strong className="text-text-primary">{meta.status}</strong> ·
            bloqueia GREEN: <strong className="text-text-primary">{String(meta.blocks_green)}</strong> ·
            {' '}engine {meta.engine_version} · {new Date(meta.created_at).toLocaleString()}
          </div>
          <div className="text-[11px] text-text-secondary mb-2">
            pass={meta.counts.pass} · fail={meta.counts.fail} · not_verifiable={meta.counts.notVerifiable} ·
            blockers={meta.counts.blockers} · regressions={meta.counts.regressions}
          </div>
          <ul className="space-y-2">
            {(meta.findings || [])
              .filter((f) => f.status !== 'PASS')
              .map((f) => <FindingRow key={f.id} finding={f} />)}
          </ul>
        </div>
      ) : null}

      {adversarial ? (
        <div>
          <div className="text-xs text-text-secondary mb-2">
            Adversarial Review · ataques cobertos {adversarial.counts.covered}/{adversarial.counts.total} ·
            não automatizáveis declarados {adversarial.summary?.notAutomatable ?? 0}
          </div>
          {adversarial.counts.uncovered > 0 ? (
            <ul className="space-y-2">
              {(adversarial.findings || []).filter((c) => c.status === 'UNCOVERED').map((c) => (
                <FindingRow
                  key={c.id}
                  finding={{ id: c.id, title: c.attack, status: 'UNCOVERED', severity: c.severity, detail: `sem teste permanente: ${c.defense}`, evidence: [c.permanentTest] }}
                />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-emerald-500">Todos os ataques do catálogo têm teste permanente.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default MissionReviewPanel;
