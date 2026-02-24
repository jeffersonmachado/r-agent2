import { useState, useCallback } from 'react';

export function useCrmApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const getAuthHeader = useCallback(() => {
    const token = localStorage.getItem('auth_token');
    return {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }, []);

  const request = useCallback(
    async (endpoint, options = {}) => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(endpoint, {
          ...options,
          headers: {
            ...getAuthHeader(),
            ...options.headers,
          },
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.message || `HTTP ${response.status}`);
        }

        return data;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [getAuthHeader]
  );

  // Accounts
  const listAccounts = useCallback(
    (limit = 20, offset = 0) =>
      request(`/api/crm/accounts?limit=${limit}&offset=${offset}`),
    [request]
  );

  const getAccount = useCallback((id) => request(`/api/crm/accounts/${id}`), [request]);

  const upsertAccount = useCallback(
    (data) =>
      request('/api/crm/accounts', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    [request]
  );

  const deleteAccount = useCallback(
    (id) =>
      request(`/api/crm/accounts/${id}`, { method: 'DELETE' }),
    [request]
  );

  // Contacts
  const listContacts = useCallback(
    (limit = 20, offset = 0) =>
      request(`/api/crm/contacts?limit=${limit}&offset=${offset}`),
    [request]
  );

  const getContact = useCallback((id) => request(`/api/crm/contacts/${id}`), [request]);

  const upsertContact = useCallback(
    (data) =>
      request('/api/crm/contacts', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    [request]
  );

  const deleteContact = useCallback(
    (id) =>
      request(`/api/crm/contacts/${id}`, { method: 'DELETE' }),
    [request]
  );

  // Leads
  const listLeads = useCallback(
    (limit = 20, offset = 0) =>
      request(`/api/crm/leads?limit=${limit}&offset=${offset}`),
    [request]
  );

  const getLead = useCallback((id) => request(`/api/crm/leads/${id}`), [request]);

  const upsertLead = useCallback(
    (data) =>
      request('/api/crm/leads', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    [request]
  );

  const deleteLead = useCallback(
    (id) =>
      request(`/api/crm/leads/${id}`, { method: 'DELETE' }),
    [request]
  );

  // Pipelines
  const listPipelines = useCallback(
    (limit = 20, offset = 0) =>
      request(`/api/crm/pipelines?limit=${limit}&offset=${offset}`),
    [request]
  );

  const getPipeline = useCallback((id) => request(`/api/crm/pipelines/${id}`), [request]);

  const upsertPipeline = useCallback(
    (data) =>
      request('/api/crm/pipelines', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    [request]
  );

  const deletePipeline = useCallback(
    (id) =>
      request(`/api/crm/pipelines/${id}`, { method: 'DELETE' }),
    [request]
  );

  // Opportunities
  const listOpportunities = useCallback(
    (limit = 20, offset = 0) =>
      request(`/api/crm/opportunities?limit=${limit}&offset=${offset}`),
    [request]
  );

  const getOpportunity = useCallback(
    (id) => request(`/api/crm/opportunities/${id}`),
    [request]
  );

  const upsertOpportunity = useCallback(
    (data) =>
      request('/api/crm/opportunities', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    [request]
  );

  const deleteOpportunity = useCallback(
    (id) =>
      request(`/api/crm/opportunities/${id}`, { method: 'DELETE' }),
    [request]
  );

  const moveOpportunityStage = useCallback(
    (id, toStageId) =>
      request(`/api/crm/opportunities/${id}/move`, {
        method: 'POST',
        body: JSON.stringify({ toStageId }),
      }),
    [request]
  );

  // Activities
  const listActivities = useCallback(
    (limit = 20, offset = 0) =>
      request(`/api/crm/activities?limit=${limit}&offset=${offset}`),
    [request]
  );

  const logActivity = useCallback(
    (data) =>
      request('/api/crm/activities', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    [request]
  );

  const upsertActivity = useCallback(
    (data) =>
      request('/api/crm/activities', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    [request]
  );

  // Timeline
  const getTimeline = useCallback(
    (subjectType, subjectId, limit = 50) =>
      request(`/api/crm/timeline?subjectType=${subjectType}&subjectId=${subjectId}&limit=${limit}`),
    [request]
  );

  return {
    loading,
    error,
    listAccounts,
    getAccount,
    upsertAccount,
    deleteAccount,
    listContacts,
    getContact,
    upsertContact,
    deleteContact,
    listLeads,
    getLead,
    upsertLead,
    deleteLead,
    listPipelines,
    getPipeline,
    upsertPipeline,
    deletePipeline,
    listOpportunities,
    getOpportunity,
    upsertOpportunity,
    deleteOpportunity,
    moveOpportunityStage,
    listActivities,
    logActivity,
    upsertActivity,
    getTimeline,
  };
}
