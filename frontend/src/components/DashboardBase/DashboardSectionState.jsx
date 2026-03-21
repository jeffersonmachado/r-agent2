import React from 'react';

/**
 * DashboardSectionState
 *
 * Exibe o estado de loading, erro ou vazio de uma seção de dashboard.
 * Retorna null quando todos os flags são falsos/ausentes (seção com dados).
 *
 * @param {boolean} [loading]
 * @param {string|null} [error]
 * @param {boolean} [empty]
 * @param {string} [emptyMessage]
 */
export function DashboardSectionState({ loading = false, error = null, empty = false, emptyMessage = 'Nenhum registro encontrado.' }) {
  if (loading) {
    return <div className="text-sm text-text-secondary py-3">Carregando...</div>;
  }
  if (error) {
    return <div className="text-sm text-rose-300 py-3">{error}</div>;
  }
  if (empty) {
    return <div className="text-sm text-text-secondary py-3">{emptyMessage}</div>;
  }
  return null;
}
