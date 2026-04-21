import React, { useEffect, useMemo, useState } from 'react';
import { filterNavigationTree } from '../utils/menuPermissions';
import { navigationMenu, flattenNavigationLeaves } from '../navigation/menu';
import { useRouter } from '../hooks/useRouter';

export function CommandPalette({ agent }) {
  const { navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filteredMenu = useMemo(() => filterNavigationTree(agent, navigationMenu), [agent]);
  const entries = useMemo(
    () => flattenNavigationLeaves(filteredMenu).filter((item) => item.path),
    [filteredMenu],
  );

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return entries.slice(0, 12);
    return entries
      .filter((item) => {
        const haystack = [item.label, item.path, ...(item.keywords || [])].join(' ').toLowerCase();
        return haystack.includes(normalized);
      })
      .slice(0, 12);
  }, [entries, query]);

  useEffect(() => {
    function handleKeydown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, []);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="rap-command-backdrop" onClick={() => setOpen(false)}>
      <div className="rap-command-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="rap-command-header">
          <div>
            <strong>Command Palette</strong>
            <p>Ctrl/Cmd + K para abrir atalhos de navegacao</p>
          </div>
          <button type="button" className="rap-command-close" onClick={() => setOpen(false)}>
            Fechar
          </button>
        </div>
        <input
          autoFocus
          type="text"
          className="rap-command-input"
          placeholder="Buscar modulo, rota ou capacidade..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="rap-command-results">
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              className="rap-command-item"
              onClick={() => {
                navigate(item.path);
                setOpen(false);
              }}
            >
              <span>{item.label}</span>
              <small>{item.path}</small>
            </button>
          ))}
          {results.length === 0 && <div className="rap-command-empty">Nenhum atalho encontrado.</div>}
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
