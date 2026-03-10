import { useMemo, useState } from 'react';

export function usePlatformGridSelection({
  rows = [],
  getRowKey = (row, index) => String(row?.id ?? index),
}) {
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);

  const selectedRows = useMemo(() => {
    const keys = new Set(selectedRowKeys);
    return rows.filter((row, index) => keys.has(getRowKey(row, index)));
  }, [getRowKey, rows, selectedRowKeys]);

  function toggleRowSelection(row, index = rows.indexOf(row)) {
    const rowKey = getRowKey(row, index);
    setSelectedRowKeys((currentKeys) => (
      currentKeys.includes(rowKey)
        ? currentKeys.filter((key) => key !== rowKey)
        : [...currentKeys, rowKey]
    ));
  }

  function setAllRowsSelected(checked) {
    if (!checked) {
      setSelectedRowKeys([]);
      return;
    }
    setSelectedRowKeys(rows.map((row, index) => getRowKey(row, index)));
  }

  function clearSelection() {
    setSelectedRowKeys([]);
  }

  return {
    selectedRowKeys,
    selectedRows,
    setSelectedRowKeys,
    toggleRowSelection,
    setAllRowsSelected,
    clearSelection,
  };
}
