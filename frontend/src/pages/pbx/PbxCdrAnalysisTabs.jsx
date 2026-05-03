import React, { useState, useCallback, useMemo } from 'react';
import { listCdr } from '../../api/pbx';

// ─── Estilos compartilhados ────────────────────────────────────────────────

const PANEL = 'bg-bg-primary border border-border-default rounded-xl p-6 space-y-4';
const LABEL = 'block text-sm font-medium text-text-secondary mb-1';
const INPUT =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all';
const BTN =
  'px-4 py-2 bg-accent-primary text-white rounded-lg hover:bg-accent-hover transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_GHOST =
  'px-4 py-2 border border-border-default text-text-primary rounded-lg hover:bg-bg-secondary transition-colors text-sm';

const ANALYSIS_TABS = [
  { key: 'cdrResumo', label: 'Resumo' },
  { key: 'cdrHora', label: 'Por Hora' },
  { key: 'cdrOrigem', label: 'Por Origem' },
  { key: 'cdrDestino', label: 'Por Destino' },
];

// ─── Utilitários ─────────────────────────────────────────────────────────────

function defaultDates() {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

function fmtDur(secs) {
  const s = Number(secs) || 0;
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}

function exportCsv(headers, rows, filename) {
  const lines = [
    headers.join(','),
    ...rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function useCdrFetch() {
  const d = defaultDates();
  const [dateFrom, setDateFrom] = useState(d.from);
  const [dateTo, setDateTo] = useState(d.to);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listCdr({ dateFrom, dateTo, limit: 5000 });
      const data = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      setRows(data);
    } catch (e) {
      setError(String(e?.message || 'Erro ao carregar CDR'));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  return { dateFrom, setDateFrom, dateTo, setDateTo, rows, loading, error, fetch };
}

function DateFilters({ dateFrom, setDateFrom, dateTo, setDateTo, loading, onFetch, hasRows, onExport }) {
  return (
    <div className="flex flex-wrap gap-4 items-end">
      <div>
        <label className={LABEL}>De</label>
        <input type="date" className={INPUT + ' w-40'} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
      </div>
      <div>
        <label className={LABEL}>Até</label>
        <input type="date" className={INPUT + ' w-40'} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </div>
      <button className={BTN} onClick={onFetch} disabled={loading}>
        {loading ? 'Buscando…' : 'Gerar'}
      </button>
      {hasRows && (
        <button className={BTN_GHOST} onClick={onExport}>
          Exportar CSV
        </button>
      )}
    </div>
  );
}

function EmptyState({ loading, rows, emptyMsg = 'Nenhum dado encontrado.' }) {
  if (loading) return <p className="text-sm text-text-secondary">Carregando…</p>;
  if (rows === null) return <p className="text-sm text-text-secondary">Selecione o período e clique em Gerar.</p>;
  if (rows.length === 0) return <p className="text-sm text-text-secondary">{emptyMsg}</p>;
  return null;
}

function SortableTh({ children, sortKey, sort, setSort }) {
  const active = sort?.key === sortKey;
  return (
    <th
      className="pb-2 pr-4 text-left text-text-secondary cursor-pointer select-none hover:text-text-primary transition-colors"
      onClick={() =>
        setSort(active ? { key: sortKey, dir: sort.dir === 'desc' ? 'asc' : 'desc' } : { key: sortKey, dir: 'desc' })
      }
    >
      {children} {active ? (sort.dir === 'desc' ? '↓' : '↑') : '↕'}
    </th>
  );
}

// ─── Aba: Resumo ──────────────────────────────────────────────────────────────

function ResumoTab() {
  const { dateFrom, setDateFrom, dateTo, setDateTo, rows, loading, error, fetch } = useCdrFetch();
  const [sort, setSort] = useState({ key: 'total', dir: 'desc' });

  const aggregated = useMemo(() => {
    if (!rows) return null;
    const map = {};
    for (const r of rows) {
      const k = `${r.src || '?'}→${r.dst || '?'}`;
      if (!map[k]) map[k] = { origem: r.src || '?', destino: r.dst || '?', total: 0, atendidas: 0, durTotal: 0 };
      map[k].total++;
      if (r.disposition === 'ANSWERED') map[k].atendidas++;
      map[k].durTotal += Number(r.billsec || r.duration || 0);
    }
    let arr = Object.values(map);
    arr = arr.sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      return sort.dir === 'desc' ? vb - va : va - vb;
    });
    return arr;
  }, [rows, sort]);

  const onExport = useCallback(() => {
    if (!aggregated) return;
    exportCsv(
      ['Origem', 'Destino', 'Total', 'Atendidas', 'Não Atendidas', 'Duração Total'],
      aggregated.map((r) => [r.origem, r.destino, r.total, r.atendidas, r.total - r.atendidas, fmtDur(r.durTotal)]),
      `cdr_resumo_${dateFrom}_${dateTo}.csv`,
    );
  }, [aggregated, dateFrom, dateTo]);

  return (
    <div className="space-y-6">
      <div className={PANEL}>
        <h2 className="text-lg font-semibold text-text-primary">Resumo de Chamadas</h2>
        <p className="text-sm text-text-secondary">Totais agrupados por par Origem → Destino no período.</p>
        <DateFilters {...{ dateFrom, setDateFrom, dateTo, setDateTo, loading, onFetch: fetch, hasRows: !!aggregated?.length, onExport }} />
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
      {(rows !== null || loading) && (
        <div className={PANEL}>
          <EmptyState loading={loading} rows={aggregated} />
          {aggregated && aggregated.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-default">
                    <th className="pb-2 pr-4 text-left text-text-secondary">Origem</th>
                    <th className="pb-2 pr-4 text-left text-text-secondary">Destino</th>
                    <SortableTh sortKey="total" sort={sort} setSort={setSort}>Total</SortableTh>
                    <SortableTh sortKey="atendidas" sort={sort} setSort={setSort}>Atendidas</SortableTh>
                    <th className="pb-2 pr-4 text-left text-text-secondary">Não Atend.</th>
                    <SortableTh sortKey="durTotal" sort={sort} setSort={setSort}>Duração Total</SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {aggregated.slice(0, 200).map((r, i) => (
                    <tr key={i} className="border-b border-border-default/50 hover:bg-bg-secondary/50">
                      <td className="py-1.5 pr-4 font-mono text-xs">{r.origem}</td>
                      <td className="py-1.5 pr-4 font-mono text-xs">{r.destino}</td>
                      <td className="py-1.5 pr-4 font-semibold">{r.total}</td>
                      <td className="py-1.5 pr-4 text-green-500">{r.atendidas}</td>
                      <td className="py-1.5 pr-4 text-red-400">{r.total - r.atendidas}</td>
                      <td className="py-1.5 text-text-secondary">{fmtDur(r.durTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-text-secondary">{aggregated.length} par(es) — {rows.length} chamada(s) total</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Aba: Por Hora ────────────────────────────────────────────────────────────

function HoraTab() {
  const { dateFrom, setDateFrom, dateTo, setDateTo, rows, loading, error, fetch } = useCdrFetch();

  const aggregated = useMemo(() => {
    if (!rows) return null;
    const hours = Array.from({ length: 24 }, (_, h) => ({ hora: h, total: 0, atendidas: 0, durTotal: 0 }));
    for (const r of rows) {
      const h = new Date(r.calldate || 0).getHours();
      if (h >= 0 && h < 24) {
        hours[h].total++;
        if (r.disposition === 'ANSWERED') hours[h].atendidas++;
        hours[h].durTotal += Number(r.billsec || r.duration || 0);
      }
    }
    return hours;
  }, [rows]);

  const maxTotal = useMemo(() => Math.max(...(aggregated?.map((h) => h.total) || [1]), 1), [aggregated]);

  const onExport = useCallback(() => {
    if (!aggregated) return;
    exportCsv(
      ['Hora', 'Total', 'Atendidas', 'Não Atendidas', 'Duração Total'],
      aggregated.map((r) => [`${String(r.hora).padStart(2, '0')}:00`, r.total, r.atendidas, r.total - r.atendidas, fmtDur(r.durTotal)]),
      `cdr_por_hora_${dateFrom}_${dateTo}.csv`,
    );
  }, [aggregated, dateFrom, dateTo]);

  return (
    <div className="space-y-6">
      <div className={PANEL}>
        <h2 className="text-lg font-semibold text-text-primary">Distribuição por Hora</h2>
        <p className="text-sm text-text-secondary">Volume de chamadas por hora do dia no período.</p>
        <DateFilters {...{ dateFrom, setDateFrom, dateTo, setDateTo, loading, onFetch: fetch, hasRows: !!aggregated?.some((h) => h.total > 0), onExport }} />
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
      {(rows !== null || loading) && (
        <div className={PANEL}>
          <EmptyState loading={loading} rows={rows} />
          {aggregated && rows && rows.length > 0 && (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <div className="min-w-[500px] flex gap-1 items-end h-32">
                  {aggregated.map((h) => (
                    <div key={h.hora} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t bg-accent-primary/70 hover:bg-accent-primary transition-colors"
                        style={{ height: `${Math.round((h.total / maxTotal) * 100)}%`, minHeight: h.total > 0 ? 2 : 0 }}
                        title={`${String(h.hora).padStart(2, '0')}:00 — ${h.total} chamada(s)`}
                      />
                      <span className="text-xs text-text-secondary">{String(h.hora).padStart(2, '0')}</span>
                    </div>
                  ))}
                </div>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-default">
                    <th className="pb-2 pr-4 text-left text-text-secondary">Hora</th>
                    <th className="pb-2 pr-4 text-left text-text-secondary">Total</th>
                    <th className="pb-2 pr-4 text-left text-text-secondary">Atendidas</th>
                    <th className="pb-2 pr-4 text-left text-text-secondary">Não Atend.</th>
                    <th className="pb-2 text-left text-text-secondary">Duração Total</th>
                  </tr>
                </thead>
                <tbody>
                  {aggregated.filter((h) => h.total > 0).map((h) => (
                    <tr key={h.hora} className="border-b border-border-default/50 hover:bg-bg-secondary/50">
                      <td className="py-1.5 pr-4 font-mono">{String(h.hora).padStart(2, '0')}:00</td>
                      <td className="py-1.5 pr-4 font-semibold">{h.total}</td>
                      <td className="py-1.5 pr-4 text-green-500">{h.atendidas}</td>
                      <td className="py-1.5 pr-4 text-red-400">{h.total - h.atendidas}</td>
                      <td className="py-1.5 text-text-secondary">{fmtDur(h.durTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-text-secondary">{rows.length} chamada(s) no período</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Aba: Por Origem ──────────────────────────────────────────────────────────

function OrigemTab() {
  const { dateFrom, setDateFrom, dateTo, setDateTo, rows, loading, error, fetch } = useCdrFetch();
  const [sort, setSort] = useState({ key: 'total', dir: 'desc' });
  const [search, setSearch] = useState('');

  const aggregated = useMemo(() => {
    if (!rows) return null;
    const map = {};
    for (const r of rows) {
      const k = r.src || '?';
      if (!map[k]) map[k] = { origem: k, total: 0, atendidas: 0, durTotal: 0, destinos: new Set() };
      map[k].total++;
      if (r.disposition === 'ANSWERED') map[k].atendidas++;
      map[k].durTotal += Number(r.billsec || r.duration || 0);
      if (r.dst) map[k].destinos.add(r.dst);
    }
    let arr = Object.values(map).map((r) => ({ ...r, destinos: r.destinos.size }));
    if (search) arr = arr.filter((r) => r.origem.includes(search));
    arr.sort((a, b) => sort.dir === 'desc' ? b[sort.key] - a[sort.key] : a[sort.key] - b[sort.key]);
    return arr;
  }, [rows, sort, search]);

  const onExport = useCallback(() => {
    if (!aggregated) return;
    exportCsv(
      ['Origem', 'Total', 'Atendidas', 'Não Atendidas', 'Destinos Únicos', 'Duração Total'],
      aggregated.map((r) => [r.origem, r.total, r.atendidas, r.total - r.atendidas, r.destinos, fmtDur(r.durTotal)]),
      `cdr_por_origem_${dateFrom}_${dateTo}.csv`,
    );
  }, [aggregated, dateFrom, dateTo]);

  return (
    <div className="space-y-6">
      <div className={PANEL}>
        <h2 className="text-lg font-semibold text-text-primary">Chamadas por Origem</h2>
        <p className="text-sm text-text-secondary">Totais agrupados por número/ramal de origem.</p>
        <DateFilters {...{ dateFrom, setDateFrom, dateTo, setDateTo, loading, onFetch: fetch, hasRows: !!aggregated?.length, onExport }} />
        {rows !== null && (
          <input className={INPUT + ' max-w-xs'} placeholder="Filtrar origem…" value={search} onChange={(e) => setSearch(e.target.value)} />
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
      {(rows !== null || loading) && (
        <div className={PANEL}>
          <EmptyState loading={loading} rows={aggregated} />
          {aggregated && aggregated.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-default">
                    <th className="pb-2 pr-4 text-left text-text-secondary">Origem</th>
                    <SortableTh sortKey="total" sort={sort} setSort={setSort}>Total</SortableTh>
                    <SortableTh sortKey="atendidas" sort={sort} setSort={setSort}>Atendidas</SortableTh>
                    <th className="pb-2 pr-4 text-left text-text-secondary">Não Atend.</th>
                    <SortableTh sortKey="destinos" sort={sort} setSort={setSort}>Destinos únicos</SortableTh>
                    <SortableTh sortKey="durTotal" sort={sort} setSort={setSort}>Duração Total</SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {aggregated.slice(0, 200).map((r, i) => (
                    <tr key={i} className="border-b border-border-default/50 hover:bg-bg-secondary/50">
                      <td className="py-1.5 pr-4 font-mono text-xs">{r.origem}</td>
                      <td className="py-1.5 pr-4 font-semibold">{r.total}</td>
                      <td className="py-1.5 pr-4 text-green-500">{r.atendidas}</td>
                      <td className="py-1.5 pr-4 text-red-400">{r.total - r.atendidas}</td>
                      <td className="py-1.5 pr-4 text-text-secondary">{r.destinos}</td>
                      <td className="py-1.5 text-text-secondary">{fmtDur(r.durTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-text-secondary">{aggregated.length} origem(ns)</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Aba: Por Destino ─────────────────────────────────────────────────────────

function DestinoTab() {
  const { dateFrom, setDateFrom, dateTo, setDateTo, rows, loading, error, fetch } = useCdrFetch();
  const [sort, setSort] = useState({ key: 'total', dir: 'desc' });
  const [search, setSearch] = useState('');

  const aggregated = useMemo(() => {
    if (!rows) return null;
    const map = {};
    for (const r of rows) {
      const k = r.dst || '?';
      if (!map[k]) map[k] = { destino: k, total: 0, atendidas: 0, durTotal: 0, origens: new Set() };
      map[k].total++;
      if (r.disposition === 'ANSWERED') map[k].atendidas++;
      map[k].durTotal += Number(r.billsec || r.duration || 0);
      if (r.src) map[k].origens.add(r.src);
    }
    let arr = Object.values(map).map((r) => ({ ...r, origens: r.origens.size }));
    if (search) arr = arr.filter((r) => r.destino.includes(search));
    arr.sort((a, b) => sort.dir === 'desc' ? b[sort.key] - a[sort.key] : a[sort.key] - b[sort.key]);
    return arr;
  }, [rows, sort, search]);

  const onExport = useCallback(() => {
    if (!aggregated) return;
    exportCsv(
      ['Destino', 'Total', 'Atendidas', 'Não Atendidas', 'Origens Únicas', 'Duração Total'],
      aggregated.map((r) => [r.destino, r.total, r.atendidas, r.total - r.atendidas, r.origens, fmtDur(r.durTotal)]),
      `cdr_por_destino_${dateFrom}_${dateTo}.csv`,
    );
  }, [aggregated, dateFrom, dateTo]);

  return (
    <div className="space-y-6">
      <div className={PANEL}>
        <h2 className="text-lg font-semibold text-text-primary">Chamadas por Destino</h2>
        <p className="text-sm text-text-secondary">Totais agrupados por número/ramal de destino.</p>
        <DateFilters {...{ dateFrom, setDateFrom, dateTo, setDateTo, loading, onFetch: fetch, hasRows: !!aggregated?.length, onExport }} />
        {rows !== null && (
          <input className={INPUT + ' max-w-xs'} placeholder="Filtrar destino…" value={search} onChange={(e) => setSearch(e.target.value)} />
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
      {(rows !== null || loading) && (
        <div className={PANEL}>
          <EmptyState loading={loading} rows={aggregated} />
          {aggregated && aggregated.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-default">
                    <th className="pb-2 pr-4 text-left text-text-secondary">Destino</th>
                    <SortableTh sortKey="total" sort={sort} setSort={setSort}>Total</SortableTh>
                    <SortableTh sortKey="atendidas" sort={sort} setSort={setSort}>Atendidas</SortableTh>
                    <th className="pb-2 pr-4 text-left text-text-secondary">Não Atend.</th>
                    <SortableTh sortKey="origens" sort={sort} setSort={setSort}>Origens únicas</SortableTh>
                    <SortableTh sortKey="durTotal" sort={sort} setSort={setSort}>Duração Total</SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {aggregated.slice(0, 200).map((r, i) => (
                    <tr key={i} className="border-b border-border-default/50 hover:bg-bg-secondary/50">
                      <td className="py-1.5 pr-4 font-mono text-xs">{r.destino}</td>
                      <td className="py-1.5 pr-4 font-semibold">{r.total}</td>
                      <td className="py-1.5 pr-4 text-green-500">{r.atendidas}</td>
                      <td className="py-1.5 pr-4 text-red-400">{r.total - r.atendidas}</td>
                      <td className="py-1.5 pr-4 text-text-secondary">{r.origens}</td>
                      <td className="py-1.5 text-text-secondary">{fmtDur(r.durTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-text-secondary">{aggregated.length} destino(s)</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Export principal ─────────────────────────────────────────────────────────

export function PbxCdrAnalysisTabs({ tab }) {
  const active = ANALYSIS_TABS.some((t) => t.key === tab);
  if (!active) return null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-border-default pb-2 flex-wrap">
        {ANALYSIS_TABS.map((t) => (
          <span
            key={t.key}
            className={
              tab === t.key
                ? 'px-3 py-1 text-sm rounded-t font-medium text-accent-primary border-b-2 border-accent-primary'
                : 'px-3 py-1 text-sm rounded-t text-text-secondary'
            }
          >
            {t.label}
          </span>
        ))}
      </div>
      {tab === 'cdrResumo' && <ResumoTab />}
      {tab === 'cdrHora' && <HoraTab />}
      {tab === 'cdrOrigem' && <OrigemTab />}
      {tab === 'cdrDestino' && <DestinoTab />}
    </div>
  );
}
