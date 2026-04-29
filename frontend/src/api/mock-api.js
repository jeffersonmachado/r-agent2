/**
 * Mock API responses for development when backend is unavailable
 * Remove or disable this file when backend API is running
 */

import mockData from './mock-data.json';

const MOCK_ENABLED = localStorage.getItem('USE_MOCK_API') === 'true' || 
                      import.meta.env.REACT_APP_MOCK_API === 'true' ||
                      import.meta.env.DEV === true;

export function getMockProject(projectId) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        ok: true,
        project: mockData.projects[0]
      });
    }, 300);
  });
}

export function getMockProjectLists(projectId) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        ok: true,
        lists: mockData.lists
      });
    }, 300);
  });
}

export function getMockProjectItems(projectId) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        ok: true,
        items: mockData.items
      });
    }, 300);
  });
}

export function getMockProjectDashboard(projectId) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        ok: true,
        dashboard: mockData.dashboard
      });
    }, 300);
  });
}

export function getMockProjectTimeline(projectId) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        ok: true,
        ...mockData.timeline
      });
    }, 300);
  });
}

/**
 * Wraps API call with mock fallback
 * @param {Promise} apiCall - The actual API call
 * @param {Function} mockFn - Function that returns mock data
 * @returns {Promise}
 */
export async function withMockFallback(apiCall, mockFn) {
  if (!MOCK_ENABLED) {
    return apiCall;
  }

  try {
    const result = await apiCall;
    if (result && !result.error) {
      return result;
    }
    console.warn('API returned error, using mock data:', result);
    return mockFn();
  } catch (error) {
    console.warn('API call failed, using mock data:', error.message);
    return mockFn();
  }
}

export const enableMockAPI = () => {
  // Set in localStorage or environment
  localStorage.setItem('USE_MOCK_API', 'true');
  window.location.reload();
};

export const disableMockAPI = () => {
  localStorage.removeItem('USE_MOCK_API');
  window.location.reload();
};

export const isMockAPIEnabled = () => {
  return localStorage.getItem('USE_MOCK_API') === 'true' || MOCK_ENABLED;
};
