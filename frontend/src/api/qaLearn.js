import { fetchJson } from './client';

export async function getQaLearnSummary() {
  return fetchJson('/qa/learn/summary');
}

export async function getQaLearnFailures() {
  return fetchJson('/qa/learn/failures');
}

export async function getQaLearnSuggestions() {
  return fetchJson('/qa/learn/suggestions');
}

export async function getQaLearnPlans() {
  return fetchJson('/qa/learn/plans');
}

export async function getQaLearnMemory() {
  return fetchJson('/qa/learn/memory');
}
