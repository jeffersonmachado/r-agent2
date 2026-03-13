import React, { useMemo, useState } from 'react';
import './DataGrid.css';

function defaultGetRowKey(row, index) {
  return row && (row.id != null || row.id === 0) ? String(row.id) : String(index);
}

function getText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

export function DataGrid({
  columns,
  rows,
  getRowKey = defaultGetRowKey,
  emptyText = 'Sem itens.',
  dense = true,
  defaultSort = null, // { id, dir: 'asc'|'desc' }
  pageSizes = [10, 25, 50, 100],
  defaultPageSize = 25,
  onRowClick = null,
}) {
  const cols = Array.isArray(columns) ? columns : [];
  const allRows = Array.isArray(rows) ? rows : [];

  const [sort, setSort] = useState(defaultSort);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [page, setPage] = useState(1);

  const sortedRows = useMemo(() => {
    if (!sort || !sort.id) return allRows;
    const col = cols.find((c) => c.id === sort.id);
    if (!col || col.sortable === false) return allRows;
    const dir = sort.dir === 'desc' ? -1 : 1;
    const sortValue = col.sortValue || ((r) => (col.accessor ? col.accessor(r) : r?.[col.id]));

    const withIndex = allRows.map((r, i) => ({ r, i }));
    withIndex.sort((a, b) => {
      const av = sortValue(a.r);
      const bv = sortValue(b.r);
      const at = getText(av).toLowerCase();
      const bt = getText(bv).toLowerCase();
      if (at < bt) return -1 * dir;
      if (at > bt) return 1 * dir;
      return a.i - b.i;
    });
    return withIndex.map((x) => x.r);
  }, [allRows, cols, sort]);

  const total = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const pageSafe = Math.min(Math.max(1, page), totalPages);
  const pageStart = (pageSafe - 1) * pageSize;
  const pageRows = sortedRows.slice(pageStart, pageStart + pageSize);

  function toggleSort(col) {
    if (!col || col.sortable === false) return;
    const id = col.id;
    setPage(1);
    setSort((prev) => {
      if (!prev || prev.id !== id) return { id, dir: 'asc' };
      if (prev.dir === 'asc') return { id, dir: 'desc' };
      return null;
    });
  }

  const showPager = total > pageSize;

  return (
    <div className={`dg ${dense ? 'dg--dense' : ''}`}>
      {showPager ? (
        <div className="dg-toolbar">
          <div className="dg-toolbar__meta">
            Itens: <strong>{total}</strong>
          </div>
          <div className="dg-toolbar__controls">
            <label className="dg-toolbar__label">
              por página:
              <select
                className="dg-select"
                value={pageSize}
                onChange={(e) => { setPage(1); setPageSize(Number(e.target.value)); }}
              >
                {pageSizes.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <button className="dg-btn" onClick={() => setPage(1)} disabled={pageSafe <= 1}>«</button>
            <button className="dg-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageSafe <= 1}>‹</button>
            <span className="dg-toolbar__page">
              {pageSafe} / {totalPages}
            </span>
            <button className="dg-btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pageSafe >= totalPages}>›</button>
            <button className="dg-btn" onClick={() => setPage(totalPages)} disabled={pageSafe >= totalPages}>»</button>
          </div>
        </div>
      ) : null}

      <div className="dg-tableWrap">
        <table className="dg-table">
          <thead>
            <tr>
              {cols.map((c) => {
                const isSorted = sort && sort.id === c.id;
                const sortDir = isSorted ? sort.dir : null;
                const canSort = c.sortable === false ? false : true;
                return (
                  <th
                    key={c.id}
                    style={c.width ? { width: c.width } : undefined}
                    className={canSort ? 'dg-th dg-th--sortable' : 'dg-th'}
                    onClick={() => (canSort ? toggleSort(c) : null)}
                    title={canSort ? 'Ordenar' : undefined}
                  >
                    <span className="dg-th__inner">
                      <span>{c.header || c.id}</span>
                      {sortDir ? <span className="dg-th__sort">{sortDir === 'asc' ? '▲' : '▼'}</span> : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, index) => (
              <tr
                key={getRowKey(row, index)}
                className={onRowClick ? 'dg-tr dg-tr--clickable' : 'dg-tr'}
                onClick={() => (onRowClick ? onRowClick(row) : null)}
              >
                {cols.map((c) => (
                  <td key={c.id} className="dg-td">
                    {c.render ? c.render(row) : getText(c.accessor ? c.accessor(row) : row?.[c.id]) || '—'}
                  </td>
                ))}
              </tr>
            ))}
            {!pageRows.length ? (
              <tr>
                <td className="dg-empty" colSpan={Math.max(1, cols.length)}>
                  {emptyText}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

