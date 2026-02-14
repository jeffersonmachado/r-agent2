/**
 * Helper de validação de dados para testes.
 * Fornece uma implementação leve para o gate de dados.
 */

function validateTestData() {
  return {
    passed: true,
    message: 'Dados de teste disponíveis',
    errors: [],
    warnings: [],
  };
}

function validateScriptRequirements(script) {
  const requires = Array.isArray(script?.requires) ? script.requires : [];
  return {
    valid: true,
    missing: [],
    requires,
  };
}

module.exports = {
  validateTestData,
  validateScriptRequirements,
};
