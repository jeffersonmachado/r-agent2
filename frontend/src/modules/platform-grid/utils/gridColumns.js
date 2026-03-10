export function getGridCellValue(column, row) {
  if (!column) return undefined;
  if (typeof column.sortValue === 'function') return column.sortValue(row);
  if (typeof column.accessor === 'function') return column.accessor(row);
  return row?.[column.id];
}

export function toComparableGridValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.toLowerCase();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}
