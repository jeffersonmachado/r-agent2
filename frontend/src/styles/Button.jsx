import React from 'react';

/**
 * Botão moderno estilo Linear/Stripe com Tailwind CSS
 * Usa apenas CSS para estados :hover e :active (sem JavaScript)
 */
export const Button = React.forwardRef(function Button({
  children,
  variant = 'default',
  size = 'md',
  onClick,
  disabled = false,
  type = 'button',
  className = '',
  ...props
}, ref) {
  const baseClasses = 'font-medium leading-none border-none outline-none inline-flex items-center justify-center gap-1.5 transition-all duration-fast';
  
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-base',
  };

  // Classes baseadas em variantes - estados :hover e :active são tratados no CSS
  const variantClasses = {
    primary: 'btn-primary',
    secondary: 'btn-default',
    success: 'btn-success',
    warning: 'btn-warning',
    danger: 'btn-danger',
    ghost: 'btn-ghost',
    default: 'btn-default',
  };

  const cursorClass = disabled ? 'cursor-not-allowed' : 'cursor-pointer';
  const opacityClass = disabled ? 'opacity-50' : 'opacity-100';

  const classes = `${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${cursorClass} ${opacityClass} ${className}`.trim();

  const handleClick = (e) => {
    if (disabled) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (onClick) {
      onClick(e);
    }
  };

  // Remove onClick de props para evitar conflito
  const { onClick: _, ...restProps } = props;

  return (
    <button
      ref={ref}
      type={type}
      onClick={handleClick}
      disabled={disabled}
      className={classes}
      {...restProps}
    >
      {children}
    </button>
  );
});
