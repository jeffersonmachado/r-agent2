export function getDashboardSectionClassName({
  columns = 1,
  gapClassName = 'gap-4',
}) {
  const columnClassName = columns === 1
    ? 'grid-cols-1'
    : columns === 2
      ? 'grid-cols-1 md:grid-cols-2'
      : columns === 3
        ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
        : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4';

  return `grid ${columnClassName} ${gapClassName}`.trim();
}
