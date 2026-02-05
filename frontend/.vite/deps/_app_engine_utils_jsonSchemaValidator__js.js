import {
  __commonJS
} from "./chunk-PLDDJCW6.js";

// ../engine/utils/jsonSchemaValidator.js
var require_jsonSchemaValidator = __commonJS({
  "../engine/utils/jsonSchemaValidator.js"(exports, module) {
    function validateJsonSchema(schema, data) {
      const errors = [];
      if (!schema || typeof schema !== "object") {
        return { valid: true, errors };
      }
      function validate(schemaNode, value, path) {
        const expectedType = schemaNode.type;
        if (expectedType) {
          if (expectedType === "object") {
            if (typeof value !== "object" || value === null || Array.isArray(value)) {
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
          } else if (expectedType === "array") {
            if (!Array.isArray(value)) {
              errors.push(`${path}: esperado array`);
              return;
            }
            if (schemaNode.items) {
              value.forEach((item, idx) => {
                validate(schemaNode.items, item, `${path}[${idx}]`);
              });
            }
          } else if (expectedType === "string") {
            if (typeof value !== "string") {
              errors.push(`${path}: esperado string`);
            }
          } else if (expectedType === "number") {
            if (typeof value !== "number") {
              errors.push(`${path}: esperado number`);
            }
          } else if (expectedType === "boolean") {
            if (typeof value !== "boolean") {
              errors.push(`${path}: esperado boolean`);
            }
          }
        }
      }
      validate(schema, data, "$");
      return {
        valid: errors.length === 0,
        errors
      };
    }
    module.exports = {
      validateJsonSchema
    };
  }
});
export default require_jsonSchemaValidator();
//# sourceMappingURL=_app_engine_utils_jsonSchemaValidator__js.js.map
