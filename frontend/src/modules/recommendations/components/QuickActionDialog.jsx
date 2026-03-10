import React, { useState } from 'react';

/**
 * QuickActionDialog
 * Lightweight input dialog for quick actions that require parameters
 */

export function QuickActionDialog({
  action,
  isOpen = false,
  onClose,
  onConfirm,
  isLoading = false,
}) {
  const [input, setInput] = useState({});

  if (!isOpen || !action) return null;

  const handleConfirm = () => {
    const template = action.payloadTemplate || {};
    const templateDefaults = Object.entries(template).reduce((acc, [key, value]) => {
      if (value !== null && value !== undefined) {
        acc[key] = value;
      }
      return acc;
    }, {});
    onConfirm({ ...templateDefaults, ...input });
    setInput({});
  };

  const handleCancel = () => {
    setInput({});
    onClose();
  };

  // Simple template-based input rendering
  const renderInputs = () => {
    const template = action.payloadTemplate || {};
    const inputs = [];

    // Find fields that need user input (value is null in template)
    Object.entries(template).forEach(([key, value]) => {
      if (value === null) {
        inputs.push({ key, label: formatFieldLabel(key) });
      }
    });

    return inputs;
  };

  const formatFieldLabel = (key) => {
    return key
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const fields = renderInputs();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-bold mb-4">{action.label}</h3>

        {fields.length > 0 ? (
          <div className="space-y-4 mb-6">
            {fields.map(field => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {field.label}
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder={`Enter ${field.label.toLowerCase()}`}
                  value={input[field.key] || ''}
                  onChange={(e) =>
                    setInput({ ...input, [field.key]: e.target.value })
                  }
                  disabled={isLoading}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-600 text-sm mb-6">Executar esta ação?</p>
        )}

        <div className="flex gap-2 justify-end">
          <button
            className="px-4 py-2 rounded text-sm font-medium bg-gray-200 text-gray-900 hover:bg-gray-300 disabled:opacity-50"
            onClick={handleCancel}
            disabled={isLoading}
          >
            Cancelar
          </button>
          <button
            className="px-4 py-2 rounded text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-2"
            onClick={handleConfirm}
            disabled={isLoading}
          >
            {isLoading && <span className="inline-flex animate-spin">⟳</span>}
            Executar
          </button>
        </div>
      </div>
    </div>
  );
}
