import React, { useState } from 'react';
import { Input, Textarea } from '../styles/Input';

/**
 * Campo de propriedade com label, ajuda e validação
 */
export function PropertyField({
  label,
  description,
  required = false,
  error,
  children,
  className = '',
}) {
  return (
    <div className={`space-y-3 ${className}`}> {/* Espaçamento maior conforme diretrizes */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <label className="text-[14px] text-text-primary font-semibold"> {/* Labels claras, mínimo 14px */}
            {label}
          </label>
          {required && (
            <span className="text-status-error text-[14px] font-semibold">*</span>
          )}
        </div>
        {description && (
          <p className="text-[13px] text-text-secondary leading-relaxed mb-2"> {/* Descrição legível */}
            {description}
          </p>
        )}
      </div>
      {children}
      {error && (
        <p className="text-[13px] text-status-error flex items-center gap-1.5">
          <span>⚠️</span>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Campo de texto simples
 */
export function TextField({
  label,
  description,
  value,
  onChange,
  placeholder,
  required = false,
  error,
  type = 'text',
  className = '',
}) {
  return (
    <PropertyField label={label} description={description} required={required} error={error}>
      <Input
        type={type}
        value={value || ''}
        onChange={onChange}
        placeholder={placeholder}
        className={className}
      />
    </PropertyField>
  );
}

/**
 * Campo de textarea
 */
export function TextAreaField({
  label,
  description,
  value,
  onChange,
  placeholder,
  required = false,
  error,
  rows = 4,
  className = '',
}) {
  return (
    <PropertyField label={label} description={description} required={required} error={error}>
      <Textarea
        rows={rows}
        value={value || ''}
        onChange={onChange}
        placeholder={placeholder}
        className={className}
      />
    </PropertyField>
  );
}

/**
 * Campo JSON com validação e formatação
 */
export function JsonField({
  label,
  description,
  value,
  onChange,
  placeholder,
  required = false,
  error: externalError,
  rows = 8,
  expectedType = 'object', // 'object' | 'array'
}) {
  const [jsonError, setJsonError] = useState(null);
  const [isValidating, setIsValidating] = useState(false);

  const handleChange = (e) => {
    const rawValue = e.target.value;
    setIsValidating(true);
    setJsonError(null);

    if (!rawValue.trim()) {
      onChange(rawValue);
      setIsValidating(false);
      return;
    }

    try {
      const parsed = JSON.parse(rawValue);
      
      if (expectedType === 'array' && !Array.isArray(parsed)) {
        setJsonError(`Esperado um array, mas recebeu ${typeof parsed}`);
        onChange(rawValue);
      } else if (expectedType === 'object' && (Array.isArray(parsed) || typeof parsed !== 'object')) {
        setJsonError(`Esperado um objeto, mas recebeu ${Array.isArray(parsed) ? 'array' : typeof parsed}`);
        onChange(rawValue);
      } else {
        onChange(rawValue);
        setJsonError(null);
      }
    } catch (err) {
      setJsonError(`JSON inválido: ${err.message}`);
      onChange(rawValue);
    }
    
    setIsValidating(false);
  };

  const handleFormat = () => {
    if (!value || !value.trim()) {
      const defaultValue = expectedType === 'array' ? '[]' : '{}';
      onChange(defaultValue);
      return;
    }
    
    try {
      const parsed = JSON.parse(value);
      const formatted = JSON.stringify(parsed, null, 2);
      onChange(formatted);
      setJsonError(null);
    } catch {
      setJsonError('Não é possível formatar JSON inválido');
    }
  };

  const error = externalError || jsonError;

  return (
    <PropertyField label={label} description={description} required={required} error={error}>
      <div className="relative">
        <Textarea
          rows={rows}
          value={value || ''}
          onChange={handleChange}
          placeholder={placeholder}
          className={`font-mono text-xs ${error ? 'border-status-error' : ''}`}
        />
        {value && (
          <button
            type="button"
            onClick={handleFormat}
            className="absolute top-2 right-2 px-2 py-1 text-[10px] bg-bg-tertiary border border-border-default rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            title="Formatar JSON"
          >
            ⚡ Formatar
          </button>
        )}
        {isValidating && (
          <div className="absolute top-2 right-2 text-[10px] text-text-tertiary">
            Validando...
          </div>
        )}
      </div>
    </PropertyField>
  );
}

