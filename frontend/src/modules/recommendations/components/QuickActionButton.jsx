import React from 'react';

/**
 * QuickActionButton
 * Individual button for a quick action
 */

export function QuickActionButton({
  action,
  onExecute,
  isLoading = false,
  disabled = false,
}) {
  if (!action) return null;

  const handleClick = () => {
    if (onExecute && !isLoading && !disabled) {
      onExecute(action.id);
    }
  };

  const variantClass = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    secondary: 'bg-gray-200 hover:bg-gray-300 text-gray-900',
    warning: 'bg-yellow-500 hover:bg-yellow-600 text-white',
    error: 'bg-red-600 hover:bg-red-700 text-white',
    info: 'bg-sky-500 hover:bg-sky-600 text-white',
  }[action.variant || 'secondary'];

  const buttonClass = [
    'px-3 py-1.5 rounded text-sm font-medium',
    'transition-colors duration-200',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    'inline-flex items-center gap-2',
    variantClass,
    isLoading ? 'opacity-70' : '',
  ].filter(Boolean).join(' ');

  return (
    <button
      className={buttonClass}
      onClick={handleClick}
      disabled={disabled || isLoading}
      title={action.label}
    >
      {isLoading && (
        <span className="inline-flex animate-spin">
          ⟳
        </span>
      )}
      {action.icon ? <span aria-hidden="true">{action.icon}</span> : null}
      <span>{action.label}</span>
    </button>
  );
}
