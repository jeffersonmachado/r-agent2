'use strict';

/**
 * engine/engineeringRouter/constants.js — vocabulário fechado do Engineering Model Router V1.
 *
 * Módulo puro (sem I/O). Fonte única de verdade para os enums usados pelo classifier, pela
 * routing policy, pelo model selector e pela state machine. Não codifica vendor nenhum aqui —
 * ver `modelCapabilities.js` para o mapeamento provider:model → capability.
 */

const TASK_TYPES = Object.freeze([
  'CODE_GENERATION',
  'BUG_FIX',
  'COMPLEX_BUG_FIX',
  'REFACTOR',
  'TEST_GENERATION',
  'CODE_REVIEW',
  'SECURITY_REVIEW',
  'DATABASE_CHANGE',
  'FRONTEND',
  'DOCKER_INFRA',
  'GOVERNANCE',
  'RELEASE',
  'REPOSITORY_AUDIT',
]);

const RISK_LEVELS = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const RISK_RANK = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 });

const TASK_SCOPES = Object.freeze(['SMALL', 'MEDIUM', 'LARGE', 'REPOSITORY_WIDE']);

const CAPABILITIES = Object.freeze([
  'CODING',
  'DEBUGGING',
  'CODE_REVIEW',
  'TEST_GENERATION',
  'LONG_CONTEXT',
  'TOOL_USE',
  'ARCHITECTURE',
  'SECURITY_REVIEW',
  'REPOSITORY_AUDIT',
  'DOCKER_INFRA',
  'DATABASE',
  'FRONTEND',
  'GOVERNANCE',
  'RELEASE',
]);

// Papéis de modelo. CODER/REVIEWER são o loop de correção do Router; ENRICHER é o papel usado
// pelo Engineering Mission Compiler (enriquecimento de missão) — o mesmo `selectForRole` do
// `modelSelector.js` é reutilizado, nenhum seletor paralelo é criado.
const MODEL_ROLES = Object.freeze(['CODER', 'REVIEWER', 'ENRICHER']);

const COST_CLASSES = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'ANY']);
const CONTEXT_CLASSES = Object.freeze(['STANDARD', 'LONG', 'EXTENDED']);

/**
 * Estados da EngineeringTask (state machine). Transições válidas ficam em `stateMachine.js`.
 */
const TASK_STATES = Object.freeze([
  'CREATED',
  'CLASSIFIED',
  'ROUTED',
  'CODING',
  'TESTING',
  'REVIEWING',
  'REGRESSION',
  'GOVERNANCE',
  // ER-V1-SEAL-002 (Full Durable Resume): fases explícitas para o trecho mais crítico do loop —
  // sem elas, um crash entre "governance passou" e "candidate commit criado" (ou entre
  // "candidate commit criado" e "smoke pós-promoção confirmado") não tinha nenhum estado
  // persistido distinto para o reconciliador agir; o restart só via GOVERNANCE ainda como
  // status corrente e reexecutava promoteValidatedPatch do zero, arriscando promover duas vezes.
  'PROMOTING',
  'POST_PROMOTION_VERIFY',
  'GREEN',
  // ERV1-CLOSE-005: distinto de GREEN — CODER/TESTE/REVIEW/REGRESSION/GOVERNANCE passaram de
  // verdade, mas a promoção do patch validado ao repositório real não completou (target
  // divergiu, smoke pós-promoção falhou, etc.). Nunca finge GREEN quando isso acontece.
  'READY_FOR_PROMOTION',
  'RED',
  'BLOCKED',
  'CANCELLED',
]);

const TERMINAL_STATES = Object.freeze(['GREEN', 'READY_FOR_PROMOTION', 'RED', 'BLOCKED', 'CANCELLED']);

/**
 * Reason codes estruturados para decisões de roteamento — nunca texto livre gerado por LLM.
 */
const REASON_CODES = Object.freeze({
  CAPABILITY_MATCH: 'CAPABILITY_MATCH',
  CAPABILITY_MISSING: 'CAPABILITY_MISSING',
  CONTEXT_MATCH: 'CONTEXT_MATCH',
  PROVIDER_HEALTHY: 'PROVIDER_HEALTHY',
  PROVIDER_UNHEALTHY: 'PROVIDER_UNHEALTHY',
  PROVIDER_DISABLED: 'PROVIDER_DISABLED',
  PROVIDER_NO_CREDENTIAL: 'PROVIDER_NO_CREDENTIAL',
  POLICY_PRIORITY: 'POLICY_PRIORITY',
  LOWER_COST_AMONG_QUALIFIED: 'LOWER_COST_AMONG_QUALIFIED',
  INDEPENDENT_PROVIDER_APPLIED: 'INDEPENDENT_PROVIDER_APPLIED',
  INDEPENDENT_PROVIDER_UNAVAILABLE: 'INDEPENDENT_PROVIDER_UNAVAILABLE',
  NO_QUALIFIED_CANDIDATE: 'NO_QUALIFIED_CANDIDATE',
  // ERV1-CLOSE-008: modelo com falha real recente (404/retirado/auth negada) — provider pode
  // estar healthy (breaker fechado) e mesmo assim este modelId específico não funcionar.
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  // HUMAN_EXTERNAL_BOOTSTRAP (2026-10-07): o modelo foi escolhido porque JÁ ENTREGOU patch
  // aplicado em tasks da MESMA classe (task_type) — prioridade por evidência histórica, nunca
  // por nome/modelo fixo. Só é aplicado depois de falha determinística de um candidato anterior.
  PROVEN_FOR_TASK_CLASS: 'PROVEN_FOR_TASK_CLASS',
  // Confiabilidade comprovada: o candidato está na faixa PROVEN (já entregou patch aplicado na
  // mesma classe de tarefa) segundo a evidência agregada — distinto de PROVEN_FOR_TASK_CLASS,
  // que registra a APLICAÇÃO explícita dessa prioridade na seleção corrente.
  RELIABILITY_PROVEN: 'RELIABILITY_PROVEN',
});

