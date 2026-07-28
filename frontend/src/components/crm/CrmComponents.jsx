import React from 'react';

export function CrmModal({ isOpen, onClose, title, children, size = 'md' }) {
  if (!isOpen) return null;

  const sizeClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
  }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className={`${sizeClass} w-full bg-bg-elevated rounded-lg shadow-lg border border-border-default p-6`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-text-primary">{title}</h2>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary focus:outline-none"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function CrmForm({ onSubmit, children, submitLabel = 'Salvar', isLoading = false }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-4"
    >
      {children}
      <button
        type="submit"
        disabled={isLoading}
        className="w-full px-4 py-2 bg-accent-primary text-white rounded-lg hover:opacity-80 disabled:opacity-50 font-medium"
      >
        {isLoading ? 'Carregando...' : submitLabel}
      </button>
    </form>
  );
}

export function CrmInput({ label, value, onChange, placeholder, type = 'text', required = false }) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-primary mb-1">
        {label}
        {required && <span className="text-status-error">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full px-3 py-2 bg-bg-secondary border border-border-default text-text-primary rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-primary placeholder-text-tertiary"
      />
    </div>
  );
}

export function CrmSelect({ label, value, onChange, options, required = false }) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-primary mb-1">
        {label}
        {required && <span className="text-status-error">*</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full px-3 py-2 bg-bg-secondary border border-border-default text-text-primary rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-primary"
      >
        <option value="">-- Selecionar --</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CrmTextarea({ label, value, onChange, placeholder, required = false, rows = 3 }) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-primary mb-1">
        {label}
        {required && <span className="text-status-error">*</span>}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        rows={rows}
        className="w-full px-3 py-2 bg-bg-secondary border border-border-default text-text-primary rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-primary placeholder-text-tertiary"
      />
    </div>
  );
}

export function CrmButton({ onClick, children, variant = 'primary', size = 'md', disabled = false, isLoading = false }) {
  const variantClass = {
    primary: 'bg-accent-primary hover:opacity-80 text-white',
    secondary: 'bg-bg-secondary hover:bg-bg-hover text-text-primary border border-border-default',
    danger: 'bg-status-error hover:opacity-80 text-white',
    success: 'bg-status-success hover:opacity-80 text-white',
  }[variant];

  const sizeClass = {
    sm: 'px-2 py-1 text-sm',
    md: 'px-4 py-2',
    lg: 'px-6 py-3 text-lg',
  }[size];

  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`${variantClass} ${sizeClass} rounded-lg font-medium disabled:opacity-50 transition-colors`}
    >
      {isLoading ? '...' : children}
    </button>
  );
}

export function CrmCard({ children, className = '' }) {
  return (
    <div className={`bg-bg-elevated rounded-lg shadow border border-border-default p-6 ${className}`}>{children}</div>
  );
}

export function CrmTable({ columns, data, onRowClick, onDelete, isLoading }) {
  if (isLoading) {
    return <div className="text-center py-4 text-text-primary">Carregando...</div>;
  }

  if (data.length === 0) {
    return <div className="text-center py-4 text-text-secondary">Nenhum registro encontrado</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-bg-secondary border-b border-border-default">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className="px-4 py-2 text-left font-semibold text-text-primary">
                {col.label}
              </th>
            ))}
            {onDelete && (
              <th className="px-4 py-2 text-center font-semibold text-text-primary">Ações</th>
            )}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIndex) => (
            <tr
              key={row.id ?? rowIndex}
              className="border-b border-border-default hover:bg-bg-hover"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className="px-4 py-2 text-text-primary cursor-pointer hover:text-accent-primary"
                  onClick={() => onRowClick?.(row)}
                >
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
              {onDelete && (
                <td className="px-4 py-2 text-center">
                  <div className="flex justify-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRowClick?.(row);
                      }}
                      className="text-accent-primary hover:text-accent-primary-hover transition-colors"
                      title="Editar"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm('Deseja deletar este registro?')) {
                          onDelete(row.id);
                        }
                      }}
                      className="text-status-error hover:opacity-80 transition-opacity"
                      title="Deletar"
                    >
                      🗑️
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CrmBadge({ label, variant = 'default' }) {
  const variantClass = {
    default: 'bg-bg-secondary text-text-primary',
    success: 'bg-status-success bg-opacity-20 text-status-success',
    warning: 'bg-status-warning bg-opacity-20 text-status-warning',
    danger: 'bg-status-error bg-opacity-20 text-status-error',
    info: 'bg-accent-primary bg-opacity-20 text-accent-primary',
  }[variant];

  return <span className={`${variantClass} px-2 py-1 rounded text-xs font-semibold`}>{label}</span>;
}

export function CrmAlert({ message, variant = 'info', onDismiss }) {
  const variantClass = {
    info: 'bg-accent-primary bg-opacity-10 text-accent-primary border-accent-primary',
    success: 'bg-status-success bg-opacity-10 text-status-success border-status-success',
    warning: 'bg-status-warning bg-opacity-10 text-status-warning border-status-warning',
    error: 'bg-status-error bg-opacity-10 text-status-error border-status-error',
  }[variant];

  return (
    <div className={`${variantClass} border border-b-2 p-4 rounded-lg mb-4 flex justify-between items-center`}>
      <span>{message}</span>
      <button onClick={onDismiss} className="text-current hover:opacity-75">
        ✕
      </button>
    </div>
  );
}
