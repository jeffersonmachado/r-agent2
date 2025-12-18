import React from 'react';

/**
 * Input moderno estilo Linear/Stripe com Tailwind CSS
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
  const [focused, setFocused] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);

  const baseClasses = 'w-full px-4 py-3 text-[14px] font-inherit text-text-primary bg-bg-secondary rounded-lg outline-none transition-all duration-fast'; // Inputs grandes conforme diretrizes
  const borderClasses = focused
    ? 'border-border-focus ring-2 ring-accent-light'
    : hovered && !disabled
    ? 'border-border-hover'
    : 'border-border-default';
  const disabledClasses = disabled ? 'opacity-50 cursor-not-allowed' : '';

  const classes = `${baseClasses} ${borderClasses} ${disabledClasses} ${className}`.trim();

  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onMouseEnter={() => !disabled && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={classes}
      {...props}
    />
  );
}

export function Textarea({ value, onChange, placeholder, rows = 4, className = '', ...props }) {
  const [focused, setFocused] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);

  const baseClasses = 'w-full px-4 py-3 text-[14px] font-inherit text-text-primary bg-bg-secondary rounded-lg outline-none transition-all duration-fast resize-y'; // Inputs grandes conforme diretrizes
  const borderClasses = focused
    ? 'border-border-focus ring-2 ring-accent-light'
    : hovered
    ? 'border-border-hover'
    : 'border-border-default';
  
  const classes = `${baseClasses} ${borderClasses} ${className}`.trim();

  return (
    <textarea
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={classes}
      {...props}
    />
  );
}


