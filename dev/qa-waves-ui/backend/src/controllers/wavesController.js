import { getWavesWithItemsPaged } from '../services/wavesService.js';

export function listWavesController(req, res) {
  const paged = getWavesWithItemsPaged(req.query || {});
  res.json({
    waves: paged.items,
    pagination: {
      total: paged.total,
      page: paged.page,
      pageSize: paged.pageSize,
      totalPages: paged.totalPages
    }
  });
}
