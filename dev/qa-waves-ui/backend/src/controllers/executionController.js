import { getExecution, getExecutions, runSelection } from '../services/executionService.js';

export function createExecutionController(req, res) {
  const execution = runSelection(req.body || {});
  res.status(201).json(execution);
}

export function listExecutionsController(_req, res) {
  res.json({ executions: getExecutions() });
}

export function getExecutionController(req, res) {
  const execution = getExecution(req.params.executionId);
  if (!execution) {
    return res.status(404).json({ message: 'Execution not found' });
  }
  return res.json(execution);
}
