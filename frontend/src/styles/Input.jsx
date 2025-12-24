import React from 'react';

/**
 * Input moderno estilo Linear/Stripe com Tailwind CSS
 * Usa apenas CSS para estados :focus e :hover (sem JavaScript)
 */
export function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled = false,
  className = '',
  ...props
}) {
  const baseClasses = 'w-full px-4 py-3 text-[14px] font-inherit text-text-primary bg-bg-secondary rounded-lg outline-none transition-all duration-fast border input-base';
  const disabledClasses = disabled ? 'opacity-50 cursor-not-allowed' : '';

  const classes = `${baseClasses} ${disabledClasses} ${className}`.trim();

  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={classes}
      {...props}
    />
  );
}

export function Textarea({ value, onChange, placeholder, rows = 4, className = '', ...props }) {
  const baseClasses = 'w-full px-4 py-3 text-[14px] font-inherit text-text-primary bg-bg-secondary rounded-lg outline-none transition-all duration-fast resize-y border input-base';
  
  const classes = `${baseClasses} ${className}`.trim();

  return (
    <textarea
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      className={classes}
      {...props}
    />
  );
}
