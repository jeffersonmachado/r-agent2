import React, { useCallback, useEffect, useState } from 'react';
import {
  getReleaseState,
  runReleaseAction,
  getReleaseAction,
  listReleaseActions,
} from '../api/devGovernance';
import { useToast } from '../components/Toast';

/**
 * UI de Release — a única pendência que não tinha superfície nenhuma.
 *
 * O que esta tela NÃO faz (de propósito):
 *   - não contorna o guard local de push. Se um hook recusa publicar tag, a tela
 *     mostra o MOTIVO e desabilita o botão;
 *   - não oferece ação que já se sabe que vai falhar (selar com worktree sujo);
 *   - não altera estado por timer: a atualização do andamento é sob demanda
 *     (a regra do repositório proíbe `setInterval` para sincronizar estado).
 *
 * Ação que altera o repositório exige confirmação em dois passos.
 */

const VERDICT_TONE = {
  DELIVERED_VERIFIED: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  DELIVERED_UNVERIFIED: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  SUPERSEDED: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  SEALED_ONLY: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
  NOT_SEALED: 'bg-slate-500/15 text-text-secondary border-border-default',
};

const VERDICT_LABEL = {
  DELIVERED_VERIFIED: 'Entregue verificada',
  DELIVERED_UNVERIFIED: 'Entregue NÃO verificada',
  SUPERSEDED: 'Superada — novo ciclo necessário',
  SEALED_ONLY: 'Selada, sem entregue',
  NOT_SEALED: 'Sem ciclo de selagem',
};

const JOB_TONE = {
  running: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
  succeeded: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  failed: 'bg-red-500/15 text-red-500 border-red-500/30',
  interrupted: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
};

function KeyValue({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border-default last:border-0">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className={`text-sm font-medium ${tone || 'text-text-primary'}`}>{value ?? '—'}</span>
    </div>
  );
}

/** Tamanho legível: manifestos pequenos apareciam como "0 MB" (informação falsa). */
function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function Card({ title, children, right }) {
  return (
    <section className="rounded-lg border border-border-default p-4">
      <header className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        {right}
      </header>
      {children}
    </section>
  );
}

