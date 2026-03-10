export function mapGridStateToQuery({
  searchTerm = '',
  filterValues = {},
  sort = null,
  page = 1,
  pageSize = 25,
}) {
  return {
    q: searchTerm || undefined,
    filters: filterValues,
    sortBy: sort?.columnId,
    sortDir: sort?.direction,
    page,
    pageSize,
    limit: pageSize,
    offset: Math.max(0, (Math.max(1, page) - 1) * pageSize),
  };
}
