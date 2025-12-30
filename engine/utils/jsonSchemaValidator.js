/**
 * Validador de JSON Schema (subconjunto mínimo).
 *
 * Este módulo valida dados contra um JSON Schema simplificado.
 *
 * Módulo compartilhado: pode ser usado tanto no backend (CommonJS) quanto no frontend (ES modules).
 *
 * Suporta:
 * - type: "object" | "string" | "number" | "boolean" | "array"
 * - properties: { [key]: schema }
 * - required: string[]
 * - items: schema (para arrays)
 *
 * Decisão importante:
 * - Não usamos bibliotecas externas (ex.: ajv) para manter o núcleo
 *   da engine leve e sem dependências extras.
 *
 * @param {any} schema - Schema JSON (objeto com type, properties, required, items)
 * @param {any} data - Dados a serem validados
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateJsonSchema(schema, data) {
  const errors = [];

  if (!schema || typeof schema !== 'object') {
    return { valid: true, errors }; // Sem schema = sem validação
  }

  function validate(schemaNode, value, path) {
    const expectedType = schemaNode.type;

    if (expectedType) {
      if (expectedType === 'object') {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          errors.push(`${path}: esperado objeto`);
          return;
        }
        const props = schemaNode.properties || {};
        const required = schemaNode.required || [];

        for (const reqKey of required) {
          if (!Object.prototype.hasOwnProperty.call(value, reqKey)) {
            errors.push(`${path}.${reqKey}: campo obrigatório ausente`);
          }
        }

        for (const [key, subSchema] of Object.entries(props)) {
          if (Object.prototype.hasOwnProperty.call(value, key)) {
            validate(subSchema, value[key], `${path}.${key}`);
          }
        }
      } else if (expectedType === 'array') {
        if (!Array.isArray(value)) {
          errors.push(`${path}: esperado array`);
          return;
        }
        if (schemaNode.items) {
          value.forEach((item, idx) => {
            validate(schemaNode.items, item, `${path}[${idx}]`);
          });
        }
      } else if (expectedType === 'string') {
        if (typeof value !== 'string') {
          errors.push(`${path}: esperado string`);
        }
      } else if (expectedType === 'number') {
        if (typeof value !== 'number') {
          errors.push(`${path}: esperado number`);
        }
      } else if (expectedType === 'boolean') {
        if (typeof value !== 'boolean') {
          errors.push(`${path}: esperado boolean`);
        }
      }
    }
  }

  validate(schema, data, '$');

  return {
    valid: errors.length === 0,
    errors,
  };
}

// Exportação CommonJS (para Node.js/backend)
// O Vite pode importar CommonJS normalmente, então não precisamos de export ES module explícito
module.exports = {
  validateJsonSchema,
};

