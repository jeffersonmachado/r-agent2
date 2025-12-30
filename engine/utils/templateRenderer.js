/**
 * Renderizador de templates com interpolação de variáveis.
 *
 * Este módulo renderiza templates simples substituindo {{chaves}} por valores
 * das variáveis fornecidas.
 *
 * Módulo compartilhado: pode ser usado tanto no backend (CommonJS) quanto no frontend (ES modules).
 *
 * Decisão importante:
 * - Evitamos qualquer forma de eval; a interpolação é puramente textual.
 * - Suporta templates no formato: "Olá {{nome}}, você tem {{idade}} anos"
 *
 * @param {string} template - Template com placeholders {{variavel}}
 * @param {Object<string, any>} variables - Objeto com valores para substituir
 * @returns {string} Template renderizado
 */
function renderTemplate(template, variables) {
  if (typeof template !== 'string') return '';
  if (!variables || typeof variables !== 'object') return template;
  
  return template.replace(/{{\s*([^}]+)\s*}}/g, (match, varName) => {
    const key = String(varName || '').trim();
    const value = variables.hasOwnProperty(key) ? variables[key] : '';
    return value != null ? String(value) : '';
  });
}

// Exportação CommonJS (para Node.js/backend)
// O Vite pode importar CommonJS normalmente, então não precisamos de export ES module explícito
module.exports = {
  renderTemplate,
};

