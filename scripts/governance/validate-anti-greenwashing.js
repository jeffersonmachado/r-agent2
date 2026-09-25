#!/usr/bin/env node
'use strict';

/**
 * validate-anti-greenwashing.js — gate ANTI-GREENWASHING (§11, §12, §13).
 *
 * Por que existe (achado real): os testes autoritativos deste domínio pulavam a si mesmos quando a
 * infraestrutura faltava (`if (skipIfNoDatabase()) return;`) e o Jest, corretamente para o Jest,
 * reportava a suite como verde. O RELATÓRIO de release, porém, contava isso como cobertura. Um
 * banco fora do ar virava PASS agregado — exatamente o falso verde que a missão proíbe.
 *
 * Este gate é deliberadamente conservador e verificável sem banco:
 *
 *   1. Toda suite autoritativa declarada precisa existir;
 *   2. nenhuma pode conter mecanismo de pulo SILENCIOSO (`test.skip`, `describe.skip`, `it.skip`,
 *      `xit`, `xdescribe`, `.only`) — pulo autorizado é apenas o registrado via `tests/helpers/infraGate.js`;
 *   3. toda suite que consulta infraestrutura precisa delegar à porta única (`infraGate`), para que
 *      o estado do pulo fique registrado e o modo release-authoritative seja fail-closed;
 *   4. em `RELEASE_AUTHORITATIVE=1` com infra ausente, o estado do relatório é `INFRA_ERROR`
 *      (o gate FALHA) — nunca PASS.
 *
 * Saída: reports/anti-greenwashing-report.json
 */

const fs = require('fs');
const path = require('path');
const { ROOT, writeReport } = require('./common');

/** Suítes que um gate de release considera AUTORITATIVAS para o Engineering Mission / Router. */
const AUTHORITATIVE_SUITES = Object.freeze([
  'tests/unit/engineeringRouterQwenProvider.test.js',
  'tests/unit/engineeringMissionLeasePolicy.test.js',
  'tests/unit/engineeringMissionRecoveryPlan.test.js',
  'tests/unit/engineeringMissionPolicyResolver.test.js',
  'tests/unit/engineeringMissionPolicyAuthority.test.js',
  'tests/unit/engineeringMissionRoutes.test.js',
  'tests/unit/engineeringMissionRbac.test.js',
  'tests/unit/engineeringMissionReviewEngines.test.js',
  'tests/unit/engineeringMissionCompiler.test.js',
  'tests/unit/engineeringMissionContextBudget.test.js',
  'tests/integration/engineeringMissionDistributedLease.test.js',
  'tests/integration/engineeringMissionBootRecovery.test.js',
  'tests/integration/engineeringMissionPolicyEscalation.test.js',
  'tests/integration/engineeringMissionReviewEnforcement.test.js',
  'tests/integration/engineeringMissionEnrichmentDegradation.test.js',
  'tests/integration/engineeringMissionDurableResume.test.js',
  'tests/integration/engineeringMissionGovernanceAndConcurrency.test.js',
  'tests/integration/engineeringMissionFullE2E.test.js',
]);

