'use strict';

/**
 * Selo do ENGINEERING ROUTER V2 (§5, §6, §42–§45).
 *
 * Este validador NÃO declara verde: ele COMPÕE as provas que existem, com hash binding, e diz o
 * estado real. Regras que ele encarna:
 *
 *   - item estrutural só passa se a INVARIANTE for verificável no código (não pelo nome do arquivo);
 *   - item de runtime só passa se o relatório de prova existir, estiver fresco e verde — relatório
 *     ausente em modo autoritativo é FALHA, nunca "pendente";
 *   - o envelope carrega o hash de cada artefato e a verificação RECOMPUTA os hashes: envelope
 *     adulterado falha;
 *   - `ENGINEERING_ROUTER_V2` é independente de `RAP_FINAL_RELEASE` (§3, §48): este relatório nunca
 *     promove o release da plataforma.
 *
 * Uso: node scripts/governance/validate-engineering-router-v2.js [--json]
 * Saída: reports/engineering-router-v2-seal-report.json (+ RELEASE_AUTHORITATIVE=1 => fail-closed).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const envelopeLib = require('./lib/engineeringV2Envelope');
const ROOT = path.resolve(__dirname, '..', '..');

// DIRETÓRIO DE RELATÓRIOS INJETÁVEL (missão 2026-09-28).
//
// DEFEITO REAL medido: este validador LÊ evidências e PUBLICA o relatório canônico do selo.
// O teste unitário de dependência do timeout exercitava estes caminhos com fixtures mutadas —
// escrevendo e apagando `reports/TIMEOUT_ARCHITECTURE_REPORT.json` e republicando
// `reports/engineering-router-v2-seal-report.json`. Consequência observada: DEPOIS de rodar
// `npm run test:unit`, o selo canônico ficava publicado como `NO_GO` ("evidência vencida") por
// artefato de teste. Teste NUNCA pode publicar veredito de governança nem alterar evidência real:
// com `ENGINEERING_V2_REPORTS_DIR` o validador opera inteiramente dentro do diretório injetado.
const REPORTS_DIR_OVERRIDE = process.env.ENGINEERING_V2_REPORTS_DIR
  ? path.resolve(process.env.ENGINEERING_V2_REPORTS_DIR)
  : null;

/** Resolve o caminho absoluto de um relatório (honrando o diretório injetado). */
function resolveReportPath(rel) {
  if (!REPORTS_DIR_OVERRIDE) return path.join(ROOT, rel);
  return path.join(REPORTS_DIR_OVERRIDE, path.basename(rel));
}

const REPORT = resolveReportPath('reports/engineering-router-v2-seal-report.json');
const AUTHORITATIVE = process.env.RELEASE_AUTHORITATIVE === '1';

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** Lê e parseia um relatório relativo à raiz. Ausente/ilegível ⇒ null (nunca inventa). */
function readJsonRel(rel) {
  const content = read(rel);
  if (content === null) return null;
  try {
    return JSON.parse(content);
  } catch (_) {
    return null;
  }
}

