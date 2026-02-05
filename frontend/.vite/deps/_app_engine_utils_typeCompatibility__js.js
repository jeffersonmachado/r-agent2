import {
  __commonJS
} from "./chunk-PLDDJCW6.js";

// ../engine/utils/typeCompatibility.js
var require_typeCompatibility = __commonJS({
  "../engine/utils/typeCompatibility.js"(exports, module) {
    var SYSTEM_NODES = [
      "get_flow_info",
      "get_queue_status",
      "get_config_value",
      "list_flows",
      "get_current_time",
      "generate_uuid",
      "delay",
      "format_date",
      "random_number",
      "get_user_info",
      // Nó estrutural pass-through (convergência)
      "merge"
    ];
    var SYSTEM_NODES_EXCEPT_MERGE = SYSTEM_NODES.filter((t) => t !== "merge");
    var VOICE_NODES = [
      "voice_prompt_listen",
      "voice_listen_asr",
      "voice_gather_dtmf",
      "voice_branch",
      "voice_transfer_ramal",
      "voice_transfer_fila",
      "voice_transfer_utils",
      "voice_hangup"
    ];
    var TYPE_COMPATIBILITY = {
      start: ["message", "user_input", "router", "semantic_router", "schedule_router", "set_variable", "handoff", "ai", "rag_answer", "ai_task", "business_entry", "subflow", "options", "api", "end", ...SYSTEM_NODES, ...VOICE_NODES],
      message: ["user_input", "router", "semantic_router", "schedule_router", "set_variable", "handoff", "ai", "rag_answer", "ai_task", "business_entry", "subflow", "options", "api", "fallback", "end", ...SYSTEM_NODES, ...VOICE_NODES],
      user_input: ["router", "semantic_router", "schedule_router", "message", "set_variable", "handoff", "ai", "rag_answer", "ai_task", "business_entry", "subflow", "options", "api", "fallback", "end", ...SYSTEM_NODES, ...VOICE_NODES],
      options: ["router", "semantic_router", "schedule_router", "message", "set_variable", "handoff", "ai", "rag_answer", "ai_task", "business_entry", "subflow", "api", "fallback", "end", ...SYSTEM_NODES, ...VOICE_NODES],
      api: ["message", "user_input", "router", "semantic_router", "schedule_router", "set_variable", "handoff", "subflow", "options", "business_entry", "fallback", "end", ...SYSTEM_NODES, ...VOICE_NODES],
      router: ["message", "user_input", "router", "semantic_router", "schedule_router", "set_variable", "handoff", "ai", "rag_answer", "ai_task", "business_entry", "subflow", "options", "api", "fallback", "end", ...SYSTEM_NODES, ...VOICE_NODES],
      semantic_router: ["message", "user_input", "router", "semantic_router", "schedule_router", "set_variable", "handoff", "ai", "rag_answer", "ai_task", "business_entry", "subflow", "options", "api", "fallback", "end", ...SYSTEM_NODES, ...VOICE_NODES],
      schedule_router: ["message", "user_input", "router", "semantic_router", "schedule_router", "set_variable", "handoff", "ai", "rag_answer", "ai_task", "business_entry", "subflow", "options", "api", "fallback", "end", ...SYSTEM_NODES, ...VOICE_NODES],
      set_variable: ["message", "user_input", "router", "semantic_router", "schedule_router", "handoff", "ai", "rag_answer", "ai_task", "business_entry", "subflow", "options", "api", "fallback", "end", ...SYSTEM_NODES, ...VOICE_NODES],
      ai: ["message", "user_input", "router", "semantic_router", "schedule_router", "set_variable", "handoff", "business_entry", "subflow", "options", "api", "fallback", "end", ...SYSTEM_NODES, ...VOICE_NODES],
      rag_answer: ["message", "user_input", "router", "semantic_router", "schedule_router", "set_variable", "handoff", "business_entry", "subflow", "options", "api", "fallback", "end", ...SYSTEM_NODES, ...VOICE_NODES],
      ai_task: ["message", "user_input", "router", "semantic_router", "schedule_router", "set_variable", "handoff", "business_entry", "subflow", "options", "api", "fallback", "end", ...SYSTEM_NODES, ...VOICE_NODES],
      business_entry: ["router", "semantic_router", "schedule_router", "message", "set_variable", "handoff", "ai", "rag_answer", "ai_task", "subflow", "options", "api", "fallback", "end", ...SYSTEM_NODES, ...VOICE_NODES],
      subflow: ["router", "semantic_router", "schedule_router", "message", "user_input", "set_variable", "handoff", "ai", "rag_answer", "ai_task", "business_entry", "subflow", "options", "api", "fallback", "end", ...SYSTEM_NODES, ...VOICE_NODES],
      handoff: ["end"],
      fallback: ["message", "handoff", "end"],
      // merge é um nó estrutural no-op; permitimos que ele se comporte como um pass-through.
      // (Mesma matriz de saída de 'message', sem exigir config.)
      merge: ["message", "user_input", "router", "semantic_router", "schedule_router", "set_variable", "handoff", "ai", "rag_answer", "ai_task", "business_entry", "subflow", "options", "api", "fallback", "end", ...SYSTEM_NODES_EXCEPT_MERGE, ...VOICE_NODES],
      get_flow_info: ["message", "user_input", "router", "schedule_router", "set_variable", "handoff", "ai", "ai_task", "end", ...VOICE_NODES],
      get_queue_status: ["message", "user_input", "router", "schedule_router", "set_variable", "handoff", "ai", "ai_task", "end", ...VOICE_NODES],
      get_config_value: ["message", "user_input", "router", "schedule_router", "set_variable", "handoff", "ai", "ai_task", "end", ...VOICE_NODES],
      list_flows: ["message", "user_input", "router", "schedule_router", "set_variable", "handoff", "ai", "ai_task", "end", ...VOICE_NODES],
      get_current_time: ["message", "user_input", "router", "schedule_router", "set_variable", "handoff", "ai", "ai_task", "end", ...VOICE_NODES],
      generate_uuid: ["message", "user_input", "router", "schedule_router", "set_variable", "handoff", "ai", "ai_task", "end", ...VOICE_NODES],
      delay: ["message", "user_input", "router", "schedule_router", "set_variable", "handoff", "ai", "ai_task", "end", ...VOICE_NODES],
      format_date: ["message", "user_input", "router", "schedule_router", "set_variable", "handoff", "ai", "ai_task", "end", ...VOICE_NODES],
      random_number: ["message", "user_input", "router", "schedule_router", "set_variable", "handoff", "ai", "ai_task", "end", ...VOICE_NODES],
      get_user_info: ["message", "user_input", "router", "schedule_router", "set_variable", "handoff", "ai", "ai_task", "end", ...VOICE_NODES],
      end: []
    };
    module.exports = {
      TYPE_COMPATIBILITY
    };
  }
});
export default require_typeCompatibility();
//# sourceMappingURL=_app_engine_utils_typeCompatibility__js.js.map