/** Mecanismos de pulo que NÃO são permitidos em suite autoritativa. */
const FORBIDDEN_SKIP_PATTERNS = Object.freeze([
  { id: 'TEST_SKIP', re: /(^|[^\w.'"`])test\.skip\s*\(/, detail: 'test.skip' },
  { id: 'IT_SKIP', re: /(^|[^\w.'"`])it\.skip\s*\(/, detail: 'it.skip' },
  { id: 'DESCRIBE_SKIP', re: /(^|[^\w.'"`])describe\.skip\s*\(/, detail: 'describe.skip' },
  { id: 'XIT', re: /(^|[^\w.'"`])xit\s*\(/, detail: 'xit' },
  { id: 'XDESCRIBE', re: /(^|[^\w.'"`])xdescribe\s*\(/, detail: 'xdescribe' },
  { id: 'ONLY', re: /(^|[^\w.'"`])(?:test|it|describe)\.only\s*\(/, detail: '.only' },
  { id: 'ENV_GATE', re: /process\.env\.[A-Z_]*SKIP[A-Z_]*\s*===?\s*['"]?1/, detail: 'env flag que pula gate' },
]);

/**
 * Linhas que o scanner NÃO deve ler como mecanismo de skip.
 *
 * Falso positivo real encontrado ao ativar o gate: `engineeringMissionReviewEngines.test.js` contém
 *
 *     '+  test.skip(\'ignora\', () => {});',
 *     '+  describe.only(\'só este\', () => {});',
 *
 * como DADOS de um patch que o Meta Reviewer precisa reprovar. A primeira tentativa de filtro
 * (olhar o começo da linha / a aspa imediatamente antes do token) não pegou, porque o marcador de
 * diff está DENTRO do literal. Correção: remover literais de string da linha e reavaliar — token
 * que só existe dentro de um literal é dado, nunca mecanismo.
 */
function isFixtureOrStringLine(line) {
  if (/^[+-]\s*\S/.test(line.trim())) return true;
  const withoutStrings = line.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '""');
  return !/(?:^|[^\w.'"`])(?:test|it|describe)\.(?:skip|only)\s*\(/.test(withoutStrings);
}

/** Padrão de pulo silencioso (retorno antecipado) que precisa ter migrado para a porta única. */
const SILENT_SKIP_RE = /console\.warn\([^)]*PULADO|console\.warn\([^)]*NÃO EXECUTADO/;

function readSuite(relativePath) {
  const absolute = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolute)) return null;
  return fs.readFileSync(absolute, 'utf8');
}

function evaluate() {
  const checks = [];
  const violations = [];

  for (const suite of AUTHORITATIVE_SUITES) {
    const source = readSuite(suite);
    if (source === null) {
      checks.push({ id: `SUITE_EXISTS:${suite}`, ok: false, reason: 'suite autoritativa declarada não existe' });
      violations.push({ suite, code: 'AUTHORITATIVE_SUITE_MISSING' });
      continue;
    }
    checks.push({ id: `SUITE_EXISTS:${suite}`, ok: true });

    for (const pattern of FORBIDDEN_SKIP_PATTERNS) {
      // Detecção por LINHA, ignorando dados de fixture/string (ver isFixtureOrStringLine).
      const offending = source
        .split('\n')
        .filter((line) => !isFixtureOrStringLine(line) && pattern.re.test(line));
      if (offending.length > 0) {
        checks.push({
          id: `NO_SKIP:${pattern.id}:${suite}`,
          ok: false,
          reason: `mecanismo de pulo proibido em suite autoritativa: ${pattern.detail} (${offending.length} linha(s))`,
        });
        violations.push({ suite, code: `FORBIDDEN_SKIP_MECHANISM:${pattern.id}`, lines: offending.length });
      } else {
        checks.push({ id: `NO_SKIP:${pattern.id}:${suite}`, ok: true });
      }
    }

    // Suite que consulta infraestrutura precisa passar pela porta única.
    const touchesInfra = /connect\(|skipIfNoDatabase|dbAvailable/.test(source);
    if (touchesInfra) {
      const usesGate = /infraGate/.test(source);
      checks.push({
        id: `INFRA_GATE:${suite}`,
        ok: usesGate,
        reason: usesGate ? undefined : 'suite consulta infraestrutura sem delegar à porta única (tests/helpers/infraGate.js) — o pulo ficaria invisível no relatório',
      });
      if (!usesGate) violations.push({ suite, code: 'SILENT_INFRA_SKIP_NOT_MIGRATED' });

      if (!usesGate && SILENT_SKIP_RE.test(source)) {
        violations.push({ suite, code: 'SILENT_SKIP_WITH_REGISTERED_WORDING' });
      }
    }
  }

  const authoritativeMode = process.env.RELEASE_AUTHORITATIVE === '1' || process.env.RELEASE_AUTHORITATIVE === 'true';
  const infraRequired = process.env.ANTI_GREENWASHING_INFRA === 'down';
  // Fail-closed em modo autoritativo: sem infraestrutura obrigatória, o estado é INFRA_ERROR.
  const state = infraRequired && authoritativeMode
    ? 'INFRA_ERROR'
    : (violations.length > 0 ? 'FAIL' : 'PASS');

  return {
    artifactType: 'anti-greenwashing-report',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    status: state,
    state,
    authoritativeMode,
    authoritativeSuites: AUTHORITATIVE_SUITES.length,
    violations,
    violationCount: violations.length,
    checks,
    failedChecks: checks.filter((c) => !c.ok).length,
    states: {
      PASS: 'suite executou e passou de verdade',
      FAIL: 'suite falhou',
      BLOCKED: 'impedimento externo explícito',
      INFRA_ERROR: 'infraestrutura obrigatória ausente (nunca vira PASS)',
      NOT_APPLICABLE: 'regra não se aplica a este item',
      NOT_EXECUTED: 'não rodou — registrado como tal, jamais como PASS',
    },
    notes: [
      'Pulo autorizado é APENAS o registrado via tests/helpers/infraGate.js (dev mode).',
      'Em RELEASE_AUTHORITATIVE=1 a ausência de infraestrutura lança INFRA_ERROR e a suite FALHA.',
    ],
  };
}

function main() {
  const report = evaluate();
  writeReport('anti-greenwashing-report.json', report);
  console.log(`[anti-greenwashing] status=${report.status} suites=${report.authoritativeSuites} violações=${report.violationCount}`);
  if (report.status !== 'PASS') {
    for (const v of report.violations.slice(0, 20)) console.error(`  - ${v.code} :: ${v.suite}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { evaluate, isFixtureOrStringLine, AUTHORITATIVE_SUITES, FORBIDDEN_SKIP_PATTERNS };