function read(rel) {
  const abs = resolveReportPath(rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

function check(id, ok, detail) {
  return { id, status: ok ? 'PASS' : 'FAIL', detail: detail || '' };
}

/**
 * Remove comentários antes de avaliar invariantes.
 *
 * Falso positivo real medido: a checagem `...mission.auto_approval_policy` era satisfeita pelo
 * COMENTÁRIO que explica justamente que aquele merge foi removido, e `process.kill(pid` casava com
 * o probe `process.kill(pid, 0)` de "processo vivo" (que não é autoridade de posse). Invariante se
 * verifica em CÓDIGO; acusar a documentação do próprio código é o mesmo erro de antes, invertido.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

/** Item estrutural: a invariante precisa ser verificável no CONTEÚDO, não no nome do arquivo. */
function structural(id, artifact, invariant) {
  const content = read(artifact);
  if (content === null) return check(id, false, `artefato ausente: ${artifact}`);
  const code = stripComments(content);
  const violations = [];
  if (typeof invariant === 'function') {
    const result = invariant(code);
    if (result !== true) violations.push(result);
  }
  return check(id, violations.length === 0, violations.join('; ') || `invariante verificada em ${artifact}`);
}

const STRUCTURAL_ITEMS = [
  structural(
    'V2_LEASE_POLICY_PURE',
    'engine/engineeringMission/leasePolicy.js',
    (src) => {
      if (/Date\.now|new Date|Math\.random|process\.env/.test(src)) return 'política de lease deve ser pura (sem relógio, random ou env)';
      if (!/assertWriterAuthorized/.test(src)) return 'assertWriterAuthorized ausente: sem fencing não há proteção contra worker antigo';
      return true;
    },
  ),
  structural(
    'V2_PID_NAO_E_AUTORIDADE',
    'api/services/engineeringMission/missionStoreService.js',
    // `process.kill(pid, 0)` é probe de existência de processo (aceitável). O que não pode existir é
    // o uso do PID como decisão de posse — por exemplo matar o dono anterior para assumir o lease.
    (src) => {
      if (/process\.kill\(\s*pid\s*,\s*['"]?SIG/.test(src)) return 'PID é usado para MATAR o dono do lease: PID não é autoridade de posse';
      if (/locked_by_pid|owner_pid/.test(src)) return 'posse ainda derivada de PID armazenado';
      return true;
    },
  ),
  structural(
    'V2_POLICY_RESOLVER_SEM_MERGE_INGENUO',
    'api/services/engineeringMission/missionCompilerService.js',
    (src) => {
      // O invariante é: NENHUM merge ingênuo E a política vinda de UMA autoridade.
      //
      // FALSO NEGATIVO REAL corrigido em 2026-09-25: este check exigia literalmente
      // `resolveMissionPolicy(` DENTRO deste arquivo. Quando a resolução passou a ser delegada à
      // autoridade única (`missionPolicyAuthority.resolvePolicyForMission`), que é a correção
      // CERTA (§POLICY_RESOLVER_ALL_PATHS), o check passou a acusar FAIL contra código correto —
      // um validador reprovando a própria correção que o fortalece. O que importa não é ONDE a
      // função é chamada, e sim que a política NUNCA seja montada por merge nem avaliada por
      // caminho que ignore a autoridade.
      if (src.includes('...mission.auto_approval_policy')) return 'merge ingênuo de política ainda presente (permite a missão ampliar a própria política)';
      const usesAuthority = /policyAuthority\.resolvePolicyForMission\(/.test(src)
        || /resolveMissionPolicy\(/.test(src);
      if (!usesAuthority) return 'a política efetiva não é obtida por autoridade de resolução (nem policyAuthority.resolvePolicyForMission nem resolveMissionPolicy)';
      if (!/requireAuthorizedPolicy\(/.test(src)) return 'escalação de política não é aplicada por requireAuthorizedPolicy (recusa explícita ausente)';
      return true;
    },
  ),
  structural(
    'V2_ESTADOS_TERMINAIS_CENTRALIZADOS',
    'engine/engineeringMission/constants.js',
    (src) => {
      if (!/TERMINAL_MISSION_STATES/.test(src) || !/RESUMABLE_MISSION_STATES/.test(src)) return 'listas de estados não centralizadas';
      if (!/CANCELLED/.test(src)) return 'TERMINAL_MISSION_STATES incompleto (falta CANCELLED)';
      return true;
    },
  ),
  structural(
    'V2_RECOVERY_AUTOMATICO_NO_BOOT',
    'api/bootstrap/startInitialization.js',
    (src) => {
      if (!/runBootRecovery/.test(src)) return 'boot não chama runBootRecovery: recuperação continuaria exigindo POST manual';
      if (!/startRecoveryLoop/.test(src)) return 'loop periódico de recuperação ausente';
      return true;
    },
  ),
  structural(
    'V2_FK_RESTRICT_NA_MIGRATION',
    'api/db/migrations/20260924160000-engineering-mission-distributed-lease.js',
    // Falso negativo real: a migration declara a FK pelo Sequelize (`onDelete: 'RESTRICT'`), não
    // pelo literal SQL `ON DELETE RESTRICT`. A invariante é a MESMA; o validador é que era estreito.
    (src) => {
      const restrict = /onDelete:\s*['"]RESTRICT['"]/i.test(src) || /ON DELETE RESTRICT/i.test(src);
      if (!restrict) return 'FK sem RESTRICT: histórico de missão poderia ser apagado em cascata';
      if (/onDelete:\s*['"]CASCADE['"]|ON DELETE CASCADE/i.test(src)) return 'FK com CASCADE: versão/aprovação/parecer poderiam sumir junto com a missão';
      if (!/ENGINEERING_MISSION_FK_ORPHANS/.test(src)) return 'sem pré-checagem fail-closed de órfãos antes de criar as FKs';
      return true;
    },
  ),
  structural(
    'V2_RBAC_FAIL_CLOSED',
    'api/modules/engineering-missions/routes.js',
    (src) => {
      if (!/action_not_mapped/.test(src)) return 'rota fora do mapa de ações não é rejeitada (deveria ser 403)';
      if (!/permission_checker_missing/.test(src)) return 'ausência de verificador de permissão não falha fechado';
      return true;
    },
  ),
  structural(
    'V2_ANTI_GREENWASHING_PORTA_UNICA',
    'tests/helpers/infraGate.js',
    (src) => {
      if (!/RELEASE_AUTHORITATIVE/.test(src)) return 'sem modo autoritativo: pulo de infra continuaria virando PASS';
      if (!/INFRA_ERROR/.test(src)) return 'infraestrutura ausente não produz INFRA_ERROR';
      return true;
    },
  ),
];

/** Item de runtime: exige relatório de prova verde e fresco. Nunca "pendente" em modo autoritativo. */
function runtimeItem(id, reportRel, predicate) {
  const rawContent = read(reportRel);
  if (rawContent === null) {
    return check(id, false, `evidência runtime ausente: ${reportRel}${AUTHORITATIVE ? ' (fail-closed em modo autoritativo)' : ''}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    return check(id, false, `evidência ilegível: ${error.message}`);
  }
  const verdict = predicate(parsed);
  return check(id, verdict === true, typeof verdict === 'string' ? verdict : `${reportRel} verificado`);
}

const FRESH_MS = 7 * 24 * 3600 * 1000;

const RUNTIME_ITEMS = [
  runtimeItem('V2_ANTI_GREENWASHING_VERDE', 'reports/anti-greenwashing-report.json', (report) => {
    if (report.status !== 'PASS') return `status=${report.status}`;
    if (report.violationCount !== 0) return `violações=${report.violationCount}`;
    return true;
  }),
  runtimeItem('V2_CRASH_SIGKILL_VERDE', 'reports/mission-crash-recovery-report.json', (report) => {
    if (report.status !== 'GO') return `status=${report.status}`;
    if ((report.failures || []).length > 0) return `${report.failures.length} check(s) falhando`;
    const finished = Date.parse(report.finishedAt || '');
    if (!Number.isFinite(finished) || Date.now() - finished > FRESH_MS) return 'evidência vencida (>7 dias)';
    return true;
  }),
  // TIMEOUT_ARCHITECTURE é REQUISITO DO SELO (missão 2026-09-28). Antes desta correção este
  // arquivo não tinha UMA ÚNICA menção a timeout: o selo V2 podia ser GO com lease/heartbeat/
  // fence/deadline/progresso NO_GO ou nem executados. O veredito é LIDO do relatório real
  // (nunca copiado de uma constante) e a dependência é fail-closed: sem relatório, sem selo.
  runtimeItem('V2_TIMEOUT_ARCHITECTURE_GREEN', 'reports/TIMEOUT_ARCHITECTURE_REPORT.json', (report) => {
    const verdict = report?.verdicts?.TIMEOUT_ARCHITECTURE;
    if (!verdict) return 'relatório sem verdicts.TIMEOUT_ARCHITECTURE';
    if (verdict !== 'GREEN') return `TIMEOUT_ARCHITECTURE=${verdict}`;
    if (report.verdicts.TIMEOUT_INVENTORY !== 'COMPLETE') return `TIMEOUT_INVENTORY=${report.verdicts.TIMEOUT_INVENTORY}`;
    const generatedAt = Date.parse(report.generatedAt || '');
    if (!Number.isFinite(generatedAt) || Date.now() - generatedAt > FRESH_MS) return 'evidência vencida (>7 dias)';
    return true;
  }),
  // CICLO AUTÔNOMO DE BUG (missão 2026-09-29) — REQUISITO DO SELO. O veredito é LIDO do relatório
  // real produzido por `validate:bug-autonomous-loop`, que por sua vez deriva da execução
  // autoritativa das suítes BUG-01..BUG-20. Sem relatório, o selo não é GO: um ciclo de correção
  // de bugs que ninguém mede é exatamente a dependência humana que esta missão existe para
  // eliminar. Os demais vereditos do relatório (triagem, reprodução, regressão, self-modification)
  // são checados individualmente para que um GREEN global não esconda um eixo NO_GO.
  runtimeItem('V2_BUG_AUTONOMOUS_LOOP_GREEN', 'reports/bug-autonomous-loop-report.json', (report) => {
    if (report.status !== 'GREEN' || report.BUG_AUTONOMOUS_LOOP !== 'GREEN') return `BUG_AUTONOMOUS_LOOP=${report.BUG_AUTONOMOUS_LOOP || report.status}`;
    const verdicts = report.verdicts || {};
    const notGreen = Object.keys(verdicts).filter((key) => verdicts[key] !== 'GREEN');
    if (notGreen.length > 0) return `veredito(s) não-GREEN: ${notGreen.join(', ')}`;
    const structuralFailures = (report.structuralChecks || []).filter((c) => c.status !== 'PASS');
    if (structuralFailures.length > 0) return `checagem estrutural falhando: ${structuralFailures.map((c) => c.id).join(', ')}`;
    if ((report.runtimeProofs || []).some((p) => p.status !== 'PASS')) return 'prova de runtime do ciclo não passou';
    return true;
  }),
];

/**
 * ENVELOPE — implementação ÚNICA (`lib/engineeringV2Envelope`).
 *
 * ACHADO REAL (2026-09-25): este arquivo tinha a sua PRÓPRIA construção de envelope e a verificava
 * no MESMO processo (`buildEnvelope` + `verifyEnvelope` locais). Isso é um envelope
 * AUTO-REFERENTE: ele nasce e é conferido no mesmo instante, então "verificação" ali só detectava
 * alteração ocorrida DURANTE a execução — nada provava sobre um envelope previamente selado. Além
 * disso, era uma TERCEIRA implementação de envelope no repositório (V1 do Router, esta, e a lib
 * V2), exatamente o "arquitetura paralela" que a missão proíbe.
 *
 * Agora: a verificação CONSOME o envelope em disco, produzido por
 * `engineering-router:v2-envelope:generate` em outra execução. Se o envelope não existir, o
 * estado é `ENVELOPE_NOT_SEALED` (pendência declarada) — nunca um envelope forjado na hora para
 * poder "passar".
 */
function resolveEnvelopeDir() {
  if (process.env.V2_ENVELOPE_DIR) return path.resolve(process.env.V2_ENVELOPE_DIR);
  const shipped = path.join(ROOT, 'dist', 'engineering-router-v2-audit-envelope');
  return shipped;
}

function verifySealedEnvelope() {
  const dir = resolveEnvelopeDir();
  if (!fs.existsSync(dir)) {
    return {
      id: 'ENVELOPE_VERIFICATION',
      status: 'PENDING',
      detail: `envelope não selado em ${path.relative(ROOT, dir)} — gere com engineering-router:v2-envelope:generate e verifique com engineering-router:v2-envelope (a verificação NUNCA gera o envelope)`,
      dir: path.relative(ROOT, dir),
    };
  }
  let result;
  try {
    result = envelopeLib.verifyEnvelope(dir);
  } catch (error) {
    return { id: 'ENVELOPE_VERIFICATION', status: 'FAIL', detail: `falha ao verificar: ${error.message}`, dir: path.relative(ROOT, dir) };
  }
  return {
    id: 'ENVELOPE_VERIFICATION',
    status: result.status === 'VERIFIED' ? 'PASS' : 'FAIL',
    detail: `${result.checks.length} checks, ${result.failures.length} falha(s)${result.failures.length > 0 ? ` — ${result.failures.slice(0, 3).map((f) => f.id).join(', ')}` : ''}`,
    dir: path.relative(ROOT, dir),
    runId: result.manifest?.runId || null,
    failures: result.failures.map((f) => f.id),
  };
}

function main() {
  const items = [...STRUCTURAL_ITEMS, ...RUNTIME_ITEMS];

  // PENDÊNCIAS OBRIGATÓRIAS — DERIVADAS de relatórios reais, nunca texto fixo.
  //
  // DEFEITO REAL corrigido em 2026-09-25: esta lista era um array de STRINGS escrita à mão. Duas
  // das três frases já estavam FALSAS — "retomada de TASK real" havia sido implementada e provada
  // (reports/real-task-recovery-report.json = GO, 16/16) e a pendência dos "42 requisitos" (número
  // do texto fixo da época; o manifesto corrente tem outra contagem) havia
  // mudado de natureza (existe matriz derivada de 17 eixos; o que falta é a numeração do prompt).
  // Uma pendência desatualizada mente no mesmo grau que um PASS falso: ela afirma que falta algo
  // que já existe. Agora cada pendência é lida do relatório que a comprova.
  const derivePending = () => {
    const pending = [];

    const recovery = readJsonRel('reports/real-task-recovery-report.json');
    if (!recovery) {
      pending.push({ id: 'REAL_TASK_RECOVERY', status: 'PENDING', detail: 'sem relatório de retomada de task real (rode npm run verify:real-task-recovery)' });
    } else if (recovery.status !== 'GO') {
      pending.push({ id: 'REAL_TASK_RECOVERY', status: 'PENDING', detail: `retomada de task real não comprovada: status=${recovery.status}` });
    }

    const matrix = readJsonRel('reports/engineering-router-v2-requirements-matrix.json');
    if (!matrix) {
      pending.push({ id: 'V2_REQUIREMENTS_MATRIX', status: 'PENDING', detail: 'matriz de requisitos ausente (rode npm run validate:v2-requirements-matrix)' });
    }

    // TESTES OBRIGATÓRIOS V2: o prompt ORIGINAL numerava V2-01..V2-42, mas o manifesto versionado
    // tem 57 itens com IDs heterogêneos — a contagem corrente é SEMPRE derivada do manifesto.
    // A numeração TEM fonte (seção '38. TESTES
    // OBRIGATÓRIOS V2' do prompt original, recuperada do histórico da sessão em 2026-09-28 e
    // versionada em config/engineering-router-v2-required-tests.json). O estado de cada ID é
    // derivado por `npm run validate:required-tests`; aqui só se lê a MEDIÇÃO. Antes disto a
    // pendência era um texto fixo afirmando que a numeração não existia em lugar nenhum — o que
    // passou a ser falso assim que a fonte foi encontrada.
    const requiredTests = readJsonRel('reports/engineering-router-v2-required-tests-report.json');
    // CONTAGEM DERIVADA DA FONTE (manifesto versionado), nunca escrita à mão: o texto fixo "42"
    // passou a mentir quando o manifesto chegou a 57 itens.
    const requiredTestsSource = readJsonRel('config/engineering-router-v2-required-tests.json');
    const requiredTestsTotal = Array.isArray(requiredTestsSource?.requiredTests)
      ? requiredTestsSource.requiredTests.length
      : null;
    if (!requiredTests) {
      pending.push({ id: 'V2_REQUIRED_TESTS', status: 'PENDING', detail: `medição dos ${requiredTestsTotal ? `${requiredTestsTotal} ` : ''}testes obrigatórios ausente (rode npm run validate:required-tests)` });
    } else if (requiredTests.status !== 'PASS') {
      pending.push({
        id: 'V2_REQUIRED_TESTS',
        status: 'PENDING',
        detail: `${requiredTestsTotal ?? requiredTests.total ?? '?'} testes obrigatórios em ${requiredTests.status}: ${(requiredTests.unresolvedIds || []).length} não provado(s) — ${(requiredTests.unresolvedIds || []).slice(0, 8).join(', ')}`,
      });
    }
    if (matrix && matrix.status !== 'GO') {
      pending.push({ id: 'V2_REQUIREMENTS_MATRIX_STATUS', status: 'PENDING', detail: `matriz em ${matrix.status} (${matrix.violationCount} eixo(s) sem prova): ${matrix.violations.slice(0, 3).map((v) => v.axis).join(', ')}` });
    }

    const statusReport = readJsonRel('reports/engineering-router-v2-status-report.json') || readJsonRel('ENGINEERING_ROUTER_V2_STATUS_REPORT.json');
    // RAG_INDEX_HEALTH é LIDO DA MEDIÇÃO, não do status report (missão 2026-09-28). O status é
    // SAÍDA: usá-lo como entrada permitia que um arquivo narrativo de 24/09 (com
    // `REPAIRED_WITH_RESIDUAL`) governasse a decisão de hoje — para mais ou para menos. A fonte
    // agora é o banco real, medido por `npm run validate:rag-index-health`.
    const ragHealth = readJsonRel('reports/rag-index-health-report.json');
    if (!ragHealth) {
      pending.push({ id: 'ENGINEERING_RAG_ENRICHMENT', status: 'PENDING', detail: 'sem medição do corpus RAG (rode npm run validate:rag-index-health)' });
    } else if (String(ragHealth.status) !== 'HEALTHY') {
      pending.push({ id: 'ENGINEERING_RAG_ENRICHMENT', status: 'PENDING', detail: `RAG_INDEX_HEALTH=${ragHealth.status} (${(ragHealth.violations || []).map((v) => v.code).join(', ') || 'sem detalhe'})` });
    }
    if (statusReport?.axes?.QWEN_LIVE && /NOT_EXECUTED/.test(String(statusReport.axes.QWEN_LIVE.status))) {
      pending.push({ id: 'QWEN_LIVE', status: 'PENDING', detail: `QWEN_LIVE=${statusReport.axes.QWEN_LIVE.status}: prova ao vivo não executada neste ambiente (sem credencial)` });
    }

    // CICLO AUTÔNOMO DE BUG: pendência DERIVADA do relatório do gate, nunca texto fixo.
    const bugLoop = readJsonRel('reports/bug-autonomous-loop-report.json');
    if (!bugLoop) {
      pending.push({ id: 'BUG_AUTONOMOUS_LOOP', status: 'PENDING', detail: 'sem medição do ciclo de bug (rode npm run validate:bug-autonomous-loop após a execução autoritativa das suítes)' });
    } else if (bugLoop.status !== 'GREEN') {
      const failures = (bugLoop.itemFailures || []).map((f) => f.id);
      pending.push({
        id: 'BUG_AUTONOMOUS_LOOP',
        status: 'PENDING',
        detail: `ciclo de bug em ${bugLoop.status}: ${failures.length} item(ns) obrigatório(s) sem prova (${failures.slice(0, 8).join(', ') || 'veredito não-GREEN'})`,
      });
    }
    return pending;
  };

  const missingMandatory = derivePending();

  const envelopeItem = verifySealedEnvelope();
  const failed = items.filter((item) => item.status === 'FAIL');
  // GO exige: nenhum item FAIL, nenhuma pendência obrigatória E envelope selado e VERIFIED.
  const status = failed.length === 0 && missingMandatory.length === 0 && envelopeItem.status === 'PASS' ? 'GO' : 'NO_GO';

  const report = {
    report: 'ENGINEERING_ROUTER_V2_SEAL',
    generatedAt: new Date().toISOString(),
    authoritativeMode: AUTHORITATIVE,
    status,
    items,
    mandatoryPending: missingMandatory,
    envelopeVerification: envelopeItem,
    axes: {
      ENGINEERING_ROUTER_V2: status,
      RAP_FINAL_RELEASE: 'NO_GO_INDEPENDENTE',
    },
    note: 'ENGINEERING_ROUTER_V2 e RAP_FINAL_RELEASE são estados INDEPENDENTES (§3, §48). Este selo nunca promove o release da plataforma.',
    failures: failed,
  };

  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const item of items) process.stdout.write(`  [${item.status}] ${item.id} — ${item.detail}\n`);
    for (const item of missingMandatory) process.stdout.write(`  [${item.status}] ${item.id} — ${item.detail}\n`);
    process.stdout.write(`  [${envelopeItem.status}] ${envelopeItem.id} — ${envelopeItem.detail}\n`);
    process.stdout.write(`[engineering-router-v2] status=${status} itens=${items.length} falhas=${failed.length} pendencias=${missingMandatory.length}\n`);
  }
  process.exit(status === 'GO' ? 0 : 1);
}

main();
