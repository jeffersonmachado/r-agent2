import React, { useState, useCallback } from 'react';
import {
  getCcReportAtendidas,
  getCcReportAbandonadas,
  getCcReportAgentes,
  getCcReportPorHora,
  getCcReportResumoCampanha,
  getCcReportPesquisa,
} from '../../api/pbx';

// ─── Utilitários ─────────────────────────────────────────────────────────────

function fmtDur(secs) {
  if (secs == null || Number.isNaN(Number(secs))) return '—';
  const s = Number(secs);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${String(m % 60).padStart(2, '0')}m`;
  if (m > 0) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}

function fmtPct(val) {
  if (val == null) return '—';
  return `${val}%`;
}

function toISODate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}

function defaultFilters() {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: toISODate(from), to: toISODate(to), queueName: '' };
}

// ─── Componente de filtros reutilizável ──────────────────────────────────────

function ReportFilters({ filters, setFilters, onLoad, loading, errorMsg }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13 }}>
        <span>De</span>
        <input
          type="date"
          value={filters.from}
          onChange={(e) => setFilters((s) => ({ ...s, from: e.target.value }))}
          style={{ padding: '6px 8px', border: '1px solid var(--color-border-default)', borderRadius: 4, background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)' }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13 }}>
        <span>Até</span>
        <input
          type="date"
          value={filters.to}
          onChange={(e) => setFilters((s) => ({ ...s, to: e.target.value }))}
          style={{ padding: '6px 8px', border: '1px solid var(--color-border-default)', borderRadius: 4, background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)' }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13 }}>
        <span>Fila (opcional)</span>
        <input
          type="text"
          placeholder="ex: suporte"
          value={filters.queueName}
          onChange={(e) => setFilters((s) => ({ ...s, queueName: e.target.value }))}
          style={{ padding: '6px 8px', border: '1px solid var(--color-border-default)', borderRadius: 4, background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', width: 160 }}
        />
      </label>
      <button
        onClick={onLoad}
        disabled={loading}
        style={{ padding: '8px 16px', alignSelf: 'flex-end', opacity: loading ? 0.6 : 1 }}
      >
        {loading ? 'Carregando…' : 'Gerar relatório'}
      </button>
      {errorMsg && <span style={{ color: 'var(--color-status-error)', fontSize: 13, alignSelf: 'flex-end' }}>{errorMsg}</span>}
    </div>
  );
}

// ─── Estilos compartilhados de tabela ────────────────────────────────────────
const TH = { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--color-border-default)', fontWeight: 600, whiteSpace: 'nowrap' };
const TD = { padding: '7px 10px', borderBottom: '1px solid var(--color-border-default)', whiteSpace: 'nowrap' };
const TR_ODD = { background: 'var(--color-bg-secondary)' };

// ─── Exportar CSV utilitário ──────────────────────────────────────────────────
function exportCsv(filename, headers, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-relatório: Atendidas
// ─────────────────────────────────────────────────────────────────────────────
function TabAtendidas() {
  const [filters, setFilters] = useState(defaultFilters);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await getCcReportAtendidas({ from: filters.from, to: filters.to, queueName: filters.queueName || undefined });
      setData(res.data || null);
    } catch (e) {
      setErr(e.message || 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const rows = data?.queues || [];

  return (
    <>
      <h3 className="mt-0">CC: Chamadas Atendidas por Fila</h3>
      <ReportFilters filters={filters} setFilters={setFilters} onLoad={load} loading={loading} errorMsg={err} />
      {data && (
        <>
          <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--color-text-secondary)' }}>
            Total atendidas: <strong>{data.total}</strong> | Período: {data.from?.slice(0, 10)} → {data.to?.slice(0, 10)}
          </div>
          <button onClick={() => exportCsv('atendidas.csv', ['Fila', 'Atendidas', 'Dur.Méd.(s)', 'Billsec Méd.(s)', 'Dur.Mín.(s)', 'Dur.Máx.(s)'],
            rows.map((r) => [r.queue, r.count, r.avgDuration, r.avgBillsec, r.minDuration, r.maxDuration]))}
            style={{ marginBottom: 10, padding: '5px 10px', fontSize: 12 }}>
            Exportar CSV
          </button>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Fila', 'Atendidas', 'Dur.Méd.', 'Billsec Méd.', 'Dur.Mín.', 'Dur.Máx.'].map((h) => <th key={h} style={TH}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={6} style={{ ...TD, color: 'var(--color-text-secondary)', textAlign: 'center' }}>Sem dados</td></tr>}
                {rows.map((r, i) => (
                  <tr key={r.queue} style={i % 2 === 1 ? TR_ODD : {}}>
                    <td style={TD}>{r.queue}</td>
                    <td style={TD}><strong>{r.count}</strong></td>
                    <td style={TD}>{fmtDur(r.avgDuration)}</td>
                    <td style={TD}>{fmtDur(r.avgBillsec)}</td>
                    <td style={TD}>{fmtDur(r.minDuration)}</td>
                    <td style={TD}>{fmtDur(r.maxDuration)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-relatório: Abandonadas
// ─────────────────────────────────────────────────────────────────────────────
function TabAbandonadas() {
  const [filters, setFilters] = useState(defaultFilters);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await getCcReportAbandonadas({ from: filters.from, to: filters.to, queueName: filters.queueName || undefined });
      setData(res.data || null);
    } catch (e) {
      setErr(e.message || 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const rows = data?.queues || [];

  return (
    <>
      <h3 className="mt-0">CC: Chamadas Abandonadas por Fila</h3>
      <ReportFilters filters={filters} setFilters={setFilters} onLoad={load} loading={loading} errorMsg={err} />
      {data && (
        <>
          <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--color-text-secondary)' }}>
            Total abandonadas: <strong>{data.total}</strong> | Período: {data.from?.slice(0, 10)} → {data.to?.slice(0, 10)}
          </div>
          <button onClick={() => exportCsv('abandonadas.csv', ['Fila', 'Total', 'Atendidas', 'Abandonadas', 'Taxa Abandono'],
            rows.map((r) => [r.queue, r.total, r.answered, r.abandoned, fmtPct(r.abandonRate)]))}
            style={{ marginBottom: 10, padding: '5px 10px', fontSize: 12 }}>
            Exportar CSV
          </button>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Fila', 'Total', 'Atendidas', 'Abandonadas', 'Taxa Abandono'].map((h) => <th key={h} style={TH}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={5} style={{ ...TD, color: 'var(--color-text-secondary)', textAlign: 'center' }}>Sem dados</td></tr>}
                {rows.map((r, i) => (
                  <tr key={r.queue} style={i % 2 === 1 ? TR_ODD : {}}>
                    <td style={TD}>{r.queue}</td>
                    <td style={TD}>{r.total}</td>
                    <td style={TD}>{r.answered}</td>
                    <td style={{ ...TD, color: r.abandoned > 0 ? 'var(--color-status-error)' : 'inherit' }}><strong>{r.abandoned}</strong></td>
                    <td style={TD}>{fmtPct(r.abandonRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-relatório: Agentes
// ─────────────────────────────────────────────────────────────────────────────
function TabAgentes() {
  const [filters, setFilters] = useState(defaultFilters);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await getCcReportAgentes({ from: filters.from, to: filters.to, queueName: filters.queueName || undefined });
      setData(res.data || null);
    } catch (e) {
      setErr(e.message || 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const agents = data?.agents || [];

  return (
    <>
      <h3 className="mt-0">CC: Desempenho por Agente</h3>
      <ReportFilters filters={filters} setFilters={setFilters} onLoad={load} loading={loading} errorMsg={err} />
      {data && (
        <>
          <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--color-text-secondary)' }}>
            Agentes: <strong>{agents.length}</strong> | Período: {data.from?.slice(0, 10)} → {data.to?.slice(0, 10)}
          </div>
          <button onClick={() => exportCsv('agentes.csv', ['Agente', 'Atendidas', 'Não atendidas', 'Total', 'Billsec Méd.', 'Billsec Máx.'],
            agents.map((a) => [a.agent, a.answered, a.missed, a.total, fmtDur(a.avgBillsec), fmtDur(a.maxBillsec)]))}
            style={{ marginBottom: 10, padding: '5px 10px', fontSize: 12 }}>
            Exportar CSV
          </button>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Agente (ramal)', 'Atendidas', 'Não atend.', 'Total', 'Billsec Méd.', 'Billsec Máx.'].map((h) => <th key={h} style={TH}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {agents.length === 0 && <tr><td colSpan={6} style={{ ...TD, color: 'var(--color-text-secondary)', textAlign: 'center' }}>Sem dados</td></tr>}
                {agents.map((a, i) => (
                  <tr key={a.agent} style={i % 2 === 1 ? TR_ODD : {}}>
                    <td style={{ ...TD, fontWeight: 600 }}>{a.agent}</td>
                    <td style={TD}>{a.answered}</td>
                    <td style={TD}>{a.missed}</td>
                    <td style={TD}>{a.total}</td>
                    <td style={TD}>{fmtDur(a.avgBillsec)}</td>
                    <td style={TD}>{fmtDur(a.maxBillsec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-relatório: Por Hora
// ─────────────────────────────────────────────────────────────────────────────
function TabPorHora() {
  const [filters, setFilters] = useState(defaultFilters);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await getCcReportPorHora({ from: filters.from, to: filters.to, queueName: filters.queueName || undefined });
      setData(res.data || null);
    } catch (e) {
      setErr(e.message || 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const hours = data?.hours || [];
  const maxTotal = Math.max(1, ...hours.map((h) => h.total));

  return (
    <>
      <h3 className="mt-0">CC: Volume de Chamadas por Hora</h3>
      <ReportFilters filters={filters} setFilters={setFilters} onLoad={load} loading={loading} errorMsg={err} />
      {data && (
        <>
          <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--color-text-secondary)' }}>
            Período: {data.from?.slice(0, 10)} → {data.to?.slice(0, 10)}
          </div>
          <button onClick={() => exportCsv('por-hora.csv', ['Hora', 'Total', 'Atendidas', 'Abandonadas'],
            hours.map((h) => [`${String(h.hour).padStart(2, '0')}:00`, h.total, h.answered, h.abandoned]))}
            style={{ marginBottom: 10, padding: '5px 10px', fontSize: 12 }}>
            Exportar CSV
          </button>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Hora', 'Total', 'Atendidas', 'Abandonadas', 'Distribuição'].map((h) => <th key={h} style={TH}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {hours.map((h, i) => (
                  <tr key={h.hour} style={i % 2 === 1 ? TR_ODD : {}}>
                    <td style={{ ...TD, fontWeight: 600 }}>{String(h.hour).padStart(2, '0')}:00</td>
                    <td style={TD}>{h.total}</td>
                    <td style={TD}>{h.answered}</td>
                    <td style={TD}>{h.abandoned}</td>
                    <td style={{ ...TD, minWidth: 120 }}>
                      <div style={{ display: 'flex', gap: 1 }}>
                        <div style={{ height: 14, width: `${Math.round((h.answered / maxTotal) * 100)}%`, background: 'var(--color-status-success, #22c55e)', minWidth: h.answered > 0 ? 2 : 0 }} />
                        <div style={{ height: 14, width: `${Math.round((h.abandoned / maxTotal) * 100)}%`, background: 'var(--color-status-error, #ef4444)', minWidth: h.abandoned > 0 ? 2 : 0 }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-relatório: Resumo por Campanha
// ─────────────────────────────────────────────────────────────────────────────
function TabResumoCampanha() {
  const [filters, setFilters] = useState(defaultFilters);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await getCcReportResumoCampanha({ from: filters.from, to: filters.to, queueName: filters.queueName || undefined });
      setData(res.data || null);
    } catch (e) {
      setErr(e.message || 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const campaigns = data?.campaigns || [];

  return (
    <>
      <h3 className="mt-0">CC: Resumo por Campanha</h3>
      <ReportFilters filters={filters} setFilters={setFilters} onLoad={load} loading={loading} errorMsg={err} />
      {data && (
        <>
          <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--color-text-secondary)' }}>
            Campanhas: <strong>{campaigns.length}</strong> | Período: {data.from?.slice(0, 10)} → {data.to?.slice(0, 10)}
          </div>
          <button onClick={() => exportCsv('resumo-campanha.csv', ['Campanha', 'Total', 'Atendidas', 'Abandonadas', 'Taxa Abandono', 'Billsec Méd.'],
            campaigns.map((c) => [c.campaign, c.total, c.answered, c.abandoned, fmtPct(c.abandonRate), fmtDur(c.avgBillsec)]))}
            style={{ marginBottom: 10, padding: '5px 10px', fontSize: 12 }}>
            Exportar CSV
          </button>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Campanha', 'Total', 'Atendidas', 'Abandonadas', 'Taxa Abandono', 'Billsec Méd.'].map((h) => <th key={h} style={TH}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {campaigns.length === 0 && <tr><td colSpan={6} style={{ ...TD, color: 'var(--color-text-secondary)', textAlign: 'center' }}>Sem dados</td></tr>}
                {campaigns.map((c, i) => (
                  <tr key={c.campaign} style={i % 2 === 1 ? TR_ODD : {}}>
                    <td style={{ ...TD, fontWeight: 600 }}>{c.campaign || '—'}</td>
                    <td style={TD}>{c.total}</td>
                    <td style={TD}>{c.answered}</td>
                    <td style={TD}>{c.abandoned}</td>
                    <td style={TD}>{fmtPct(c.abandonRate)}</td>
                    <td style={TD}>{fmtDur(c.avgBillsec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-relatório: Pesquisa pós-atendimento
// ─────────────────────────────────────────────────────────────────────────────
function TabPesquisa({ formatDateTime }) {
  const [filters, setFilters] = useState(defaultFilters);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await getCcReportPesquisa({ from: filters.from, to: filters.to, queueName: filters.queueName || undefined });
      setData(res.data || null);
    } catch (e) {
      setErr(e.message || 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const entries = data?.entries || [];

  return (
    <>
      <h3 className="mt-0">CC: Pesquisa Pós-Atendimento</h3>
      <ReportFilters filters={filters} setFilters={setFilters} onLoad={load} loading={loading} errorMsg={err} />
      {data && (
        <>
          <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--color-text-secondary)' }}>
            Registros com avaliação: <strong>{data.totalWithSurvey}</strong>
            {data.avgRating != null && <> | Nota média: <strong>{data.avgRating}</strong></>}
            {' '}| Período: {data.from?.slice(0, 10)} → {data.to?.slice(0, 10)}
          </div>
          {entries.length === 0 && (
            <div style={{ padding: '16px', background: 'var(--color-bg-secondary)', borderRadius: 6, color: 'var(--color-text-secondary)', fontSize: 13 }}>
              Nenhum registro de avaliação encontrado. O relatório de pesquisa depende de ligações com dados de survey no campo <code>userfield</code> (JSON) ou <code>extra.survey</code> do CDR.
            </div>
          )}
          {entries.length > 0 && (
            <>
              <button onClick={() => exportCsv('pesquisa.csv', ['Data', 'Fila', 'Agente', 'Origem', 'Nota', 'Comentário'],
                entries.map((e) => [e.calldate, e.queue, e.agent, e.src, e.rating, e.comment]))}
                style={{ marginBottom: 10, padding: '5px 10px', fontSize: 12 }}>
                Exportar CSV
              </button>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {['Data', 'Fila', 'Agente', 'Origem', 'Nota', 'Comentário'].map((h) => <th key={h} style={TH}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e, i) => (
                      <tr key={e.uniqueid || i} style={i % 2 === 1 ? TR_ODD : {}}>
                        <td style={TD}>{formatDateTime ? formatDateTime(e.calldate) : String(e.calldate || '—')}</td>
                        <td style={TD}>{e.queue || '—'}</td>
                        <td style={TD}>{e.agent || '—'}</td>
                        <td style={TD}>{e.src || '—'}</td>
                        <td style={{ ...TD, fontWeight: 600 }}>{e.rating ?? '—'}</td>
                        <td style={{ ...TD, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.comment || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal — roteador de sub-tabs
// ─────────────────────────────────────────────────────────────────────────────
export function PbxCcReportsTabs({ tab, formatDateTime }) {
  if (tab === 'ccRelAtendidas') return <TabAtendidas />;
  if (tab === 'ccRelAbandonadas') return <TabAbandonadas />;
  if (tab === 'ccRelAgentes') return <TabAgentes />;
  if (tab === 'ccRelHora') return <TabPorHora />;
  if (tab === 'ccRelResumoCampanha') return <TabResumoCampanha />;
  if (tab === 'ccRelPesquisa') return <TabPesquisa formatDateTime={formatDateTime} />;
  return null;
}