const FAILURE_CODES = Object.freeze({
  PATCH_OUTSIDE_ALLOWED_SCOPE: 'PATCH_OUTSIDE_ALLOWED_SCOPE',
  PATCH_INVALID_FORMAT: 'PATCH_INVALID_FORMAT',
  // HUMAN_EXTERNAL_BOOTSTRAP (2026-10-07): corpo de hunk SEM prefixo de unified diff ('+', '-' ou
  // ' '). Achado real medido: o coder `qwen:qwen3-coder-flash` emite o cabecalho do diff correto
  // (diff --git / --- / +++ / @@) e o CORPO sem nenhum prefixo — `git apply` rejeita o patch inteiro
  // com "patch corrompido". Antes desta correcao a plataforma so descobria isso no apply, com
  // PATCH_APPLY_FAILED (sem reroute); agora e rejeitado ANTES, de forma deterministica e especifica.
  // NUNCA reparado heuristicamente: adivinhar quais linhas sao contexto/adiçao mudaria a semantica
  // do patch em silencio.
  PATCH_BODY_MISSING_PREFIX: 'PATCH_BODY_MISSING_PREFIX',
  PATCH_FORBIDDEN_FILE: 'PATCH_FORBIDDEN_FILE',
  // SECURITY (2026-10-08): o diff GERADO pelo modelo contém um valor com forma de segredo real
  // (chave de provider, token de SCM, bloco de chave privada). Achado de auditoria: a redação de
  // segredos só existia no CONTEXTO DE ENTRADA (contextBuilderService) e na SAÍDA DE COMANDOS
  // (testRunnerService) — o patch do CODER ia direto para validação/aplicação/persistência, com a
  // única defesa sendo a instrução no prompt e a proteção por NOME de arquivo. Um segredo literal
  // commitado num arquivo de nome inocente passava por tudo.
  PATCH_CONTAINS_SECRET: 'PATCH_CONTAINS_SECRET',
  PATCH_BINARY_CHANGE: 'PATCH_BINARY_CHANGE',
  PATCH_TOO_LARGE: 'PATCH_TOO_LARGE',
  PATCH_UNEXPECTED_DELETE: 'PATCH_UNEXPECTED_DELETE',
  // ESCAPE DE ISOLAMENTO VIA SYMLINK (medido 2026-10-21): um diff com
  // `new file mode 120000` cria um SYMLINK no worktree. O caminho tocado continua
  // dentro do allowedPaths, mas o ALVO do link pode ser `/etc/shadow` ou
  // `../../.env` — `git apply` aceita, o arquivo nasce como symlink real e qualquer
  // leitura/escrita através dele sai do escopo. A fronteira de path não vê isso
  // porque ela olha o NOME do arquivo, não o destino do link. Recusado antes do apply.
  PATCH_SYMLINK_FORBIDDEN: 'PATCH_SYMLINK_FORBIDDEN',
  // MUTILACAO DE WORKTREE (2026-10-20): o patch APAGA casos de teste para fazer
  // a suite passar, em vez de corrigir o comportamento. Recusado antes do apply;
  // autorizacao so por campo explicito de contrato aprovado por humano.
  PATCH_REMOVES_TESTS: 'PATCH_REMOVES_TESTS',
  PATCH_APPLY_FAILED: 'PATCH_APPLY_FAILED',
  // SPEC JÁ SATISFEITA NO FIX (decisão arquitetural 2026-10-29). Quando a missão é retomada
  // depois que a correção foi integrada na fonte, a task substituta nasce sobre um commit onde o
  // cenário da spec JÁ passa. Invocar o coder nesse estado é trabalho inventado: o modelo devolve
  // um patch do que já existe e o `git apply` o recusa (PATCH_CONTRACT_VIOLATION), o que virava
  // RED e — pior — RECORRÊNCIA falsa do finding recém-fechado. O Router verifica a spec antes de
  // codificar e conclui GREEN sem patch e sem chamar o coder, registrando este código.
  SPEC_ALREADY_SATISFIED: 'SPEC_ALREADY_SATISFIED',
  ENGINEERING_TASK_EXHAUSTED: 'ENGINEERING_TASK_EXHAUSTED',
  COMMAND_NOT_ALLOWED: 'COMMAND_NOT_ALLOWED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  TASK_ALREADY_RUNNING: 'TASK_ALREADY_RUNNING',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  // ERV1-CLOSE-008: reroute esgotou todos os candidatos qualificados restantes (diferente de
  // NO_QUALIFIED_CODER, que é quando não havia NENHUM candidato desde o início do roteamento).
  NO_ALTERNATIVE_CANDIDATE: 'NO_ALTERNATIVE_CANDIDATE',
  // ERV1-CLOSE-004: REGRESSION/GOVERNANCE agora são checagens reais que podem reprovar — nunca
  // são só uma transição de status decorativa.
  REGRESSION_FAILED: 'REGRESSION_FAILED',
  GOVERNANCE_FAILED: 'GOVERNANCE_FAILED',
  // ER-V1-FINAL-003: allowedPaths vazio/ausente NUNCA mais significa "tudo permitido" por
  // omissão — fail-closed explícito, distinto de PATCH_OUTSIDE_ALLOWED_SCOPE (que é sobre um
  // caminho específico fora de um escopo DECLARADO; NO_PATCH_SCOPE é sobre a AUSÊNCIA total de
  // escopo declarado).
  NO_PATCH_SCOPE: 'NO_PATCH_SCOPE',
  // Arquitetura de timeouts (2026-09-28): expiração de OPERAÇÃO nunca vira falha genérica.
  //   PROVIDER_EXHAUSTED  — orçamento de tentativas/tempo da cadeia de providers esgotado
  //                          (fallback terminou sem sucesso) ⇒ BLOCKED, nunca crash;
  //   BLOCKED_INFRA       — infraestrutura indisponível (sandbox/runner/banco) ⇒ BLOCKED;
  //   TASK_LEASE_LOST     — o worker perdeu a posse (outro dono com fence maior) ⇒ para de
  //                          escrever imediatamente; quem continua é o novo dono.
  PROVIDER_EXHAUSTED: 'PROVIDER_EXHAUSTED',
  BLOCKED_INFRA: 'BLOCKED_INFRA',
  TASK_LEASE_LOST: 'TASK_LEASE_LOST',
});

