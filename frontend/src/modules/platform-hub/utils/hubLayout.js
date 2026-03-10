export function getHubGridClassName({
  columns = 4,
  gapClassName = 'gap-6',
}) {
  const columnClassName = columns <= 2
    ? 'grid-cols-1 md:grid-cols-2'
    : columns === 3
      ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
      : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

  return `grid ${columnClassName} ${gapClassName}`.trim();
}
