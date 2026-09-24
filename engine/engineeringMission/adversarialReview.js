'use strict';

/**
 * engine/engineeringMission/adversarialReview.js — Adversarial Review (§24) como CATÁLOGO
 * executável, não como prompt.
 *
 * "Adversarial review não pode ser apenas um prompt dizendo 'procure problemas'." Cada ataque aqui
 * é um caso CONCRETO com:
 *   - o alvo (qual invariante ele tenta quebrar);
 *   - a defesa esperada (o que deve impedi-lo);
 *   - o TESTE PERMANENTE que prova a defesa (arquivo + nome do caso).
 *
 * O valor de governança: um ataque sem teste permanente é reportado como `UNCOVERED`, com
 * severidade, e — por política — impede GREEN até ser convertido em teste. Assim o catálogo é um
 * backlog executável, não uma lista de intenções.
 *
 * Módulo puro: o acesso ao sistema de arquivos é INJETADO (`hasTest`), para que a avaliação seja
 * testável sem I/O.
 */

const ADVERSARIAL_REVIEW_ENGINE_VERSION = '1.0.0';

/**
 * @typedef {Object} AdversarialCase
 * @property {string} id
 * @property {string} attack            caso concreto de ataque
 * @property {string} target            invariante atacada
 * @property {string} defense           defesa esperada
 * @property {string} severity          BLOCKER | REGRESSION | POST_RELEASE
 * @property {{path: string, namePattern: string}|null} permanentTest
 */