/**
 * Semântica de resultado de comando/teste. `timedOut=true` NUNCA é achatado em FAIL: FAIL indica
 * bug (o código rodou e reprovou); TIMEOUT indica que a operação não terminou dentro do deadline
 * (retry/deadline adaptativo/restart do child); INFRA_ERROR indica que nem rodou (BLOCKED_INFRA).
 */
const TEST_OUTCOMES = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  TIMEOUT: 'TIMEOUT',
  BLOCKED: 'BLOCKED',
  INFRA_ERROR: 'INFRA_ERROR',
});

const FINDING_SEVERITIES = Object.freeze(['BLOCKER', 'REGRESSION', 'POST_RELEASE']);

/**
 * ER-V1-FINAL-008 (Current Model Catalog): estados do ciclo de vida de um `providerId:modelId`
 * no catálogo governado. Um modelo NUNCA pula direto de DISCOVERED/UNCLASSIFIED para elegível —
 * `modelCapabilities.js` (allowlist estática versionada em código) continua sendo a ÚNICA fonte
 * de verdade sobre o que é elegível para o Router; o catálogo é a camada de GOVERNANÇA/AUDITORIA
 * sobre o que o discovery real encontra, nunca uma segunda fonte de elegibilidade.
 *   DISCOVERED   — provider real listou este modelId e ele NÃO está na allowlist estática.
 *   UNCLASSIFIED — sinônimo operacional de DISCOVERED sem capability atribuída (nunca elegível).
 *   CLASSIFIED   — capability/role atribuída por revisão explícita, ainda não promovido ao código.
 *   APPROVED     — presente na allowlist estática (`modelCapabilities.js`) — elegível.
 *   RETIRED      — estava na allowlist estática, mas o discovery real confirmou que o provider
 *                  não lista mais este modelId para a credencial configurada.
 *   UNAVAILABLE  — indisponibilidade reativa (falha real de runtime), não uma confirmação
 *                  proativa de remoção pelo provider — ver `modelAvailabilityStore.js`.
 *   DENIED       — bloqueado explicitamente por decisão humana/política, mesmo que o provider
 *                  ainda o liste.
 */
const MODEL_CATALOG_STATUSES = Object.freeze([
  'DISCOVERED',
  'UNCLASSIFIED',
  'CLASSIFIED',
  'APPROVED',
  'RETIRED',
  'UNAVAILABLE',
  'DENIED',
]);

const REVIEW_DECISIONS = Object.freeze(['APPROVE', 'REJECT']);

module.exports = {
  TASK_TYPES,
  RISK_LEVELS,
  RISK_RANK,
  TASK_SCOPES,
  CAPABILITIES,
  MODEL_ROLES,
  COST_CLASSES,
  CONTEXT_CLASSES,
  TASK_STATES,
  TERMINAL_STATES,
  TEST_OUTCOMES,
  REASON_CODES,
  FAILURE_CODES,
  FINDING_SEVERITIES,
  REVIEW_DECISIONS,
  MODEL_CATALOG_STATUSES,
};
