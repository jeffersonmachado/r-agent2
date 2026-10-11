import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getPendencies } from '../api/devGovernance';
import { useToast } from '../components/Toast';

/**
 * Pendências de missão e governança.
 *
 * Por que existe: a fila oficial (`AI_MEMORY/hardening-queue.json`) e as isenções
 * aguardando aprovação não tinham NENHUMA superfície. O operador precisava abrir
 * arquivo e banco para saber o que exige decisão humana agora.
 *
 * Honestidade: `sourceUnavailable` é exibido. Lista vazia por falha de leitura
 * NÃO pode parecer lista vazia por ausência de pendência.
 */

const KIND_LABEL = {
  queue: 'Fila de missão',
  waiver_pending: 'Isenção aguardando aprovação',
  release: 'Bloqueio de release',
};

const STATUS_TONE = {
  blocked: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  in_progress: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
  pending: 'bg-slate-500/15 text-text-secondary border-border-default',
  done: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  PENDING_APPROVAL: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  ACTIVE: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
};

function Badge({ children, tone }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${tone || 'bg-slate-500/15 text-text-secondary border-border-default'}`}>
      {children}
    </span>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-border-default p-3">
      <div className="text-xs text-text-secondary">{label}</div>
      <div className={`text-xl font-semibold ${tone || 'text-text-primary'}`}>{value}</div>
    </div>
  );
}

/**
 * A razão do bloqueio é registrada em prosa longa. Despejá-la inteira na célula
 * quebra a tabela; escondê-la esconde o motivo. Aqui ela aparece resumida com o
 * texto COMPLETO a um clique — sem resumir por conta própria (resumir a razão do
 * outro é reescrever o motivo).
 */
function ReasonText({ text, limit = 220 }) {
  if (!text) return <span className="text-text-secondary">—</span>;
  const value = String(text);
  if (value.length <= limit) return <span>{value}</span>;
  return (
    <details className="max-w-xl">
      <summary className="cursor-pointer text-text-secondary">
        {value.slice(0, limit)}…
        <span className="text-sky-500"> ver tudo</span>
      </summary>
      <div className="mt-2 text-text-secondary whitespace-pre-wrap">{value}</div>
    </details>
  );
}

export function DevPendenciesPage() {
  const { showToast, ToastContainer } = useToast();
  const [onlyPending, setOnlyPending] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      setData(await getPendencies({ onlyPending }));
    } catch (err) {
      setErro(err.message || 'Falha ao carregar pendências');
      showToast?.(err.message || 'Falha ao carregar pendências', 'error');
    } finally {
      setLoading(false);
    }
  }, [onlyPending, showToast]);

  useEffect(() => { load(); }, [load]);

  const resumo = useMemo(() => (data && data.summary) || null, [data]);
  const itens = (data && data.items) || [];
  const indisponivel = (data && data.sourceUnavailable) || [];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <ToastContainer />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Pendências</h1>
          <p className="text-sm text-text-secondary">
            Fila oficial de missão, isenções aguardando aprovação e bloqueios de release.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyPending}
              onChange={(event) => setOnlyPending(event.target.checked)}
              className="h-4 w-4"
            />
            Apenas pendências
          </label>
          <button
            type="button"
            onClick={load}
            className="px-3 py-1.5 rounded-md border border-border-default text-sm text-text-primary hover:bg-slate-500/10"
          >
            Atualizar
          </button>
        </div>
      </div>

      {resumo && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          <Metric label="Exigem ação humana" value={resumo.requiresHumanAction} tone="text-amber-500" />
          <Metric label="Bloqueados" value={resumo.blocked} />
          <Metric label="Aguardando aprovação" value={resumo.awaitingApproval} />
          <Metric label="Bloqueios de release" value={resumo.releaseBlockers} />
          <Metric label="Concluídos" value={resumo.done} tone="text-emerald-500" />
        </div>
      )}

      {indisponivel.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-500">
          <strong>Fonte indisponível</strong> — a lista pode estar incompleta:
          <ul className="list-disc ml-5 mt-1">
            {indisponivel.map((linha) => <li key={linha}>{linha}</li>)}
          </ul>
        </div>
      )}

      {erro && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{erro}</div>
      )}

      {loading && !data ? (
        <div className="text-sm text-text-secondary">Carregando…</div>
      ) : itens.length === 0 ? (
        <div className="rounded-lg border border-border-default p-6 text-sm text-text-secondary">
          {onlyPending
            ? 'Nenhuma pendência exige ação humana agora. Desmarque o filtro para ver o histórico completo.'
            : 'Nenhum item na fila.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-default">
          <table className="w-full text-sm">
            <thead className="bg-slate-500/10 text-text-secondary">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Item</th>
                <th className="text-left px-3 py-2 font-medium">Origem</th>
                <th className="text-left px-3 py-2 font-medium">Estado</th>
                <th className="text-left px-3 py-2 font-medium">Por que exige decisão</th>
                <th className="text-left px-3 py-2 font-medium">Onde agir</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr key={item.id} className="border-t border-border-default align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium text-text-primary">{item.id}</div>
                    <div className="text-text-secondary">{item.title}</div>
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{KIND_LABEL[item.kind] || item.kind}</td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-text-secondary max-w-xl">
                    <ReasonText text={item.why} />
                  </td>
                  <td className="px-3 py-2">
                    {item.actionHref ? (
                      <a className="text-sky-500 hover:underline" href={item.actionHref}>{item.actionLabel || 'Abrir'}</a>
                    ) : (
                      <span className="text-text-secondary">{item.actionLabel || '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <p className="mt-3 text-xs text-text-secondary">
          {data.filtered ? `Filtro ativo: ${data.filtered.count} item(ns). ` : ''}
          Gerado em {new Date(data.generatedAt).toLocaleString('pt-BR')}.
        </p>
      )}
    </div>
  );
}

export default DevPendenciesPage;
