/**
 * Pure utility functions for file handling in GenerateSystemPage.
 */

/**
 * Returns true if the given string is a syntactically valid absolute URL.
 * @param {string} url
 * @returns {boolean}
 */
export function validateUrl(url) {
  if (!url || url.trim() === '') return false;
  try {
    new URL(url.trim());
    return true;
  } catch {
    return false;
  }
}

/**
 * Basic (non-AI) file category inference based on MIME type and filename keywords.
 * @param {File} file
 * @returns {string}
 */
export function inferFileCategoryFallback(file) {
  const fileName = file.name.toLowerCase();
  const fileType = file.type.toLowerCase();
  const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';

  const promocaoKeywords = ['promo', 'promocao', 'promoção', 'desconto', 'oferta', 'black', 'friday', 'natal', 'pascoa', 'dia', 'das', 'maes', 'pais'];
  const avisoKeywords = ['aviso', 'comunicado', 'noticia', 'notícia', 'anuncio', 'anúncio', 'informacao', 'informação', 'atualizacao', 'atualização'];
  const tabelaPrecoKeywords = ['tabela', 'preco', 'preço', 'price', 'pricing', 'valor', 'custo', 'tarifa', 'planilha', 'spreadsheet', 'excel'];

  const isImage = fileType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(fileExtension);

  if (isImage) {
    const allKeywords = [...promocaoKeywords, ...avisoKeywords, ...tabelaPrecoKeywords];
    if (!allKeywords.some(keyword => fileName.includes(keyword))) {
      return 'imagens';
    }
  }

  if (promocaoKeywords.some(keyword => fileName.includes(keyword))) return 'promocoes';
  if (avisoKeywords.some(keyword => fileName.includes(keyword))) return 'avisos';
  if (tabelaPrecoKeywords.some(keyword => fileName.includes(keyword))) return 'tabelas_preco';
  if (isImage) return 'imagens';

  return 'outros';
}

/**
 * Returns the human-readable label for a file category key.
 * @param {string} category
 * @returns {string}
 */
export function getCategoryLabel(category) {
  const labels = {
    promocoes: 'Promoções',
    avisos: 'Avisos',
    tabelas_preco: 'Tabelas de Preço',
    imagens: 'Imagens',
    outros: 'Outros',
  };
  return labels[category] || category;
}
