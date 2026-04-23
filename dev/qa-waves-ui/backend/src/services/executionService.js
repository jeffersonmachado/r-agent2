import { createExecution, getExecutionById, listExecutions } from '../repositories/stateRepository.js';

export function runSelection(payload) {
  return createExecution(payload);
}

export function getExecution(executionId) {
  return getExecutionById(executionId);
}

export function getExecutions() {
  return listExecutions();
}
