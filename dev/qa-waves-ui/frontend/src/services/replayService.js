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

export const replayService = {
  async listReplays(filters) {
    const qs = toQueryString(filters);
    const path = qs ? `/api/replays?${qs}` : '/api/replays';
    const data = await httpClient.get(path);
    return {
      replays: data.replays || [],
      pagination: data.pagination || {
        total: data.replays?.length || 0,
        page: 1,
        pageSize: data.replays?.length || 0,
        totalPages: 1
      }
    };
  },
  async getReplay(replayId) {
    return httpClient.get(`/api/replays/${replayId}`);
  },
  async reexecuteReplay(replayId) {
    return httpClient.post(`/api/replays/${replayId}/reexecute`, {});
  }
};
