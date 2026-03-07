import React, { useEffect, useMemo, useRef, useState } from 'react';

export function AutocompleteDropdown({
  value = '',
  onInputChange,
  onSelect,
  fetchOptions,
  placeholder = '',
  disabled = false,
  minChars = 2,
  debounceMs = 300,
  noResultsText = 'Nenhum resultado',
  loadingText = 'Carregando...',
  getOptionKey = (item) => item?.id || item?.value || String(item),
  getOptionLabel = (item) => item?.label || item?.name || String(item || ''),
  getOptionSubLabel = (item) => item?.subLabel || item?.description || '',
  ariaLabel = 'Autocomplete',
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const rootRef = useRef(null);
  const cacheRef = useRef(new Map());
  const listboxId = useMemo(() => `ac-${Math.random().toString(36).slice(2)}`, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target)) {
        setOpen(false);
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (disabled || !open) return undefined;
    const query = String(value || '').trim();
    if (query.length < Number(minChars)) {
      setItems([]);
      setLoading(false);
      setHighlightedIndex(-1);
      return undefined;
    }

    const timer = setTimeout(async () => {
      const cacheKey = query.toLowerCase();
      if (cacheRef.current.has(cacheKey)) {
        const cached = cacheRef.current.get(cacheKey);
        setItems(Array.isArray(cached) ? cached : []);
        setHighlightedIndex((Array.isArray(cached) && cached.length > 0) ? 0 : -1);
        return;
      }
      setLoading(true);
      try {
        const result = await fetchOptions(query);
        const normalized = Array.isArray(result) ? result : [];
        cacheRef.current.set(cacheKey, normalized);
        setItems(normalized);
        setHighlightedIndex(normalized.length > 0 ? 0 : -1);
      } catch (_err) {
        setItems([]);
        setHighlightedIndex(-1);
      } finally {
        setLoading(false);
      }
    }, Number(debounceMs) || 300);

    return () => clearTimeout(timer);
  }, [value, open, disabled, minChars, debounceMs, fetchOptions]);

  function selectByIndex(index) {
    const item = items[index];
    if (!item) return;
    onSelect?.(item);
    setOpen(false);
    setHighlightedIndex(-1);
  }

  function handleKeyDown(event) {
    if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      setOpen(true);
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      setHighlightedIndex(-1);
      return;
    }
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((prev) => {
        if (items.length === 0) return -1;
        return prev >= items.length - 1 ? 0 : prev + 1;
      });
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((prev) => {
        if (items.length === 0) return -1;
        return prev <= 0 ? items.length - 1 : prev - 1;
      });
      return;
    }
    if (event.key === 'Enter' && highlightedIndex >= 0 && highlightedIndex < items.length) {
      event.preventDefault();
      selectByIndex(highlightedIndex);
    }
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <input
        className="support-form-input"
        value={value}
        onChange={(event) => {
          onInputChange?.(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open ? (
        <div
          id={listboxId}
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 40,
            border: '1px solid var(--color-border-default)',
            borderRadius: '8px',
            background: 'var(--color-bg-elevated)',
            maxHeight: '220px',
            overflowY: 'auto',
          }}
        >
          {loading ? <div style={{ padding: '8px 10px', fontSize: '12px' }}>{loadingText}</div> : null}
          {!loading && items.length === 0 ? <div style={{ padding: '8px 10px', fontSize: '12px' }}>{noResultsText}</div> : null}
          {!loading && items.map((item, index) => {
            const highlighted = index === highlightedIndex;
            return (
              <button
                key={String(getOptionKey(item))}
                type="button"
                role="option"
                aria-selected={highlighted}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectByIndex(index)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: 'none',
                  borderBottom: '1px solid var(--color-border-default)',
                  background: highlighted ? 'var(--color-bg-secondary)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 600 }}>{getOptionLabel(item)}</div>
                {getOptionSubLabel(item) ? (
                  <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                    {getOptionSubLabel(item)}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
