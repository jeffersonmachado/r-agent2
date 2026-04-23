import { listWaveItems, listWavesPaged } from '../repositories/stateRepository.js';

export function getWavesWithItemsPaged(filters = {}) {
  const paged = listWavesPaged(filters);
  const items = paged.items.map((wave) => ({
    ...wave,
    items: listWaveItems(wave.id)
  }));

  return {
    ...paged,
    items
  };
}
