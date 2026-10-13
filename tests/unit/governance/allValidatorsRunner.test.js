'use strict';

/**
 * Runner COMPLETO dos validadores do gate agregado (`validate:all-validators`).
 *
 * DEFEITO DE VISIBILIDADE medido em 2026-10-13: o agregado canônico é uma cadeia
 * `&&`; a primeira falha aborta o resto e o log mostra "1 FAIL" como se fosse o
 * único problema. A execução isolada dos 60 validadores revelou **10 falhas** de
 * causas diferentes (documento RAG falhado, evidência de runtime obsoleta,
 * projeção stale, pacote ausente) — ou seja, um ciclo de ~1h por descoberta.
 *
 * O runner novo é ADITIVO (o agregado canônico segue fail-fast, por decisão de
 * custo). O que se trava aqui:
 *   1. a lista vem do PRÓPRIO package.json (fonte única — nunca uma cópia que
 *      silenciosamente deixa validadores de fora);
 *   2. TODOS os validadores entram no relatório, inclusive os que falharam;
 *   3. o status é FAIL se QUALQUER um falhar (fail-closed);
 *   4. `--only` com nome fora do agregado é ERRO (não "0 validadores, tudo ok");
 *   5. o agregado canônico continua com `&&` (este runner não o enfraquece).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const {
  listarValidadores,
  resumirSaida,
  comporRelatorio,
  calcularExit,
  filtrarValidadores,
  deveRevalidarAposCarimbo,
} = require('../../../scripts/governance/lib/governance-enforcement-plan');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

describe('coerência de lineage: rodar validadores fora do converge regrava artefatos', () => {
  it('o runner carimba o lineage ao final (e permite desligar com --no-stamp)', () => {
    const codigo = fs.readFileSync(path.join(ROOT, 'scripts', 'governance', 'run-all-validators.js'), 'utf8');
    // DEFEITO REAL medido: sem o carimbo, os artefatos regravados pelo runner
    // (coverage-gate, experience-segregation, json-persistence-audit, ...) ficam
    // sem runId e o `validate:current-run-temporal-integrity` — que roda DEPOIS
    // na mesma lista — acusa INVALID_AUTHORITATIVE_ARTIFACT (6 violações),
    // derrubando junto o `validate:required-tests`.
    expect(codigo).toContain('stamp-report-lineage.js');
    expect(codigo).toContain("args.includes('--no-stamp')");
    expect(codigo).toContain('lineageStamp');
  });

  it('a revalidação pós-carimbo é RESTRITA a causa de lineage (nunca "tentar de novo")', () => {
    // Falha por lineage: revalidável (o carimbo corrige a causa).
    expect(deveRevalidarAposCarimbo({
      name: 'validate:current-run-temporal-integrity', exitCode: 1,
      summary: ['INVALID_AUTHORITATIVE_ARTIFACT reports/coverage-gate-report.json'],
    })).toBe(true);
    // Consumidor declarado do relatório temporal.
    expect(deveRevalidarAposCarimbo({ name: 'validate:required-tests', exitCode: 1, summary: [] })).toBe(true);
    // DEFEITO REAL de outra natureza: NUNCA revalidado (segunda chance mascararia).
    expect(deveRevalidarAposCarimbo({ name: 'validate:release-governance', exitCode: 1, summary: ['package_validation_not_ok'] })).toBe(false);
    expect(deveRevalidarAposCarimbo({ name: 'validate:dist', exitCode: 1, summary: ['check_dist_clean_failed'] })).toBe(false);
    // Quem passou não é reexecutado.
    expect(deveRevalidarAposCarimbo({ name: 'validate:required-tests', exitCode: 0, summary: [] })).toBe(false);
  });
});

describe('lista de validadores vem do package.json (fonte única)', () => {
  it('extrai os MESMOS nomes do agregado, na ordem, sem duplicar', () => {
    const nomes = listarValidadores(pkg);
    expect(nomes.length).toBeGreaterThan(30);
    expect(new Set(nomes).size).toBe(nomes.length);
    for (const esperado of ['validate:ai-memory', 'validate:release-governance', 'validate:dist', 'validate:coverage-gate']) {
      expect(nomes).toContain(esperado);
    }
    // A ordem é a do agregado (o runner preserva a leitura canônica).
    expect(nomes[0]).toBe('validate:ai-memory');
  });

  it('agregado ausente ou vazio é erro explícito (nunca lista vazia silenciosa)', () => {
    expect(() => listarValidadores({ scripts: {} })).toThrow(/ausente/);
    expect(() => listarValidadores({ scripts: { 'validate:governance-enforcement': '' } })).toThrow();
  });

  it('o agregado canônico NÃO foi enfraquecido: continua fail-fast com &&', () => {
    const agregado = pkg.scripts['validate:governance-enforcement'];
    expect(agregado).toContain('&&');
    // E o runner completo é um script SEPARADO, aditivo.
    expect(pkg.scripts['validate:all-validators']).toContain('run-all-validators.js');
    expect(agregado).not.toContain('run-all-validators');
  });
});

describe('relatório completo nunca esconde falha', () => {
  it('status FAIL se QUALQUER validador falhar e exit 1 (fail-closed)', () => {
    const rel = comporRelatorio([
      { name: 'validate:a', exitCode: 0, durationMs: 1, summary: [] },
      { name: 'validate:b', exitCode: 3, durationMs: 1, summary: ['SECURITY_GATE_STALE_EVIDENCE'] },
      { name: 'validate:c', exitCode: 0, durationMs: 1, summary: [] },
    ]);
    expect(rel.total).toBe(3);
    expect(rel.pass).toBe(2);
    expect(rel.fail).toBe(1);
    expect(rel.status).toBe('FAIL');
    expect(rel.falhas).toEqual(['validate:b']);
    expect(calcularExit(rel)).toBe(1);
    // O motivo do validador que falhou fica no relatório (não só o nome).
    expect(rel.results[1].summary).toContain('SECURITY_GATE_STALE_EVIDENCE');
  });

  it('TODOS os validadores executados aparecem no relatório (nada é omitido)', () => {
    const nomes = listarValidadores(pkg);
    const rel = comporRelatorio(nomes.map((name) => ({ name, exitCode: 0, durationMs: 1, summary: [] })));
    expect(rel.results).toHaveLength(nomes.length);
    expect(rel.results.map((r) => r.name)).toEqual(nomes);
    expect(rel.status).toBe('PASS');
    expect(calcularExit(rel)).toBe(0);
  });

  it('relatório declara de ONDE veio a lista (auditável)', () => {
    const rel = comporRelatorio([]);
    expect(rel.origem).toContain('validate:governance-enforcement');
    expect(rel.artifactType).toBe('governance-enforcement-full-report');
  });

  it('resumirSaida descarta ruído do npm e preserva o motivo', () => {
    const saida = '\n> chatbot-engine@1.0.0 validate:x\n> node x.js\n\n[gate] status=FAIL motivo=STALE\n';
    const linhas = resumirSaida(saida, 2);
    expect(linhas[linhas.length - 1]).toContain('STALE');
    expect(linhas.join(' ')).not.toMatch(/chatbot-engine@/);
  });
});

describe('--only não pode virar verde por vacuidade', () => {
  it('nome fora do agregado é ERRO (não "nenhum validador, tudo ok")', () => {
    const nomes = listarValidadores(pkg);
    expect(() => filtrarValidadores(nomes, 'validate:nao-existe')).toThrow(/fora do agregado/);
  });

  it('subset válido preserva a ordem canônica', () => {
    const nomes = listarValidadores(pkg);
    const sub = filtrarValidadores(nomes, 'validate:dist,validate:ai-memory');
    expect(sub).toEqual(['validate:ai-memory', 'validate:dist']);
  });
});

describe('EXECUÇÃO REAL — exit do runner é fail-closed', () => {
  it('com subset que passa: exit 0 e relatório com as entradas', () => {
    // `--no-stamp`: dentro da suíte não se alteram artefatos autoritativos.
    const saida = execFileSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'governance', 'run-all-validators.js'), '--only=validate:release-dag,validate:route-mounts', '--no-stamp'],
      { cwd: ROOT, encoding: 'utf8', timeout: 300000 },
    );
    expect(saida).toContain('status=PASS');
    expect(saida).toContain('lineage NÃO carimbado');
    const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', 'governance-enforcement-full-report.json'), 'utf8'));
    expect(rel.total).toBe(2);
    expect(rel.results.map((r) => r.name)).toEqual(['validate:release-dag', 'validate:route-mounts']);
    expect(rel.lineageStamp).toEqual({ skipped: true, reason: '--no-stamp' });
  });

  it('com validador inexistente: exit != 0 (nunca verde por lista vazia)', () => {    let status = 0;
    let saida = '';
    try {
      saida = execFileSync(
        process.execPath,
        [path.join(ROOT, 'scripts', 'governance', 'run-all-validators.js'), '--only=validate:inexistente'],
        { cwd: ROOT, encoding: 'utf8', timeout: 120000 },
      );
    } catch (erro) {
      status = erro.status;
      saida = `${erro.stdout || ''}${erro.stderr || ''}`;
    }
    expect(status).toBe(1);
    expect(saida).toMatch(/fora do agregado/);
  });
});

describe('o runner não fica cego à mutação da superfície que ele prova', () => {
  /**
   * DEFEITO MEDIDO (2026-10-13): durante uma execução real do runner, um arquivo
   * NOVO foi criado em `scripts/smoke/` — raiz de `SOURCE_ROOTS`. A evidência de
   * runtime foi coletada antes e validada depois, contra um fingerprint já
   * diferente: `validate:engineering-router-v1:runtime` reprovou com
   * RUNTIME_EVIDENCE_FRESH e o operador recebia isso como falha de produto, no
   * fim de um run de ~40 min, sem pista de que a causa era uma edição feita
   * durante o próprio run.
   */
  const {
    mapearSuperficieProvada,
    compararSuperficieProvada,
    atribuirMutacaoDaSuperficie,
  } = require('../../../scripts/governance/lib/governance-enforcement-plan');

  it('a superfície provada é lida pelo mecanismo canônico (não por um walk paralelo)', () => {
    const superficie = mapearSuperficieProvada(ROOT);
    // `scripts/smoke` e `scripts/governance` ESTÃO em SOURCE_ROOTS: foi por isso
    // que criar um arquivo em scripts/smoke invalidou a evidência de runtime.
    expect(Object.keys(superficie).length).toBeGreaterThan(1000);
    expect(Object.keys(superficie).some((f) => f.startsWith('scripts/smoke/'))).toBe(true);
    expect(Object.keys(superficie).some((f) => f.startsWith('scripts/governance/'))).toBe(true);
    // Ruído de execução NUNCA entra: reports/ não é superfície provada.
    expect(Object.keys(superficie).some((f) => f.startsWith('reports/'))).toBe(false);
  });

  it('fotografia igual a si mesma é ESTAVEL; alteração é MUTADA (com o arquivo identificado)', () => {
    const superficie = mapearSuperficieProvada(ROOT);
    expect(compararSuperficieProvada(superficie, superficie).estabilidade).toBe('ESTAVEL');
    expect(compararSuperficieProvada(superficie, superficie).alterados).toEqual([]);

    const modificada = { ...superficie };
    const primeiro = Object.keys(modificada)[0];
    modificada[primeiro] = 'hash-diferente';
    modificada['scripts/smoke/arquivo-criado-durante-o-run.js'] = 'novo';

    const est = compararSuperficieProvada(superficie, modificada);
    expect(est.estabilidade).toBe('MUTADA_DURANTE_O_RUN');
    expect(est.alterados).toContainEqual({ arquivo: primeiro, tipo: 'modificado' });
    expect(est.alterados).toContainEqual({ arquivo: 'scripts/smoke/arquivo-criado-durante-o-run.js', tipo: 'criado' });

    const removida = { ...superficie };
    delete removida[primeiro];
    expect(compararSuperficieProvada(superficie, removida).alterados).toContainEqual({ arquivo: primeiro, tipo: 'removido' });
  });

  it('atribui SOMENTE falhas de obsolescência (nunca por conveniência)', () => {
    const superficie = mapearSuperficieProvada(ROOT);
    const mutada = { ...superficie, 'scripts/smoke/x.js': 'novo' };
    const est = compararSuperficieProvada(superficie, mutada);

    const resultados = [
      { name: 'validate:engineering-router-v1:runtime', exitCode: 1, summary: ['RUNTIME_MODEL_CATALOG_GOVERNANCE: evidência de runtime obsoleta (ver RUNTIME_EVIDENCE_FRESH)'] },
      { name: 'validate:release-governance', exitCode: 1, summary: ['package_validation_not_ok: package-validation-report.json is not ok.'] },
      { name: 'validate:dist', exitCode: 1, summary: ['check_dist_clean_failed: scripts/check-dist-clean.sh failed.'] },
      { name: 'validate:release-dag', exitCode: 0, summary: [] },
    ];

    const atribuidos = atribuirMutacaoDaSuperficie(resultados, est);
    // A falha de pacote NÃO pode ser atribuída à mutação: é causa independente.
    expect(atribuidos).toEqual(['validate:engineering-router-v1:runtime']);
    expect(resultados[1].attributedToSourceMutation).toBeUndefined();
    expect(resultados[2].attributedToSourceMutation).toBeUndefined();
  });

  it('superfície ESTAVEL não atribui nenhuma falha', () => {
    const superficie = mapearSuperficieProvada(ROOT);
    const estavel = compararSuperficieProvada(superficie, superficie);
    const resultados = [
      { name: 'validate:engineering-router-v1:runtime', exitCode: 1, summary: ['evidência de runtime obsoleta'] },
    ];
    expect(atribuirMutacaoDaSuperficie(resultados, estavel)).toEqual([]);
    expect(resultados[0].attributedToSourceMutation).toBeUndefined();
  });

  it('o runner mede a superfície ANTES e DEPOIS e publica a atribuição no relatório', () => {
    const codigo = fs.readFileSync(path.join(ROOT, 'scripts', 'governance', 'run-all-validators.js'), 'utf8');
    // Antes do loop e depois do loop, com o resultado no relatório.
    expect(codigo).toContain('mapearSuperficieProvada(ROOT)');
    expect(codigo).toContain('provenSurfaceStability');
    expect(codigo).toContain('attributedToSourceMutation');
    // A medição precisa vir ANTES de rodar os validadores (senão a mutação
    // durante o run passa despercebida) — é o que fecha o defeito.
    expect(codigo.indexOf('mapearSuperficieProvada(ROOT)')).toBeLessThan(codigo.indexOf('for (const name of alvos)'));
  });
});
