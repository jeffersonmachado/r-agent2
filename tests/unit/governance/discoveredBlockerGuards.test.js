'use strict';

/**
 * guards dos erros descobertos em 2026-10-05 — cada bloqueio custou um ciclo de
 * selagem; nenhum deles pode depender de alguém lembrar da prosa do commit.
 *
 *   1. ORDEM no gate agregado: os produtores que escrevem relatórios autoritativos
 *      SEM lineage rodam antes do gate temporal; se o `stamp-report-lineage` deixar
 *      de precedê-lo, o gate volta a reprovar com INVALID_AUTHORITATIVE_ARTIFACT.
 *   2. AMBIENTE do coletor de runtime evidence: `ENGINEERING_ROUTER_HOST_REPO_ROOT`
 *      apontando para um não-repo produz 10/25 falhas com o sintoma enganoso
 *      "saída do Jest não pôde ser parseada como JSON".
 *   3. TTL do smoke contínuo: `qa-waves-scheduled-ttl-preflight` é a autoridade única
 *      da avaliação (o `.env` é carregado por ele) e precisa falhar fechado.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');

describe('run status e prova do scorecard — guardas de FIAÇÃO', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  test('o produtor do scorecard RETOMA run falho e SINCRONIZA o desfecho', () => {
    // Sem as duas chamadas, o ponteiro do run volta a divergir do banco — que foi
    // exatamente a origem de `78/78` convivendo com `runStatus=FAILED`.
    const producer = read('scripts/governance/run-persisted-scorecard.js');
    expect(producer).toContain('planRunRecovery');
    expect(producer).toContain('syncRunContextStatus');
  });

  test('o engine valida o status contra a MÁQUINA DE ESTADOS (não uma lista local)', () => {
    const engine = read('governance/master-scorecard-engine.js');
    // A lista local que aceitava FAILED não pode voltar.
    expect(engine).not.toMatch(/ALLOWED_RUN_STATUSES = new Set\(\[\s*'CREATED'/);
    expect(engine).toContain("require('./shared/run-context')");
    expect(engine).toContain('assessCertifiableRunStatus');
  });

  test('o proof set é embutido no MANIFEST canônico (não num arquivo paralelo)', () => {
    const proofEngine = read('governance/proof-engine/index.js');
    expect(proofEngine).toContain('scorecard-evidence-proof');
    expect(proofEngine).toContain('evidenceManifest.scorecardEvidence');
  });

  test('o verifier do payload exige o proof set e não pula evidência em silêncio', () => {
    const verifier = read('scripts/verify-enterprise-governance-v2.sh');
    expect(verifier).toContain('SCORECARD_EVIDENCE_PROOF_MISSING');
    expect(verifier).toContain('SCORECARD_EVIDENCE_HASH_MISMATCH');
    expect(verifier).toContain('TEMPORAL_EVIDENCE_MISSING');
    // O padrão proibido: `if(!fs.existsSync(abs))continue;` sem registrar violação.
    expect(verifier).not.toMatch(/if\(!fs\.existsSync\(abs\)\)continue;/);
  });

  test('o verifier entregue rejeita scorecard com run não-certificável', () => {
    const delivered = read('governance/verify-delivered-release.js');
    expect(delivered).toContain('assessCertifiableRunStatus');
    expect(delivered).toContain('SCORECARD_EVIDENCE_PROOF_INVALID');
  });
});

describe('corpus RAG — ponto cego do estado `indexing`', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  test('o gate MEDE `indexing` preso (antes ele dava HEALTHY com 11 documentos presos)', () => {
    // MEDIDO 2026-10-06: o gate reportou HEALTHY com 11 documentos em `indexing` ORFAO
    // (o reparo os tirou de `failed`, o processo morreu e o estado ficou no meio). O
    // estado simplesmente não era olhado — verde por omissão.
    const gate = read('scripts/governance/validate-rag-index-health.js');
    expect(gate).toContain('RAG_INDEXING_STUCK');
    expect(gate).toContain('STUCK_INDEXING_MINUTES');
    expect(gate).toContain("index_status = 'indexing'");
  });

  test('a janela de tolerância existe (indexação em curso não vira falso positivo)', () => {
    const gate = read('scripts/governance/validate-rag-index-health.js');
    // Sem janela, o próprio ciclo (que cria documentos e os indexa) reprovaria o gate.
    expect(gate).toMatch(/RAG_STUCK_INDEXING_MINUTES\s*\|\|\s*\d+/);
    expect(gate).toContain('INTERVAL');
  });
});

describe('gate agregado — ordem do stamp de lineage', () => {
  const chain = () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const raw = String(pkg.scripts['validate:governance-enforcement'] || '');
    return raw.split('&&').map((step) => step.trim());
  };

  test('o agregado estampa o lineage dos derivados ANTES do gate temporal', () => {
    const steps = chain();
    const stampIdx = steps.findIndex((s) => s.includes('stamp-report-lineage.js'));
    const gateIdx = steps.findIndex((s) => s.includes('validate:current-run-temporal-integrity'));
    expect(stampIdx).toBeGreaterThanOrEqual(0);
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    expect(stampIdx).toBeLessThan(gateIdx);
  });

  test('o stamp vem DEPOIS dos produtores que escrevem sem lineage', () => {
    const steps = chain();
    const stampIdx = steps.findIndex((s) => s.includes('stamp-report-lineage.js'));
    // Produtores do próprio agregado que regeneram artefatos autoritativos sem
    // os campos de lineage (medido 2026-10-05: eram exatamente estes seis).
    const producers = [
      'validate:coverage-completeness',
      'validate:visibility-policy',
      'validate:experience-segregation',
      'validate:coverage-gate',
      'audit:json-persistence',
    ];
    for (const producer of producers) {
      const idx = steps.findIndex((s) => s.includes(producer));
      expect({ producer, found: idx >= 0 }).toEqual({ producer, found: true });
      expect(idx).toBeLessThan(stampIdx);
    }
  });
});

describe('coletor de runtime evidence — guard de ambiente', () => {
  const collector = require('../../../scripts/governance/collect-engineering-router-runtime-evidence');
  const previous = process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT;

  afterEach(() => {
    if (previous === undefined) delete process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT;
    else process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT = previous;
  });

  test('reconhece work tree git (repositório real × diretório comum)', () => {
    expect(collector.isGitWorkTree(ROOT)).toBe(true);
    expect(collector.isGitWorkTree(os.tmpdir())).toBe(false);
  });

  test('recusa a variável apontando para um NÃO-repo (causa medida das 10/25 falhas)', () => {
    process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT = os.tmpdir();
    expect(collector.assertRouterEnvironmentUsable()).toMatchObject({ ok: false });
  });

  test('sem a variável usa o repositório desta aplicação (default correto)', () => {
    delete process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT;
    expect(collector.assertRouterEnvironmentUsable()).toMatchObject({ ok: true, declared: null });
  });
});

describe('TTL do smoke contínuo — autoridade única de avaliação', () => {
  const preflight = require('../../../scripts/governance/qa-waves-scheduled-ttl-preflight');

  test('avalia a evidência REAL e nunca devolve UNAVAILABLE (plumbing saudável)', () => {
    const out = preflight.evaluate(ROOT);
    expect(['OK', 'STALE']).toContain(out.status);
    expect(typeof out.detail).toBe('string');
  });

  test('evidência ausente é UNAVAILABLE (falha fechada, nunca "ok por omissão")', () => {
    const out = preflight.evaluate(path.join(os.tmpdir(), 'ragent2-sem-evidencia'));
    expect(out.status).toBe('UNAVAILABLE');
  });

  test('a fase consolidate do selo reavalia o TTL antes do agregado', () => {
    const seal = fs.readFileSync(path.join(ROOT, 'scripts/governance/seal-release.sh'), 'utf8');
    const consolidate = seal.slice(seal.indexOf('phase_consolidate()'));
    const ttlIdx = consolidate.indexOf('qa-waves-scheduled-ttl-preflight.js');
    const aggregateIdx = consolidate.indexOf('validate:governance-enforcement');
    expect(ttlIdx).toBeGreaterThanOrEqual(0);
    expect(aggregateIdx).toBeGreaterThanOrEqual(0);
    expect(ttlIdx).toBeLessThan(aggregateIdx);
  });

  /**
   * O orquestrador resolve caminhos com `$ROOT` (`scripts/governance/seal-release.sh:53`).
   * MEDIDO 2026-10-06: um guard escrito com `$PROJECT_ROOT` (variável INEXISTENTE)
   * apontava para `/scripts/governance/...`, o node falhava, a saída ficava vazia e
   * o selo abortava em 'não foi possível avaliar a evidência de smoke contínuo'.
   * A ORDEM das linhas estava certa — o guard de ordem não pegava um caminho que
   * não existe. Este teste fecha o buraco: todo `node "$<VAR>/..."` do selo tem de
   * (a) usar uma variável DECLARADA no script e (b) resolver para um arquivo real.
   */
  test('todo script invocado pelo selo existe de fato a partir da variável usada', () => {
    const seal = fs.readFileSync(path.join(ROOT, 'scripts/governance/seal-release.sh'), 'utf8');
    const declared = new Set(
      [...seal.matchAll(/^\s*(?:readonly\s+|export\s+)?([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]),
    );
    const invocations = [...seal.matchAll(/node\s+"\$([A-Z_][A-Z0-9_]*)(\/[^"\s]+)"/g)];
    expect(invocations.length).toBeGreaterThan(0);
    const problems = [];
    for (const [, variable, suffix] of invocations) {
      if (!declared.has(variable)) {
        problems.push(`$${variable} não é declarada no selo (${invocations.length} invocações verificadas)`);
        continue;
      }
      const abs = path.join(ROOT, suffix);
      if (!fs.existsSync(abs)) problems.push(`script inexistente: $${variable}${suffix}`);
    }
    expect(problems).toEqual([]);
  });

  // DEFEITO MEDIDO (2026-10-06): o desfecho do run era decidido em DOIS lugares com
  // a MESMA regra errada (`!== AUTONOMOUS_READY ? FAILED`), e corrigir só o produtor
  // da decisão não bastou — o ponteiro continuava indo para FAILED em PRE_PACKAGE e
  // derrubava o scorecard inteiro. O desfecho tem UMA autoridade: o produtor da
  // decisão expõe `runStatus`; qualquer consumidor lê dali.
  test('o desfecho do run não é reimplementado fora do produtor da decisão', () => {
    const consumidores = [
      'scripts/governance/run-persisted-scorecard.js',
      'scripts/governance/seal-release.sh',
    ];
    const problemas = [];
    for (const rel of consumidores) {
      const abs = path.join(ROOT, rel);
      if (!fs.existsSync(abs)) continue;
      // Comentários fora: o próprio comentário que DOCUMENTA o defeito cita a regra
      // errada entre crases e dispararia o guard (falso positivo medido na 1ª versão).
      const src = fs.readFileSync(abs, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '')
        .replace(/^[ \t]*#.*$/gm, '');
      // `? 'COMPLETED' : 'FAILED'` (ou o inverso) = cópia local da regra de desfecho.
      if (/['"]COMPLETED['"]\s*:\s*['"]FAILED['"]|['"]FAILED['"]\s*:\s*['"]COMPLETED['"]/.test(src)) {
        problemas.push(`${rel} decide o desfecho do run por conta própria`);
      }
    }
    expect(problemas).toEqual([]);
  });
});
