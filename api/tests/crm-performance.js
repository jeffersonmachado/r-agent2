'use strict';

/**
 * Performance Load Testing Scripts
 * k6-compatible scripts for stress testing and performance validation
 */

/**
 * CRM API Performance Test
 * Tests core CRM endpoints under load
 * Run with: k6 run api/tests/crm-performance.js
 */

// eslint-disable-next-line no-undef
const http = require('k6/http');
// eslint-disable-next-line no-undef
const { check, sleep } = require('k6');

// eslint-disable-next-line no-undef
export const options = {
  vus: 10, // Virtual users
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.1'], // 90% success
  },
};

const BASE_URL = 'http://localhost:3000/api/crm';
const TENANT_KEY = 'test-tenant';
const AUTH_TOKEN = 'Bearer test-token-123';

// eslint-disable-next-line no-undef
export default function () {
  const headers = {
    'Authorization': AUTH_TOKEN,
    'X-Tenant-Key': TENANT_KEY,
    'Content-Type': 'application/json',
  };

  // Test 1: List accounts
  const accountsRes = http.get(`${BASE_URL}/accounts`, { headers });
  check(accountsRes, {
    'list accounts status is 200': (r) => r.status === 200,
    'list accounts response time < 500ms': (r) => r.timings.duration < 500,
    'list accounts returns data': (r) => JSON.parse(r.body).ok === true,
  });
  sleep(1);

  // Test 2: Create account
  const createAccountPayload = JSON.stringify({
    name: `Test Account ${Date.now()}`,
    ownerUserId: 'user-123',
    status: 'active',
  });

  const createRes = http.post(`${BASE_URL}/accounts`, createAccountPayload, { headers });
  check(createRes, {
    'create account status is 201': (r) => r.status === 201,
    'create account response time < 500ms': (r) => r.timings.duration < 500,
    'create account returns ID': (r) => JSON.parse(r.body).account?.id !== undefined,
  });
  sleep(1);

  // Test 3: List contacts
  const contactsRes = http.get(`${BASE_URL}/contacts`, { headers });
  check(contactsRes, {
    'list contacts status is 200': (r) => r.status === 200,
    'list contacts response time < 500ms': (r) => r.timings.duration < 500,
  });
  sleep(1);

  // Test 4: List leads
  const leadsRes = http.get(`${BASE_URL}/leads`, { headers });
  check(leadsRes, {
    'list leads status is 200': (r) => r.status === 200,
    'list leads response time < 500ms': (r) => r.timings.duration < 500,
  });
  sleep(1);

  // Test 5: List opportunities
  const oppsRes = http.get(`${BASE_URL}/opportunities`, { headers });
  check(oppsRes, {
    'list opportunities status is 200': (r) => r.status === 200,
    'list opportunities response time < 500ms': (r) => r.timings.duration < 500,
  });
  sleep(1);

  // Test 6: Analytics dashboard
  const analyticsRes = http.get(`${BASE_URL}/analytics/dashboard`, { headers });
  check(analyticsRes, {
    'analytics dashboard status is 200': (r) => r.status === 200,
    'analytics dashboard response time < 1000ms': (r) => r.timings.duration < 1000,
  });
  sleep(1);
}
