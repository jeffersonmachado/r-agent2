import React from 'react';

export function PlatformGridPagination({
  page = 1,
  totalPages = 1,
  pageSize = 25,
  totalItems = 0,
  pageSizeOptions = [10, 25, 50, 100],
  onPageChange = null,
  onPageSizeChange = null,
}) {
  if (!totalItems) return null;

  return (
    <div className="pg-pagination">
      <div className="pg-pagination__meta">
        Total: <strong>{totalItems}</strong>
      </div>
      <div className="pg-pagination__controls">
        {onPageSizeChange ? (
          <select
            className="pg-pagination__select"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>{option} / pagina</option>
            ))}
          </select>
        ) : null}
        <button type="button" className="pg-pagination__button" onClick={() => onPageChange?.(1)} disabled={page <= 1}>«</button>
        <button type="button" className="pg-pagination__button" onClick={() => onPageChange?.(page - 1)} disabled={page <= 1}>‹</button>
        <span className="pg-pagination__page">{page} / {totalPages}</span>
        <button type="button" className="pg-pagination__button" onClick={() => onPageChange?.(page + 1)} disabled={page >= totalPages}>›</button>
        <button type="button" className="pg-pagination__button" onClick={() => onPageChange?.(totalPages)} disabled={page >= totalPages}>»</button>
      </div>
    </div>
  );
}
