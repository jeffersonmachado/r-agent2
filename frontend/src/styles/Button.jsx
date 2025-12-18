import React from 'react';

/**
 * Botão moderno estilo Linear/Stripe com Tailwind CSS
 */
export function Button({
  children,
  variant = 'default',
  size = 'md',
  onClick,
  disabled = false,
  type = 'button',
  className = '',
  ...props
}) {
  const [hovered, setHovered] = React.useState(false);
  const [pressed, setPressed] = React.useState(false);

  const baseClasses = 'font-medium leading-none border-none outline-none inline-flex items-center justify-center gap-1.5 transition-all duration-fast';
  
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-base',
  };

  const variantClasses = {
    primary: pressed && !disabled
      ? 'bg-accent-pressed text-white'
      : hovered && !disabled
      ? 'bg-accent-hover text-white'
      : 'bg-accent-primary text-white',
    danger: pressed && !disabled
      ? 'bg-red-700 text-white'
      : hovered && !disabled
      ? 'bg-red-600 text-white'
      : 'bg-status-error text-white',
    ghost: hovered && !disabled
      ? 'bg-bg-tertiary text-text-primary'
      : 'bg-transparent text-text-secondary',
    default: pressed && !disabled
      ? 'bg-bg-tertiary text-text-primary border border-border-default'
      : hovered && !disabled
      ? 'bg-bg-hover text-text-primary border border-border-hover'
      : 'bg-bg-elevated text-text-primary border border-border-default',
  };

  const cursorClass = disabled ? 'cursor-not-allowed' : 'cursor-pointer';
  const opacityClass = disabled ? 'opacity-50' : 'opacity-100';

  const classes = `${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${cursorClass} ${opacityClass} ${className}`.trim();

  return (
    <button
      type={type}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => !disabled && setPressed(true)}
      onMouseUp={() => setPressed(false)}
      className={classes}
      {...props}
    >
      {children}
    </button>
  );
}