/** @type {ReadonlyArray<AdversarialCase>} */
const ADVERSARIAL_CASES = Object.freeze([
  {
    id: 'ADV-01',
    attack: 'executar a mesma missão duas vezes em paralelo',
    target: 'uma única EngineeringTask por (mission, versão)',
    defense: 'idempotency_key `mission:<id>:v<versão>` + tratamento de UniqueConstraintError',
    severity: 'BLOCKER',
    permanentTest: { path: 'tests/integration/engineeringMissionGovernanceAndConcurrency.test.js', namePattern: 'duas execuções concorrentes produzem UMA EngineeringTask' },
  },
  {
    id: 'ADV-02',
    attack: 'aprovar a mesma versão duas vezes em paralelo (race)',
    target: 'uma única decisão por (mission, versão)',
    defense: 'unicidade (mission_id, spec_version) + atualização de linha com histórico',
    severity: 'BLOCKER',
    permanentTest: { path: 'tests/integration/engineeringMissionGovernanceAndConcurrency.test.js', namePattern: 'duas aprovações concorrentes produzem UMA decisão' },
  },
  {
    id: 'ADV-03',
    attack: 'aprovar e executar sem aprovação registrada (bypass)',
    target: 'execução exige aprovação vigente da versão corrente',
    defense: 'assertExecutableVersion (sem approval ⇒ MISSION_APPROVAL_NOT_FOUND)',
    severity: 'BLOCKER',
    permanentTest: { path: 'tests/integration/engineeringMissionGovernanceAndConcurrency.test.js', namePattern: 'approval bypass falha em todos os vetores conhecidos' },
  },
  {
    id: 'ADV-04',
    attack: 'aprovar v1 e executar v2 (versão obsoleta)',
    target: 'apenas a versão aprovada executa',
    defense: 'MISSION_STALE_VERSION ao comparar versão/hash aprovados com a corrente',
    severity: 'BLOCKER',
    permanentTest: { path: 'tests/integration/engineeringMissionGovernanceAndConcurrency.test.js', namePattern: 'versão antiga não executa depois de nova versão aprovada' },
  },
  {
    id: 'ADV-05',
    attack: 'alterar a MissionSpec aprovada sem tocar no hash (mutação silenciosa)',
    target: 'integridade da spec aprovada',
    defense: 'hash recomputado da spec persistida comparado ao hash aprovado',
    severity: 'BLOCKER',
    permanentTest: { path: 'tests/integration/engineeringMissionGovernanceAndConcurrency.test.js', namePattern: 'adulteração silenciosa da MissionSpec aprovada é detectada' },
  },
  {
    id: 'ADV-06',
    attack: 'reescrever a intenção original do usuário através do enriquecimento',
    target: 'originalMission imutável',
    defense: 'ORIGINAL_MISSION_MUTATED em createNextVersion/assertOriginalMissionImmutable/updateMission',
    severity: 'BLOCKER',
    permanentTest: { path: 'tests/unit/engineeringMissionCompiler.test.js', namePattern: 'originalMission permanece inalterada entre versões' },
  },
  {
    id: 'ADV-07',
    attack: 'autoaprovar missão crítica/segredo confiando na política permissiva',
    target: 'bloqueios invariantes de autoaprovação',
    defense: 'HUMAN_ONLY_RULE_IDS + explicitPolicyAuthorization ⇒ AWAITING_APPROVAL',
    severity: 'BLOCKER',
    permanentTest: { path: 'tests/integration/engineeringMissionGovernanceAndConcurrency.test.js', namePattern: 'missão crítica NÃO é autoaprovada mesmo com política habilitada' },
  },
  {
    id: 'ADV-08',
    attack: 'declarar GREEN sem execução GREEN (status mentiroso)',
    target: 'status exibido nunca mente',
    defense: 'READY_FOR_PROMOTION ⇒ DEGRADED; só task GREEN produz missão GREEN',
    severity: 'BLOCKER',
    permanentTest: { path: 'tests/integration/engineeringMissionGovernanceAndConcurrency.test.js', namePattern: 'aprovado ≠ concluído e degradado ≠ verde' },
  },
  {
    id: 'ADV-09',
    attack: 'crash do processo durante o enriquecimento / após aprovação',
    target: 'retomada durável sem duplicar efeito',
    defense: 'estado por fase no banco + lock com detecção de worker morto + retomada idempotente',
    severity: 'BLOCKER',
    permanentTest: { path: 'tests/integration/engineeringMissionDurableResume.test.js', namePattern: 'crash' },
  },
  {
    id: 'ADV-10',
    attack: 'mensagem do provedor de IA malformada / JSON inválido no enriquecimento',
    target: 'enriquecimento nunca inventa a partir de resposta inválida',
    defense: 'parse tolerante → intent=null + degradação registrada (seguir com fatos + regras)',
    severity: 'REGRESSION',
    permanentTest: { path: 'tests/integration/engineeringMissionEnrichmentDegradation.test.js', namePattern: 'resposta malformada' },
  },
  {
    id: 'ADV-11',
    attack: 'modelo propõe fato/subsistema que não existe no contexto (alucinação)',
    target: 'fatos vêm do coletor, nunca do modelo',
    defense: 'proposta de modelo entra como INFERRED/revisável; fatos do contexto prevaleceram',
    severity: 'REGRESSION',
    permanentTest: { path: 'tests/integration/engineeringMissionEnrichmentDegradation.test.js', namePattern: 'alucinação' },
  },
  {
    id: 'ADV-12',
    attack: 'contexto gigante (varredura truncada) no enriquecimento',
    target: 'enriquecimento com orçamento limitado, sem explodir memória',
    defense: 'MAX_FILES_SCANNED/scanTruncated explícito nos fatos',
    severity: 'POST_RELEASE',
    permanentTest: { path: 'tests/unit/engineeringMissionContextBudget.test.js', namePattern: 'orçamento' },
  },
  {
    id: 'ADV-13',
    attack: 'provedor fora do ar / timeout / rate limit',
    target: 'Router continua com outro provedor; falha classificada para reroute',
    defense: 'PROVIDER_UNAVAILABLE + httpStatus/providerErrorCode preservados',
    severity: 'REGRESSION',
    permanentTest: { path: 'tests/unit/engineeringRouterQwenProvider.test.js', namePattern: 'QWEN_RATE_LIMIT' },
  },
  {
    id: 'ADV-14',
    attack: 'banco indisponível durante a criação/enriquecimento da missão',
    target: 'sem fallback em memória; falha explícita',
    defense: 'persistence_required na falha de persistência',
    severity: 'BLOCKER',
    permanentTest: { path: 'tests/integration/engineeringMissionEnrichmentDegradation.test.js', namePattern: 'persistence_required' },
  },
  {
    id: 'ADV-15',
    attack: 'falha parcial ao gravar a versão (transação parcial)',
    target: 'mission e versão nunca divergem',
    defense: 'gravação de versão atômica; mission só avança após a versão existir',
    severity: 'REGRESSION',
    permanentTest: { path: 'tests/integration/engineeringMissionEnrichmentDegradation.test.js', namePattern: 'falha parcial' },
  },
  {
    id: 'ADV-16',
    attack: 'acessar as rotas de missão com classificação PRODUCTION/SUPPORT/ausente (escalada de privilégio)',
    target: 'superfície DEVELOPMENT-only',
    defense: 'checkClassification(DEVELOPMENT) ⇒ 403 classification_required; sem auth ⇒ 401',
    severity: 'BLOCKER',
    permanentTest: { path: 'tests/unit/engineeringMissionRoutes.test.js', namePattern: 'classificação' },
  },
  {
    id: 'ADV-17',
    attack: 'corpo de requisição inválido/ausente na compilação de missão',
    target: 'entrada malformada não cria estado inconsistente',
    defense: '400 invalid_body antes de qualquer persistência',
    severity: 'REGRESSION',
    permanentTest: { path: 'tests/unit/engineeringMissionRoutes.test.js', namePattern: 'entrada inválida' },
  },
  {
    id: 'ADV-18',
    attack: 'rejeitar uma missão e depois aprová-la (contornar a rejeição)',
    target: 'decisão de rejeição é terminal',
    defense: 'MISSION_REJECTED ao aprovar missão rejeitada',
    severity: 'BLOCKER',
    permanentTest: { path: 'tests/integration/engineeringMissionGovernanceAndConcurrency.test.js', namePattern: 'approval bypass falha em todos os vetores conhecidos' },
  },
  {
    id: 'ADV-19',
    attack: 'dois workers concorrentes na mesma missão (lock roubado)',
    target: 'exclusão mútua por missão',
    defense: 'lock atômico + MISSION_LOCKED_BY_OTHER_WORKER para worker vivo',
    severity: 'BLOCKER',
    permanentTest: { path: 'tests/integration/engineeringMissionDurableResume.test.js', namePattern: 'lock órfão expira' },
  },
  {
    id: 'ADV-20',
    attack: 'promoção interrompida apresentada como concluída',
    target: 'evidência de promoção não é presumida',
    defense: 'READY_FOR_PROMOTION ≠ GREEN (DEGRADED)',
    severity: 'REGRESSION',
    permanentTest: { path: 'tests/integration/engineeringMissionGovernanceAndConcurrency.test.js', namePattern: 'degradado ≠ verde' },
  },
]);

