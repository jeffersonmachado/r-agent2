import { httpClient } from './httpClient';

export const executionService = {
  async runSelection(payload) {
    return httpClient.post('/api/executions', payload);
  },
  async getExecution(executionId) {
    return httpClient.get(`/api/executions/${executionId}`);
  },
  async listExecutions() {
    const data = await httpClient.get('/api/executions');
    return data.executions || [];
  }
};
