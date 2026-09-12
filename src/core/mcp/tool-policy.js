'use strict';

/**
 * MCP Tool Policy — política POR TOOL para tools de MCP externo.
 *
 * Problema que este módulo resolve: uma tool externa recebia política GENÉRICA
 * (`riskLevel: 'medium'`, `sideEffects: true`, `confirmationPolicy:
 * 'policy_based'`). Isso trata `calendar.listEvents` (leitura, risco baixo) e
 * `payments.refund` (mutação financeira irreversível) como a mesma coisa —
 * ou bloqueia leitura legítima, ou libera mutação destrutiva.
 *
 * Aqui a política é DERIVADA de sinais declarados e AUDITÁVEL:
 *
 *   declaration (explícita, por tool)      ← autoridade
 *     │  senão
 *   heurística por nome + annotations MCP  ← conservadora
 *     │  senão
 *   default fail-safe (read → low, mutation → high)
 *
 * Guardas adicionais:
 *  - `mcp_remote_*` (annotations do servidor remoto) são DADOS não confiáveis:
 *    podem CONFIRMAR risco, nunca REDUZIR o que a declaração local exige.
 *  - Descrição remota é METADATA: nunca vira instrução de sistema
 *    (prompt injection / malicious tool description).
 *  - Tool de mutação sem `idempotencyPolicy` explícito nunca é tratada como
 *    reexecutável — evita retry cego de operação ambígua.
 */

const RISK_LEVELS = Object.freeze(['low', 'medium', 'high']);
const CONFIRMATION_POLICIES = Object.freeze(['autonomous', 'policy_based', 'confirmation_required']);
const IDEMPOTENCY_POLICIES = Object.freeze(['none', 'recommended', 'required']);

/** Verbos que indicam MUTAÇÃO (side effect real). */
const MUTATION_VERBS = Object.freeze(new Set([
  'create', 'update', 'delete', 'remove', 'set', 'send', 'post', 'put', 'patch',
  'refund', 'cancel', 'charge', 'pay', 'transfer', 'publish', 'schedule',
  'assign', 'close', 'open', 'archive', 'import', 'upload', 'write', 'execute',
  'run', 'start', 'stop', 'restart', 'deploy', 'approve', 'reject', 'sign',
  'revoke', 'grant', 'invite', 'disable', 'enable', 'enablement',
]));

/** Verbos que indicam LEITURA sem efeito. */
const READ_VERBS = Object.freeze(new Set([
  'get', 'list', 'read', 'search', 'find', 'query', 'fetch', 'describe',
  'inspect', 'status', 'health', 'summary', 'history', 'lookup', 'count',
  'export', 'download', 'preview', 'check', 'view', 'report', 'metrics',
]));

/** Domínios de alto risco: mutação aqui exige confirmação explícita. */
const HIGH_RISK_TOKENS = Object.freeze(new Set([
  'payment', 'payments', 'billing', 'invoice', 'invoices', 'refund', 'refunds',
  'charge', 'charges', 'pix', 'wallet', 'transfer', 'payroll', 'subscription',
  'cancel', 'delete', 'purge', 'drop', 'terminate', 'revoke', 'credential',
  'credentials', 'secret', 'secrets', 'permission', 'permissions', 'role', 'roles',
]));

/** Padrões de alto risco compostos que não sobrevivem à tokenização. */
const HIGH_RISK_PATTERN = /(payment|billing|invoice|refund|charge|pix|wallet|transfer|payroll|subscription|cancel|delete|purge|drop|terminate|revoke|credential|secret|permission|role)/i;

/**
 * Tokeniza o nome de uma tool em palavras: separa camelCase, snake_case,
 * kebab-case e dot.notation. `listEvents` → ['list','events'];
 * `payments.refund` → ['payments','refund'].
 */
