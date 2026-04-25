import React from 'react';
import { useRouter } from '../hooks/useRouter';

/**
 * Componente de link de navegação que atualiza a URL sem recarregar a página.
 */
export function NavigationLink({ to, children, className = '', activeClassName = '', onClick, ...rest }) {
  const { currentPath, navigate } = useRouter();
  const isActive = currentPath === to || (to !== '/' && currentPath.startsWith(to));

  const handleClick = (e) => {
    e.preventDefault();
    navigate(to);
    // Chama onClick opcional após navegação
    if (onClick) {
      onClick();
    }
  };

  const classes = `${className} ${isActive ? activeClassName : ''}`.trim();

  return (
    <a href={to} onClick={handleClick} className={classes} {...rest}>
      {children}
    </a>
  );
}

