import React from 'react';

export function SupportSidebarMenu({ items = [] }) {
  if (!items.length) return null;

  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-3 shadow-lg">
      <div style={{ fontWeight: 700, marginBottom: '8px' }}>Workspace</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              const el = typeof document !== 'undefined' ? document.getElementById(item.id) : null;
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            style={{
              padding: '6px 10px',
              borderRadius: '999px',
              border: '1px solid var(--color-border-default)',
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
              fontSize: '12px',
            }}
            title={item.description || item.label}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