export function DevReleasePage() {
  const { showToast, ToastContainer } = useToast();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(null);
  const [job, setJob] = useState(null);
  const [historico, setHistorico] = useState([]);
  const [erro, setErro] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const [estado, acoes] = await Promise.all([
        getReleaseState(),
        // O histórico vem do DISCO (sobrevive ao reinício da API); falha em
        // carregá-lo não impede ver o estado — vira lista vazia declarada.
        listReleaseActions().catch(() => ({ items: [] })),
      ]);
      setState(estado);
      setHistorico(Array.isArray(acoes && acoes.items) ? acoes.items : []);
    } catch (err) {
      setErro(err.message || 'Falha ao carregar o estado de release');
      showToast?.(err.message || 'Falha ao carregar o estado de release', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const executar = useCallback(async (actionId) => {
    const acao = (state.actions || []).find((item) => item.id === actionId);
    const precisaConfirmar = acao && acao.enabled === false ? false : true;
    if (precisaConfirmar && confirming !== actionId) {
      setConfirming(actionId);
      return;
    }
    setConfirming(null);
    try {
      const started = await runReleaseAction(actionId, { confirm: true });
      setJob(started);
      showToast?.(`Ação iniciada: ${started.label}`, 'success');
      await load();
    } catch (err) {
      setErro(err.message || 'Ação recusada');
      showToast?.(err.message || 'Ação recusada', 'error');
    }
  }, [confirming, load, showToast, state]);

  const atualizarJob = useCallback(async () => {
    if (!job) return;
    try {
      setJob(await getReleaseAction(job.id));
      const acoes = await listReleaseActions().catch(() => null);
      if (acoes && Array.isArray(acoes.items)) setHistorico(acoes.items);
    } catch (err) {
      showToast?.(err.message || 'Falha ao atualizar a ação', 'error');
    }
  }, [job, showToast]);

  if (loading && !state) {
    return <div className="p-6 text-sm text-text-secondary">Carregando…</div>;
  }
  if (!state) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <ToastContainer />
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
          {erro || 'Estado de release indisponível.'}
        </div>
      </div>
    );
  }

  const evidFaltante = state.evidenceUnavailable || [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <ToastContainer />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Release</h1>
          <p className="text-sm text-text-secondary">Estado do ciclo, artefatos e ações governadas.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-sm font-medium border ${VERDICT_TONE[state.verdict] || VERDICT_TONE.NOT_SEALED}`}>
            {VERDICT_LABEL[state.verdict] || state.verdict}
          </span>
          <button
            type="button"
            onClick={load}
            className="px-3 py-1.5 rounded-md border border-border-default text-sm text-text-primary hover:bg-slate-500/10"
          >
            Atualizar
          </button>
        </div>
      </div>

      <p className="mb-5 text-sm text-text-secondary">{state.explanation}</p>

      {evidFaltante.length > 0 && (
        <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-500">
          <strong>Evidência indisponível</strong> — não foi lida:
          <ul className="list-disc ml-5 mt-1">
            {evidFaltante.map((item) => <li key={item.code}>{item.path} ({item.reason})</li>)}
          </ul>
        </div>
      )}

      {erro && (
        <div className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{erro}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <Card title="Código atual">
          <KeyValue label="Commit" value={state.head ? state.head.commitShort : '—'} />
          <KeyValue
            label="Worktree"
            value={state.head ? (state.head.clean ? 'limpo' : `${state.head.dirtyFiles} arquivo(s) alterado(s)`) : '—'}
            tone={state.head && state.head.clean ? 'text-emerald-500' : 'text-amber-500'}
          />
        </Card>
        <Card title="Run do release">
          <KeyValue label="Run ID" value={state.run ? state.run.runId : '—'} />
          <KeyValue label="Commit do run" value={state.run ? state.run.sourceCommitShort : '—'} />
          <KeyValue label="Status" value={state.run ? state.run.status : '—'} />
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <Card title="Artefatos entregues">
          {state.artifacts.delivered.length === 0 ? (
            <p className="text-sm text-text-secondary">Nenhum artefato entregue em <code>dist/release</code>.</p>
          ) : (
            <ul className="text-sm text-text-primary space-y-1">
              {state.artifacts.delivered.map((file) => (
                <li key={file.name} className="flex items-center justify-between">
                  <span className="truncate mr-3">{file.name}</span>
                  <span className="text-text-secondary">{formatBytes(file.bytes)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Candidato">
          {state.artifacts.candidate.length === 0 ? (
            <p className="text-sm text-text-secondary">Nenhum candidato em <code>dist/candidate</code>.</p>
          ) : (
            <ul className="text-sm text-text-primary space-y-1">
              {state.artifacts.candidate.map((file) => (
                <li key={file.name} className="truncate">{file.name}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {state.guard && state.guard.blocksTagPush && (
        <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-500">
          <strong>Guard local bloqueia publicação de tag</strong> (<code>{state.guard.path}</code>): {state.guard.reason}
          <div className="mt-1 text-text-secondary">
            A tela informa o motivo e não contorna o guard — liberar é decisão do operador.
          </div>
        </div>
      )}

      <Card title="Ações">
        <div className="space-y-3">
          {(state.actions || []).map((action) => (
            <div key={action.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-border-default last:border-0 pb-3 last:pb-0">
              <div className="max-w-2xl">
                <div className="text-sm font-medium text-text-primary">{action.label}</div>
                <div className="text-sm text-text-secondary">{action.description}</div>
                {action.blockedReason && (
                  <div className="text-sm text-amber-500 mt-1">Indisponível: {action.blockedReason}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {confirming === action.id && (
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="px-3 py-1.5 rounded-md border border-border-default text-sm text-text-secondary"
                  >
                    Cancelar
                  </button>
                )}
                <button
                  type="button"
                  disabled={action.enabled === false}
                  onClick={() => executar(action.id)}
                  className={`px-3 py-1.5 rounded-md text-sm border ${action.enabled === false
                    ? 'border-border-default text-text-secondary cursor-not-allowed'
                    : (confirming === action.id
                      ? 'border-red-500/40 bg-red-500/15 text-red-500'
                      : 'border-border-default text-text-primary hover:bg-slate-500/10')}`}
                >
                  {confirming === action.id ? 'Confirmar' : 'Executar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {historico.length > 0 && (
        <div className="mt-5">
          <Card title="Histórico de ações (persistido)">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-text-secondary">
                  <tr>
                    <th className="text-left py-1.5 font-medium">Ação</th>
                    <th className="text-left py-1.5 font-medium">Estado</th>
                    <th className="text-left py-1.5 font-medium">Início</th>
                    <th className="text-left py-1.5 font-medium">Log</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map((item) => (
                    <tr key={item.id} className="border-t border-border-default align-top">
                      <td className="py-1.5 text-text-primary">{item.label || item.actionId}</td>
                      <td className="py-1.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${JOB_TONE[item.status] || JOB_TONE.running}`}>
                          {item.status}
                        </span>
                        {item.exitCode !== null && item.exitCode !== undefined && (
                          <span className="ml-2 text-xs text-text-secondary">exit {item.exitCode}</span>
                        )}
                      </td>
                      <td className="py-1.5 text-text-secondary">
                        {item.startedAt ? new Date(item.startedAt).toLocaleString('pt-BR') : '—'}
                      </td>
                      <td className="py-1.5 text-text-secondary truncate max-w-xs" title={item.logPath}>{item.logPath}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-text-secondary">
              Registros ficam no runtime root (fora do workspace) e sobrevivem ao reinício da API. Ação marcada
              como <code>interrupted</code> foi iniciada por uma sessão anterior e o processo não está mais vivo.
            </p>
          </Card>
        </div>
      )}

      {job && (
        <div className="mt-5">
          <Card
            title={`Ação em andamento — ${job.label}`}
            right={(
              <button
                type="button"
                onClick={atualizarJob}
                className="px-3 py-1 rounded-md border border-border-default text-xs text-text-primary hover:bg-slate-500/10"
              >
                Atualizar status
              </button>
            )}
          >
            <div className="flex items-center gap-3 mb-2">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${JOB_TONE[job.status] || JOB_TONE.running}`}>
                {job.status}
              </span>
              {job.exitCode !== null && job.exitCode !== undefined && (
                <span className="text-xs text-text-secondary">exit {job.exitCode}</span>
              )}
              <span className="text-xs text-text-secondary">log: {job.logPath}</span>
            </div>
            {job.logTail && (
              <pre className="text-xs bg-slate-500/10 rounded-md p-3 max-h-72 overflow-auto whitespace-pre-wrap text-text-secondary">
                {job.logTail.slice(-6000)}
              </pre>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

export default DevReleasePage;
