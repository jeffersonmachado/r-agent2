import { getLatestState, getGaps, saveState, updateGap } from '../repositories/business-rules.repository.js';
import { run } from '../services/business-rules/pipeline-runner.js';
import { analyzeAllVerticals, analyzeVertical } from '../services/journey-business-rules.service.js';

export function getStateController(_req, res) {
  const state = getLatestState();
  if (!state) {
    return res.json({ state: null });
  }
  return res.json(state);
}

export function runPipelineController(req, res) {
  try {
    const { entities, relationships, sourceFiles, sourceLabel } = req.body || {};

    if (!Array.isArray(entities) || entities.length === 0) {
      return res.status(400).json({ message: 'Campo "entities" obrigatorio (array nao vazio)' });
    }

    if (!Array.isArray(relationships)) {
      return res.status(400).json({ message: 'Campo "relationships" obrigatorio (array)' });
    }

    const businessRulesState = run({ entities, relationships, sourceFiles, sourceLabel });
    saveState(businessRulesState);

    return res.status(201).json(businessRulesState);
  } catch (err) {
    return res.status(400).json({ message: err.message || 'Falha ao executar pipeline' });
  }
}

export function getJourneysController(_req, res) {
  try {
    const result = analyzeAllVerticals();
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Falha ao analisar jornadas' });
  }
}

export function getJourneyController(req, res) {
  try {
    const result = analyzeVertical(req.params.verticalId);
    return res.json(result);
  } catch (err) {
    return res.status(404).json({ message: err.message || 'Jornada nao encontrada' });
  }
}

export function getGapsController(req, res) {
  const gaps = getGaps(req.query || {});
  return res.json({ gaps, total: gaps.length });
}

export function updateGapController(req, res) {
  const { gapId } = req.params;
  const { status, notes } = req.body || {};

  if (!status) {
    return res.status(400).json({ message: 'Campo "status" obrigatorio' });
  }

  const updated = updateGap(gapId, { status, notes });
  if (!updated) {
    return res.status(404).json({ message: 'Gap nao encontrado' });
  }

  return res.json(updated);
}
