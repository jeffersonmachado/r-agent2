'use strict';

/**
 * Regressão do defeito medido em 2026-10-09 na execução real de uma missão de
 * correção de segurança (fast-uri 3.1.0 -> 3.1.8):
 *
 *   att1: coder devolveu JSON sem `diff`            -> PATCH_INVALID_FORMAT
 *   att2: coder produziu o patch CERTO (package.json, 271 chars) e ele foi
 *         REJEITADO com `NO_PATCH_SCOPE` — "Task Contract sem allowedPaths
 *         declarados"                              -> task RED, tentativas esgotadas
 *
 * A causa não era o modelo: o spec da missão não declarava escopo de caminho, e
 * `allowedPaths` vazio NUNCA significa "tudo permitido" no Roteador
 * (ER-V1-FINAL-003) — significa "nenhum patch é aceitável". Resultado prático:
 * a capacidade não conseguia corrigir NENHUMA vulnerabilidade autonomamente.
 *
 * Estes testes usam o `checkPathBoundary` REAL do roteador: o que está sendo
 * verificado é o contrato que a execução de verdade aplica, não uma cópia.
 */

const { buildPatchMissionSpec, dependencyScopeOf } = require('../../../engine/securityIntel/patchPlanner');
const { checkPathBoundary } = require('../../../engine/engineeringRouter/pathBoundary');
const { FAILURE_CODES } = require('../../../engine/engineeringRouter/constants');

const plano = (extra = {}) => ({
  advisoryId: 'GHSA-hrr3-gc8f-f4qj',
  packageName: 'fast-uri',
  currentVersion: '3.1.0',
  targetVersion: '3.1.8',
  kind: 'TRANSITIVE_OVERRIDE',
  updateRisk: 'PATCH',
  autonomy: 'LEVEL_B_ISOLATED',
  severity: 'HIGH',
  preconditions: ['executar a suíte do serviço consumidor'],
  service: 'api',
  ...extra,
});

describe('spec de correção de dependência — escopo de caminho declarado', () => {
  it('declara allowedPaths (sem isso o patch correto é rejeitado com NO_PATCH_SCOPE)', () => {
    const { options } = buildPatchMissionSpec({ plan: plano() });
    expect(Array.isArray(options.allowedPaths)).toBe(true);
    expect(options.allowedPaths.length).toBeGreaterThan(0);
    expect(options.scope).toBe('single-dependency-update');

    // O caso real: o patch tocou o package.json do workspace.
    const boundary = checkPathBoundary(['package.json', 'package-lock.json'], options);
    expect(boundary.ok).toBe(true);
  });

  it('prova que a AUSÊNCIA de escopo era a causa (contrato vazio = NO_PATCH_SCOPE)', () => {
    const semEscopo = { scope: 'single-dependency-update', allowedPaths: [], forbiddenPaths: [] };
    const boundary = checkPathBoundary(['package.json'], semEscopo);
    expect(boundary.ok).toBe(false);
    expect(boundary.code).toBe(FAILURE_CODES.NO_PATCH_SCOPE);
  });

  it('NÃO autoriza tocar código do serviço: só manifesto/lock', () => {
    const { options } = buildPatchMissionSpec({ plan: plano() });
    const boundary = checkPathBoundary(['api/server.js'], options);
    expect(boundary.ok).toBe(false);
  });

  it('proíbe governança, gates, políticas de roteamento e segredos (forbidden vence allowed)', () => {
    const { options } = buildPatchMissionSpec({ plan: plano() });
    const proibidos = [
      'scripts/governance/validate-coverage-gate.js',
      'engine/engineeringRouter/modelCapabilities.js', // patch real que já tentou isso
      '.github/workflows/release-governance.yml',
      'config/security-intel-policy.json',
      '.env',
    ];
    for (const caminho of proibidos) {
      const boundary = checkPathBoundary([caminho], options);
      expect({ caminho, ok: boundary.ok }).toEqual({ caminho, ok: false });
    }
  });

  it('escopo por serviço: frontend (com hoisting) e rag-service (PyPI)', () => {
    const frontend = buildPatchMissionSpec({ plan: plano({ service: 'frontend', packageName: 'nanoid' }) }).options;
    expect(checkPathBoundary(['frontend/package.json'], frontend).ok).toBe(true);
    expect(checkPathBoundary(['package-lock.json'], frontend).ok).toBe(true);
    expect(checkPathBoundary(['api/server.js'], frontend).ok).toBe(false);

    const pypi = buildPatchMissionSpec({
      plan: plano({ service: 'rag-service', packageName: 'transformers', ecosystem: 'pypi' }),
    }).options;
    expect(checkPathBoundary(['rag-service/requirements.txt'], pypi).ok).toBe(true);
    expect(checkPathBoundary(['package.json'], pypi).ok).toBe(false);
  });

  it('serviço desconhecido cai no escopo npm da raiz (nunca em vazio)', () => {
    expect(dependencyScopeOf({ service: 'desconhecido' })).toEqual(['package.json', 'package-lock.json']);
    expect(dependencyScopeOf({})).toEqual(['package.json', 'package-lock.json']);
    const { options } = buildPatchMissionSpec({ plan: plano({ service: null }) });
    expect(options.allowedPaths.length).toBeGreaterThan(0);
    expect(checkPathBoundary(['package.json'], options).ok).toBe(true);
  });

  it('o texto da missão continua proibindo governança (contrato e instrução concordam)', () => {
    const { mission } = buildPatchMissionSpec({ plan: plano() });
    expect(mission).toContain('NÃO alterar governança, políticas, gates ou scripts de release');
    expect(mission).toContain('fast-uri');
  });
});
