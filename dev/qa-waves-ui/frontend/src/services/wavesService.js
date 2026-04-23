import { httpClient } from './httpClient';

function toQueryString(filters) {
  const query = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      query.set(key, String(value));
    }
  });
  return query.toString();
}

export const wavesService = {
  async listWaves(filters) {
    const qs = toQueryString(filters);
    const path = qs ? `/api/waves?${qs}` : '/api/waves';
    const data = await httpClient.get(path);
    return {
      waves: data.waves || [],
      pagination: data.pagination || {
        total: data.waves?.length || 0,
        page: 1,
        pageSize: data.waves?.length || 0,
        totalPages: 1
      }
    };
  }
};
