import { useMemo, useState } from 'react';

export function useWaveSelection(waves) {
  const [selectedWaveIds, setSelectedWaveIds] = useState(() => new Set());
  const [selectedItemIds, setSelectedItemIds] = useState(() => new Set());

  const itemsByWave = useMemo(() => {
    const map = new Map();
    (waves || []).forEach((wave) => {
      map.set(wave.id, wave.items || []);
    });
    return map;
  }, [waves]);

  function toggleWave(waveId, checked) {
    const waveItems = itemsByWave.get(waveId) || [];
    const nextWaveIds = new Set(selectedWaveIds);
    const nextItemIds = new Set(selectedItemIds);

    if (checked) {
      nextWaveIds.add(waveId);
      waveItems.forEach((item) => nextItemIds.add(item.id));
    } else {
      nextWaveIds.delete(waveId);
      waveItems.forEach((item) => nextItemIds.delete(item.id));
    }

    setSelectedWaveIds(nextWaveIds);
    setSelectedItemIds(nextItemIds);
  }

  function toggleItem(waveId, itemId, checked) {
    const nextItemIds = new Set(selectedItemIds);
    if (checked) nextItemIds.add(itemId);
    else nextItemIds.delete(itemId);

    const waveItems = itemsByWave.get(waveId) || [];
    const selectedCount = waveItems.filter((item) => nextItemIds.has(item.id)).length;

    const nextWaveIds = new Set(selectedWaveIds);
    if (selectedCount === waveItems.length && waveItems.length > 0) nextWaveIds.add(waveId);
    else nextWaveIds.delete(waveId);

    setSelectedItemIds(nextItemIds);
    setSelectedWaveIds(nextWaveIds);
  }

  function clearSelection() {
    setSelectedWaveIds(new Set());
    setSelectedItemIds(new Set());
  }

  function getWaveSelectionState(waveId) {
    const waveItems = itemsByWave.get(waveId) || [];
    if (waveItems.length === 0) return 'none';
    const selectedCount = waveItems.filter((item) => selectedItemIds.has(item.id)).length;
    if (selectedCount === 0) return 'none';
    if (selectedCount === waveItems.length) return 'all';
    return 'partial';
  }

  const selectionSummary = useMemo(() => {
    return {
      selectedWavesCount: selectedWaveIds.size,
      selectedItemsCount: selectedItemIds.size,
      hasSelection: selectedWaveIds.size > 0 || selectedItemIds.size > 0
    };
  }, [selectedWaveIds, selectedItemIds]);

  return {
    selectedWaveIds,
    selectedItemIds,
    selectionSummary,
    toggleWave,
    toggleItem,
    clearSelection,
    getWaveSelectionState
  };
}
