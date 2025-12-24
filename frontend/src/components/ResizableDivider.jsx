import React, { useRef } from 'react';

/**
 * ResizableDivider - Divisor redimensionável EXATAMENTE como no modelo
 * Usa drag manual (não CSS resize)
 */
export function ResizableDivider({ 
  direction, // 'horizontal-left' ou 'horizontal-right'
  targetId, // ID do elemento a redimensionar
  onResize 
}) {
  const isResizingRef = useRef(false);
  const startXRef = useRef(0);
  const startSizeRef = useRef(0);
  const targetRef = useRef(null);

  const handleMouseDown = (e) => {
    e.preventDefault();
    const target = document.getElementById(targetId);
    if (!target) return;

    targetRef.current = target;
    isResizingRef.current = true;
    startXRef.current = e.clientX;
    startSizeRef.current = target.offsetWidth;

    const handleMouseMove = (e) => {
      if (!isResizingRef.current || !targetRef.current) return;

      const deltaX = e.clientX - startXRef.current;
      let newWidth;

      if (direction === 'horizontal-left') {
        // Paleta cresce para a direita (delta positivo)
        newWidth = startSizeRef.current + deltaX;
      } else if (direction === 'horizontal-right') {
        // Painel direito cresce para a esquerda (delta INVERTIDO - negativo)
        newWidth = startSizeRef.current - deltaX;
      }

      // Limites
      if (newWidth < 48) newWidth = 48;
      if (newWidth > 800) newWidth = 800;

      targetRef.current.style.width = `${newWidth}px`;
      if (onResize) onResize(newWidth);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      targetRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div
      className="w-1 cursor-col-resize hover:bg-blue-400/30"
      onMouseDown={handleMouseDown}
    />
  );
}

