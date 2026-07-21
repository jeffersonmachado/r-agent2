import { httpClient } from './httpClient';

export const businessRulesService = {
  async fetchState() {
    return httpClient.get('/api/business/rules');
  },

  async runPipeline(input) {
    return httpClient.post('/api/business/rules/pipeline', input);
  },

  async fetchJourneys() {
    return httpClient.get('/api/business/journeys');
  },

  async fetchJourney(verticalId) {
    return httpClient.get(`/api/business/journeys/${verticalId}`);
  },

  async fetchGaps(filters = {}) {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.severity) params.set('severity', filters.severity);
    const qs = params.toString();
    const path = qs ? `/api/business/gaps?${qs}` : '/api/business/gaps';
    return httpClient.get(path);
  },

  async updateGap(gapId, updates) {
    return fetch(`/api/business/gaps/${gapId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    }).then((res) => {
      if (!res.ok) throw new Error('Falha ao atualizar gap');
      return res.json();
    });
  }
};
