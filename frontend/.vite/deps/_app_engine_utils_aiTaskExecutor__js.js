import {
  __commonJS
} from "./chunk-PLDDJCW6.js";

// ../engine/utils/aiTaskExecutor.js
var require_aiTaskExecutor = __commonJS({
  "../engine/utils/aiTaskExecutor.js"(exports, module) {
    var SUPPORTED_TASKS = {
      intent_classification: "intent_classification",
      entity_extraction: "entity_extraction",
      text_normalization: "text_normalization",
      assisted_response: "assisted_response"
    };
    async function executeIntentClassification(input, config, context = {}) {
      const text = String(input || "").toLowerCase().trim();
      const allowedOutputs = Array.isArray(config.allowedOutputs) ? config.allowedOutputs : [];
      const fallback = config.fallback || "desconhecido";
      const confidenceThreshold = typeof config.confidenceThreshold === "number" ? config.confidenceThreshold : 0.75;
      const tenantContext = context.tenantContext || null;
      const ramoAtividade = tenantContext?.ramo_atividade || null;
      const defaultKeywordMap = {
        comprar: ["comprar", "quero comprar", "desejo comprar", "adquirir", "vender"],
        suporte: ["suporte", "ajuda", "problema", "erro", "não funciona", "dúvida"],
        financeiro: ["financeiro", "pagamento", "boleto", "fatura", "conta", "dinheiro"]
      };
      let keywordMap = defaultKeywordMap;
      if (config.keywords && typeof config.keywords === "object") {
        if (Array.isArray(config.keywords)) {
          keywordMap = {};
          config.keywords.forEach((item) => {
            if (item.intent && Array.isArray(item.keywords)) {
              keywordMap[item.intent] = item.keywords;
            }
          });
        } else {
          keywordMap = config.keywords;
        }
        if (Object.keys(keywordMap).length === 0) {
          keywordMap = defaultKeywordMap;
        }
      }
      let bestMatch = null;
      let bestConfidence = 0;
      const normalizedKeywords = {};
      for (const [intent, keywords] of Object.entries(keywordMap)) {
        if (Array.isArray(keywords) && keywords.length > 0) {
          normalizedKeywords[intent] = keywords.map((k) => String(k).toLowerCase().trim()).filter((k) => k.length > 0);
        }
      }
      let semanticBias = 0;
      if (ramoAtividade) {
        const ramoLower = ramoAtividade.toLowerCase();
        if (ramoLower.includes("e-commerce") || ramoLower.includes("varejo") || ramoLower.includes("venda")) {
          if (normalizedKeywords.comprar) {
            semanticBias = 0.1;
          }
        } else if (ramoLower.includes("saúde") || ramoLower.includes("clínica") || ramoLower.includes("médico")) {
          if (normalizedKeywords.agendar || normalizedKeywords.consulta) {
            semanticBias = 0.1;
          }
        } else if (ramoLower.includes("tecnologia") || ramoLower.includes("software")) {
          if (normalizedKeywords.suporte) {
            semanticBias = 0.1;
          }
        }
      }
      for (const [intent, keywords] of Object.entries(normalizedKeywords)) {
        if (allowedOutputs.length > 0 && !allowedOutputs.includes(intent)) {
          continue;
        }
        for (const keyword of keywords) {
          if (keyword && text.includes(keyword)) {
            let confidence = 1;
            if (text !== keyword) {
              const words = text.split(/\s+/);
              const isExactWord = words.includes(keyword);
              if (isExactWord) {
                confidence = 0.95;
              } else {
                confidence = Math.min(0.9, keyword.length / Math.max(text.length, 1));
              }
            }
            if (semanticBias > 0 && intent === bestMatch) {
              confidence = Math.min(1, confidence + semanticBias);
            }
            if (confidence > bestConfidence) {
              bestConfidence = confidence;
              bestMatch = intent;
            }
          }
        }
      }
      const normalizedConfidence = bestMatch ? Math.min(0.95, Math.max(0.5, 0.5 + bestConfidence * 0.45)) : 0.3;
      if (bestMatch && normalizedConfidence >= confidenceThreshold) {
        return {
          value: bestMatch,
          confidence: normalizedConfidence
        };
      }
      if (bestMatch) {
        return {
          value: bestMatch,
          confidence: normalizedConfidence,
          _lowConfidence: normalizedConfidence < confidenceThreshold
        };
      }
      return {
        value: null,
        confidence: 0,
        _noMatch: true
      };
    }
    async function executeEntityExtraction(input, config) {
      const text = String(input || "").trim();
      const entities = [];
      const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
      const phoneRegex = /\b\d{10,11}\b/g;
      const numberRegex = /\b\d+\.?\d*\b/g;
      const emails = text.match(emailRegex) || [];
      const phones = text.match(phoneRegex) || [];
      const numbers = text.match(numberRegex) || [];
      emails.forEach((email) => {
        entities.push({
          type: "email",
          value: email,
          confidence: 0.9
        });
      });
      phones.forEach((phone) => {
        entities.push({
          type: "phone",
          value: phone,
          confidence: 0.85
        });
      });
      numbers.slice(0, 3).forEach((num) => {
        entities.push({
          type: "number",
          value: num,
          confidence: 0.8
        });
      });
      return { entities };
    }
    async function executeTextNormalization(input, config) {
      const text = String(input || "").trim();
      let normalized = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
      return {
        normalized,
        confidence: 0.9
      };
    }
    async function executeAssistedResponse(input, config, context) {
      const text = String(input || "").trim();
      let response = "Entendi sua solicitação. Como posso ajudar?";
      let confidence = 0.7;
      if (text.includes("?")) {
        response = "Vou verificar isso para você.";
        confidence = 0.75;
      }
      if (text.length > 50) {
        response = "Recebi sua mensagem. Vou processar sua solicitação.";
        confidence = 0.8;
      }
      return {
        response,
        confidence
      };
    }
    async function executeAiTask(task, input, config = {}, context = {}) {
      if (!task || typeof task !== "string") {
        throw new Error("aiTaskExecutor: task deve ser uma string válida");
      }
      if (!SUPPORTED_TASKS[task]) {
        throw new Error(`aiTaskExecutor: tarefa não suportada: ${task}`);
      }
      switch (task) {
        case SUPPORTED_TASKS.intent_classification:
          return executeIntentClassification(input, config, context);
        case SUPPORTED_TASKS.entity_extraction:
          return executeEntityExtraction(input, config);
        case SUPPORTED_TASKS.text_normalization:
          return executeTextNormalization(input, config);
        case SUPPORTED_TASKS.assisted_response:
          return executeAssistedResponse(input, config, context);
        default:
          throw new Error(`aiTaskExecutor: handler não implementado para tarefa: ${task}`);
      }
    }
    function validateResponse(response, task, config) {
      if (!response || typeof response !== "object") {
        return { valid: false, error: "Resposta deve ser um objeto" };
      }
      switch (task) {
        case SUPPORTED_TASKS.intent_classification:
          if (response._noMatch || response.value === null) {
            return { valid: true };
          }
          if (typeof response.value !== "string") {
            return { valid: false, error: 'Resposta deve ter campo "value" (string)' };
          }
          if (typeof response.confidence !== "number") {
            return { valid: false, error: 'Resposta deve ter campo "confidence" (number)' };
          }
          if (response.confidence < 0 || response.confidence > 1) {
            return { valid: false, error: "Confidence deve estar entre 0 e 1" };
          }
          if (Array.isArray(config.allowedOutputs) && config.allowedOutputs.length > 0) {
            if (!config.allowedOutputs.includes(response.value) && response.value !== config.fallback) {
              return { valid: false, error: `Valor "${response.value}" não está em allowedOutputs` };
            }
          }
          break;
        case SUPPORTED_TASKS.entity_extraction:
          if (!Array.isArray(response.entities)) {
            return { valid: false, error: 'Resposta deve ter campo "entities" (array)' };
          }
          break;
        case SUPPORTED_TASKS.text_normalization:
          if (typeof response.normalized !== "string") {
            return { valid: false, error: 'Resposta deve ter campo "normalized" (string)' };
          }
          break;
        case SUPPORTED_TASKS.assisted_response:
          if (typeof response.response !== "string") {
            return { valid: false, error: 'Resposta deve ter campo "response" (string)' };
          }
          break;
        default:
          return { valid: false, error: `Tarefa não suportada: ${task}` };
      }
      return { valid: true };
    }
    module.exports = {
      executeAiTask,
      validateResponse,
      SUPPORTED_TASKS,
      executeIntentClassification,
      executeEntityExtraction,
      executeTextNormalization,
      executeAssistedResponse
    };
  }
});
export default require_aiTaskExecutor();
//# sourceMappingURL=_app_engine_utils_aiTaskExecutor__js.js.map
