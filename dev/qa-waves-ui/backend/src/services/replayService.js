import { getReplayById, listReplays, reexecuteReplay } from '../repositories/stateRepository.js';

export function getReplays(filters) {
  return listReplays(filters);
}

export function getReplay(replayId) {
  return getReplayById(replayId);
}

export function rerunReplay(replayId) {
  return reexecuteReplay(replayId);
}
