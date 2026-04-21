import { fetchJson } from './client';

export async function getQaCheckpoints() {
  return fetchJson('/qa/checkpoints');
}

export async function getQaCheckpoint(wave) {
  return fetchJson(`/qa/checkpoints/${encodeURIComponent(wave)}`);
}
