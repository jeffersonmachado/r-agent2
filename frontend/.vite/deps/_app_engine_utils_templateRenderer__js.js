import {
  __commonJS
} from "./chunk-PLDDJCW6.js";

// ../engine/utils/templateRenderer.js
var require_templateRenderer = __commonJS({
  "../engine/utils/templateRenderer.js"(exports, module) {
    function renderTemplate(template, variables) {
      if (typeof template !== "string") return "";
      if (!variables || typeof variables !== "object") return template;
      return template.replace(/{{\s*([^}]+)\s*}}/g, (match, varName) => {
        const key = String(varName || "").trim();
        const value = variables.hasOwnProperty(key) ? variables[key] : "";
        return value != null ? String(value) : "";
      });
    }
    module.exports = {
      renderTemplate
    };
  }
});
export default require_templateRenderer();
//# sourceMappingURL=_app_engine_utils_templateRenderer__js.js.map
