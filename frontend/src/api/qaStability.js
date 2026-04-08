import { fetchJson } from './client';

export async function getQaStability() {
  return fetchJson('/qa/stability');
}

export async function getQaStabilityHistory() {
  return fetchJson('/qa/stability/history');
}

export async function getQaStabilityFailures() {
  return fetchJson('/qa/stability/failures');
}