function tokenizeToolName(name) {
  return String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

/**
 * Declara o papel do verbo principal do nome da tool.
 * O PRIMEIRO token é a autoridade quando é um verbo conhecido — assim
 * `getRunHistory` é leitura (não mutação por causa de `run`), e
 * `refundPayment` é mutação (não leitura).
 */
function inferVerbRole(tokens) {
  const first = tokens[0] || '';
  if (READ_VERBS.has(first)) return 'read';
  if (MUTATION_VERBS.has(first)) return 'mutation';
  if (tokens.some((token) => MUTATION_VERBS.has(token))) return 'mutation';
  if (tokens.some((token) => READ_VERBS.has(token))) return 'read';
  return null;
}

function looksHighRisk(toolName, tokens) {
  if (tokens.some((token) => HIGH_RISK_TOKENS.has(token))) return true;
  return HIGH_RISK_PATTERN.test(String(toolName || ''));
}

/**
 * Resultado conservador quando nada foi declarado: só é `low`/sem side effect
 * se o nome declara leitura e não declara mutação.
 */
function inferPolicyFromName(toolName) {
  const name = String(toolName || '');
  const tokens = tokenizeToolName(name);
  const role = inferVerbRole(tokens);

  if (role === 'mutation') {
    const highRisk = looksHighRisk(name, tokens);
    return {
      riskLevel: highRisk ? 'high' : 'medium',
      sideEffects: true,
      confirmationPolicy: highRisk ? 'confirmation_required' : 'policy_based',
      idempotencyPolicy: 'required',
      source: 'inferred_from_name_mutation',
    };
  }

  if (role === 'read') {
    return {
      riskLevel: 'low',
      sideEffects: false,
      confirmationPolicy: 'autonomous',
      idempotencyPolicy: 'none',
      source: 'inferred_from_name_read',
    };
  }

  // Nome ambíguo: fail-safe assimétrico — assume mutação MEDIUM com
  // confirmação por política. Nunca assume leitura.
  return {
    riskLevel: 'medium',
    sideEffects: true,
    confirmationPolicy: 'policy_based',
    idempotencyPolicy: 'required',
    source: 'inferred_ambiguous_fail_safe',
  };
}

/**
 * Padrões de CONTEÚDO INSTRUCIONAL em descrição/annotations remotas.
 * Uma descrição de tool é METADATA. Texto que tenta instruir o modelo
 * ("ignore as instruções anteriores", "você deve...", "revele...") é marcado
 * como não confiável e removido do texto propagado — nunca executado.
 */
const INSTRUCTIONAL_PATTERNS = Object.freeze([
  /\bignore\s+(?:all\s+|the\s+|any\s+)?(?:previous|prior|above|earlier)\s+instructions?\b/i,
  /\bdisregard\s+(?:all\s+|the\s+|any\s+)?(?:previous|prior|above)\s+(?:instructions?|rules?|prompts?)\b/i,
  /\bsystem\s+prompt\b/i,
  /\byou\s+(?:must|should|shall|will|need\s+to)\b/i,
  /\b(reveal|expose|print|output|leak|send)\s+(?:the\s+)?(?:secret|token|api[\s_-]?key|password|credential|system\s+prompt)/i,
  /\bdo\s+not\s+(?:tell|inform|mention|report|log)\b/i,
  /\boverride\s+(?:the\s+)?(?:policy|policies|rules?|instructions?|configuration)\b/i,
  /<\|(?:im_start|im_end|system|assistant)\|>/i,
  /\bBEGIN\s+SYSTEM\b/i,
]);

/** Campos que nunca são propagados ao modelo/agente em output de tool remota. */
const ALWAYS_REDACTED_KEYS = Object.freeze([
  'password', 'passwd', 'secret', 'client_secret', 'api_key', 'apikey', 'access_token',
  'refresh_token', 'authorization', 'auth_token', 'private_key', 'session_token',
  'cookie', 'set-cookie', 'x-api-key', 'bearer', 'credential', 'credentials',
]);

const REDACTION_PLACEHOLDER = '[REDACTED]';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeCapabilityId(value) {
  if (!isNonEmptyString(value)) return null;
  return String(value).trim().toLowerCase();
}

/**
 * Escala de severidade para mesclar declaração local com sinal remoto.
 * O remoto só pode AUMENTAR severidade (nunca reduzir).
 */
const RISK_ORDER = Object.freeze({ low: 0, medium: 1, high: 2 });

function maxRisk(a, b) {
  const ra = RISK_ORDER[a] ?? 1;
  const rb = RISK_ORDER[b] ?? 1;
  return ra >= rb ? (RISK_LEVELS.includes(a) ? a : 'medium') : (RISK_LEVELS.includes(b) ? b : 'medium');
}

/**
 * Resolve a política efetiva de uma tool externa.
 *
 * @param {object} args
 * @param {string} args.toolName
 * @param {object} [args.declaration]  política declarada LOCALMENTE para a tool
 * @param {object} [args.remoteAnnotations]  annotations do servidor remoto (dados)
 * @param {string} [args.classification]     classificação da conexão
 * @returns {object} política efetiva + proveniência por campo
 */
function resolveToolPolicy({ toolName, declaration = null, remoteAnnotations = null, classification = 'PRODUCTION' } = {}) {
  if (!isNonEmptyString(toolName)) throw new Error('mcp_tool_policy_tool_name_required');
  const decl = declaration && typeof declaration === 'object' ? declaration : {};
  const remote = remoteAnnotations && typeof remoteAnnotations === 'object' ? remoteAnnotations : {};

  const inferred = inferPolicyFromName(toolName);
  const provenance = {};

  function pick(field, fallback) {
    if (decl[field] !== undefined && decl[field] !== null) {
      provenance[field] = 'declared';
      return decl[field];
    }
    provenance[field] = inferred.source;
    return fallback;
  }

  let riskLevel = pick('riskLevel', inferred.riskLevel);
  let sideEffects = pick('sideEffects', inferred.sideEffects);
  let confirmationPolicy = pick('confirmationPolicy', inferred.confirmationPolicy);
  let idempotencyPolicy = pick('idempotencyPolicy', inferred.idempotencyPolicy);

  // Sinal remoto: `destructiveHint`/`readOnlyHint` são DADOS. Podem elevar
  // risco/side effect; nunca reduzir o que foi declarado localmente.
  if (remote.destructiveHint === true) {
    riskLevel = maxRisk(riskLevel, 'high');
    sideEffects = true;
    confirmationPolicy = 'confirmation_required';
    idempotencyPolicy = 'required';
    provenance.remoteSignal = 'destructiveHint_elevated';
  } else if (remote.readOnlyHint === true && decl.sideEffects === undefined && !inferred.sideEffects) {
    // readOnlyHint só é aceito quando o nome também é de leitura e não houve
    // declaração local que afirme side effect.
    provenance.remoteSignal = 'readOnlyHint_accepted_low_risk';
  } else if (remote.readOnlyHint === true && (decl.sideEffects === true || inferred.sideEffects)) {
    provenance.remoteSignal = 'readOnlyHint_ignored_conflicts_with_local';
  }

  // Coerência: side effect de risco high nunca fica autônomo.
  if (sideEffects === true && riskLevel === 'high' && confirmationPolicy === 'autonomous') {
    confirmationPolicy = 'confirmation_required';
    provenance.coherence = 'high_risk_autonomous_promoted_to_confirmation_required';
  }
  // Mutação sem idempotência declarada não é reexecutável.
  if (sideEffects === true && idempotencyPolicy === 'none') {
    idempotencyPolicy = 'recommended';
    provenance.coherence = 'mutation_without_idempotency_promoted';
  }

  if (!RISK_LEVELS.includes(riskLevel)) riskLevel = 'medium';
  if (!CONFIRMATION_POLICIES.includes(confirmationPolicy)) confirmationPolicy = 'policy_based';
  if (!IDEMPOTENCY_POLICIES.includes(idempotencyPolicy)) idempotencyPolicy = 'recommended';

  const sensitivity = isNonEmptyString(decl.sensitivity)
    ? decl.sensitivity
    : (HIGH_RISK_PATTERN.test(toolName) ? 'HIGH' : 'NORMAL');

  return Object.freeze({
    toolName: String(toolName),
    riskLevel,
    sideEffects: sideEffects === true,
    confirmationPolicy,
    idempotencyPolicy,
    executionMode: isNonEmptyString(decl.executionMode) ? decl.executionMode : (sideEffects === true ? 'durable' : 'atomic'),
    classification: String(classification || 'PRODUCTION').toUpperCase(),
    sensitivity,
    timeoutMs: Number.isFinite(Number(decl.timeoutMs)) ? Number(decl.timeoutMs) : null,
    retryPolicy: {
      // Retry só é seguro em operação sem efeito ou explicitamente idempotente.
      attempts: sideEffects === true
        ? (idempotencyPolicy === 'required' && decl.retryPolicy?.attempts ? Number(decl.retryPolicy.attempts) : 1)
        : (Number(decl.retryPolicy?.attempts) || 2),
    },
    redactionPolicy: {
      alwaysRedactKeys: [...ALWAYS_REDACTED_KEYS],
      redactFinancialIdentifiers: sensitivity === 'HIGH' || /billing|payment|invoice|card/i.test(toolName),
      ...(decl.redactionPolicy && typeof decl.redactionPolicy === 'object' ? decl.redactionPolicy : {}),
    },
    provenance,
  });
}

/**
 * Detecta conteúdo instrucional em texto remoto.
 * @returns {{detected: boolean, matches: string[]}}
 */
function detectInstructionalContent(text) {
  const value = typeof text === 'string' ? text : '';
  if (!value) return { detected: false, matches: [] };
  const matches = [];
  for (const pattern of INSTRUCTIONAL_PATTERNS) {
    const found = value.match(pattern);
    if (found) matches.push(found[0]);
  }
  return { detected: matches.length > 0, matches };
}

/**
 * Sanitiza a descrição de uma tool remota.
 *
 * A descrição é METADATA exibida ao agente — nunca instrução. Conteúdo
 * instrucional é removido e o resultado é marcado `trusted: false`, para que
 * nenhum consumidor o trate como policy.
 *
 * @returns {{text: string, trusted: false, removedInstructional: string[], truncated: boolean}}
 */
function sanitizeRemoteDescription(description, { maxLength = 300 } = {}) {
  const raw = typeof description === 'string' ? description : '';
  const { detected, matches } = detectInstructionalContent(raw);
  let text = raw;

  if (detected) {
    // Remove as sentenças que contêm instrução (não o texto inteiro: a
    // descrição ainda pode informar o que a tool faz).
    const sentences = raw.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((sentence) => !detectInstructionalContent(sentence).detected);
    text = kept.join(' ').trim();
  }

  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const truncated = text.length > maxLength;
  if (truncated) text = `${text.slice(0, maxLength)}…`;

  return Object.freeze({
    text: text || `(descrição remota suprimida: ${matches.length} trecho(s) instrucional(is))`,
    trusted: false,
    removedInstructional: matches,
    truncated,
  });
}

/**
 * Redige um objeto de output de tool remota antes de devolvê-lo ao
 * agente/modelo (nunca vaza credencial nem identificador financeiro bruto).
 * Recursivo, com proteção contra ciclo e profundidade.
 */
function redactToolOutput(value, { policy, depth = 0, seen = new WeakSet() } = {}) {
  const redactionPolicy = policy?.redactionPolicy || { alwaysRedactKeys: [...ALWAYS_REDACTED_KEYS], redactFinancialIdentifiers: false };
  const keys = new Set((redactionPolicy.alwaysRedactKeys || ALWAYS_REDACTED_KEYS).map((k) => String(k).toLowerCase()));
  const maxDepth = 12;

  function walk(node, d) {
    if (node === null || node === undefined) return node;
    if (d > maxDepth) return '[TRUNCATED_DEPTH]';
    if (typeof node === 'string') {
      if (redactionPolicy.redactFinancialIdentifiers) {
        // PAN (13–19 dígitos) e chaves longas opacas não são propagadas.
        return node
          .replace(/\b\d{13,19}\b/g, REDACTION_PLACEHOLDER)
          .replace(/\b(?:sk|pk|ghp|xox[baprs])_[A-Za-z0-9_-]{16,}\b/g, REDACTION_PLACEHOLDER);
      }
      return node;
    }
    if (typeof node !== 'object') return node;
    if (seen.has(node)) return '[CYCLE]';
    seen.add(node);

    if (Array.isArray(node)) return node.map((item) => walk(item, d + 1));
    const out = {};
    for (const [key, val] of Object.entries(node)) {
      if (keys.has(String(key).toLowerCase())) {
        out[key] = REDACTION_PLACEHOLDER;
        continue;
      }
      out[key] = walk(val, d + 1);
    }
    return out;
  }

  return walk(value, depth);
}

module.exports = {
  RISK_LEVELS,
  CONFIRMATION_POLICIES,
  IDEMPOTENCY_POLICIES,
  ALWAYS_REDACTED_KEYS,
  REDACTION_PLACEHOLDER,
  MUTATION_VERBS,
  READ_VERBS,
  HIGH_RISK_TOKENS,
  HIGH_RISK_PATTERN,
  INSTRUCTIONAL_PATTERNS,
  tokenizeToolName,
  inferVerbRole,
  normalizeCapabilityId,
  inferPolicyFromName,
  resolveToolPolicy,
  detectInstructionalContent,
  sanitizeRemoteDescription,
  redactToolOutput,
};