/** Ataques que NÃO são automatizáveis hoje — declarados, nunca omitidos. */
const NON_AUTOMATABLE_ATTACKS = Object.freeze([
  {
    id: 'ADV-NI-01',
    attack: 'inconsistência de branch após promoção parcial',
    reason: 'depende do estado real do repositório pós-promoção (git worktree/branch) e é coberto pelo loop de promoção do Router, não pela missão',
    mechanism: 'teste de promoção do Router (tests/integration/engineeringPromotionService.test.js) + verificação de tree hash',
  },
  {
    id: 'ADV-NI-02',
    attack: 'corrupção de evidência em disco',
    reason: 'exige verificação de hash chain do Evidence Store no momento da leitura',
    mechanism: 'gate de evidência (validate:browser-evidence / coverage gate) + hash chain append-only',
  },
]);

/**
 * Avalia a cobertura do catálogo contra os testes permanentemente presentes.
 *
 * @param {(path: string) => boolean} hasTest  injeção de acesso ao repositório
 * @param {(path: string) => string|null} [readTest]
 * @returns {{engineVersion:string, cases:Array, uncovered:Array, covered:number, total:number, status:string, blocksGreen:boolean}}
 */
function evaluateAdversarialCoverage(hasTest, readTest = null) {
  const cases = ADVERSARIAL_CASES.map((c) => {
    const exists = typeof hasTest === 'function' ? !!hasTest(c.permanentTest.path) : false;
    let nameMatch = null;
    if (exists && typeof readTest === 'function') {
      const content = readTest(c.permanentTest.path);
      nameMatch = typeof content === 'string' ? content.includes(c.permanentTest.namePattern) : null;
    }
    const covered = exists && (nameMatch === null ? true : nameMatch === true);
    return {
      id: c.id,
      attack: c.attack,
      target: c.target,
      defense: c.defense,
      severity: c.severity,
      permanentTest: c.permanentTest,
      status: covered ? 'COVERED' : 'UNCOVERED',
      testPresent: exists,
      namePresent: nameMatch,
    };
  });

  const uncovered = cases.filter((c) => c.status === 'UNCOVERED');
  return {
    engineVersion: ADVERSARIAL_REVIEW_ENGINE_VERSION,
    kind: 'ADVERSARIAL',
    total: cases.length,
    covered: cases.length - uncovered.length,
    uncovered,
    cases,
    notAutomatable: NON_AUTOMATABLE_ATTACKS.map((a) => ({ ...a, status: 'NOT_AUTOMATABLE' })),
    status: uncovered.length === 0 ? 'PASS' : 'FAIL',
    // Um ataque sem teste permanente bloqueia GREEN: o catálogo é backlog executável, não prosa.
    blocksGreen: uncovered.some((c) => c.severity === 'BLOCKER' || c.severity === 'REGRESSION'),
  };
}

module.exports = {
  ADVERSARIAL_REVIEW_ENGINE_VERSION,
  ADVERSARIAL_CASES,
  NON_AUTOMATABLE_ATTACKS,
  evaluateAdversarialCoverage,
};
