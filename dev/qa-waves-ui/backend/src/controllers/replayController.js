import { getReplay, getReplays, rerunReplay } from '../services/replayService.js';

export function listReplaysController(req, res) {
  const paged = getReplays(req.query);
  res.json({
    replays: paged.items,
    pagination: {
      total: paged.total,
      page: paged.page,
      pageSize: paged.pageSize,
      totalPages: paged.totalPages
    }
  });
}

export function getReplayController(req, res) {
  const replay = getReplay(req.params.replayId);
  if (!replay) {
    return res.status(404).json({ message: 'Replay not found' });
  }
  return res.json(replay);
}

export function reexecuteReplayController(req, res) {
  const execution = rerunReplay(req.params.replayId);
  if (!execution) {
    return res.status(404).json({ message: 'Replay not found for reexecution' });
  }
  return res.status(201).json(execution);
}
