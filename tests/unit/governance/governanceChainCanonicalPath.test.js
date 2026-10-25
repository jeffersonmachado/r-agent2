'use strict';

/**
 * P0 — CADEIA CRIPTOGRÁFICA: CAMINHO CANÔNICO POR ID (missão 2026-10-25 §3).
 *
 * VULNERABILIDADE REPRODUZIDA (antes da correção, no HEAD `29372d7a3`):
 * `verifyChainHashes` localizava o arquivo de cada elo por `link.path` — o caminho INFORMADO NO JSON
 * QUE ESTAVA SENDO VERIFICADO. Com ids, ordem e quantidade canônicos preservados, bastava apontar
 * cada id para um ARQUIVO SUBSTITUTO (inclusive em `/tmp`, fora do repositório) e recalcular
 * `hash`/`cumulativeHash`/`chainRoot` para a cadeia inteira fechar:
 *
 *   { valid: true, certifiable: true, checkedLinks: 10,
 *     structuralFailures: [], hashFailures: [],
 *     primeiroPath: "../repro-p0-XXXX/0-package.bin" }
 *
 * Consumidores do campo `valid`: `validate-governance-chain`, `validate-self-proving`,
 * `verify-delivery-strict` e `assert-canonical-release-decision` — todos no caminho certificante.
 *
 * CAUSA RAIZ: a verificação confiava no dado verificado. `verifyChain` passa a derivar o caminho da
 * ARQUITETURA (`buildChainLayers`, o MESMO construtor da cadeia legítima) e a comparar realpath com
 * realpath; elo que não é o arquivo canônico daquele id não certifica.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  GENESIS_HASH,
  ORDEM_CANONICA,
  verifyChain,
  caminhosCanonicos,
  verificarCaminhosCanonicos,
  sha256File,
  sha256String,
} = require('../../../governance/governance-chain');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-canonical-'));

let contador = 0;
function arquivo(prefixo, conteudo) {
  contador += 1;
  const abs = path.join(TMP, `${contador}-${prefixo}.bin`);
  fs.writeFileSync(abs, conteudo === undefined ? `conteudo-${prefixo}-${contador}` : conteudo);
  return abs;
}

/** Monta cadeia em forma canônica (ids/ordem/quantidade) apontando para os arquivos dados. */
function montarCadeia(arquivoPorId) {
  let cumHash = GENESIS_HASH;
  const links = ORDEM_CANONICA.map((id) => {
    const abs = arquivoPorId(id);
    const hash = sha256File(abs);
    cumHash = sha256String(`${cumHash}:${hash}`);
    return { id, path: path.relative(ROOT, abs), exists: true, hash, cumulativeHash: cumHash };
  });
  return { chainRoot: cumHash, links };
}

/** Mapa canônico sintético: cada id aponta para um arquivo REAL do repositório. */
function mapaReal() {
  const candidatos = {
    package: 'package.json',
    sidecar_manifest: 'package-lock.json',
    evidence_manifest: 'governance/evidence-manifest.json',
    final_proof_report: 'governance/final-proof-report.json',
    final_readiness: 'governance/final-readiness-report.json',
    consistency_report: 'governance/final-consistency-report.json',
    cross_report: 'governance/cross-report-validation.json',
    proof_signature: 'governance/proof-signature.json',
    blocker_engine: 'governance/blocker-engine.js',
    package_validation: 'governance/package-validation-report.json',
  };
  return ORDEM_CANONICA.map((id) => ({
    id,
    path: candidatos[id],
    absoluto: path.join(ROOT, candidatos[id]),
    resolvido: true,
  }));
}

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

/** Sandbox mínimo com layout canônico (espelha tests/helpers/chainSandbox.js). */
function criarSandboxLocal() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-canon-'));
  const dist = path.join(raiz, 'dist', 'release');
  fs.mkdirSync(dist, { recursive: true });
  const artifact = { zipPath: path.join(dist, 'a.zip'), manifestPath: path.join(dist, 'a.manifest.json') };
  fs.writeFileSync(artifact.zipPath, 'ZIP');
  fs.writeFileSync(artifact.manifestPath, '{"a":1}');
  const caminhos = caminhosCanonicos({ raiz, artifact });
  for (const item of caminhos) {
    if (!item.resolvido) continue;
    const abs = path.join(raiz, item.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (!fs.existsSync(abs)) fs.writeFileSync(abs, JSON.stringify({ elo: item.id }));
  }
  return {
    raiz,
    caminhos,
    opcoes: { raiz, artifact },
    limpar: () => fs.rmSync(raiz, { recursive: true, force: true }),
  };
}

describe('P0 — o caminho do elo não pode vir do manifesto verificado', () => {
  test('ATAQUE: ids canônicos apontando para arquivos substitutos com hashes recalculados', () => {
    const cadeia = montarCadeia((id) => arquivo(id));
    const falhas = verificarCaminhosCanonicos(cadeia, mapaReal());

    expect(falhas.map((f) => f.reason)).toEqual(expect.arrayContaining(['path_not_canonical']));
    // Um por elo: os 10 ids canônicos foram substituídos.
    expect(falhas.filter((f) => f.reason === 'path_not_canonical')).toHaveLength(ORDEM_CANONICA.length);
  });

  test('ATAQUE: elo apontando para arquivo FORA do repositório (path traversal relativo)', () => {
    const cadeia = montarCadeia((id) => arquivo(id));
    const r = verifyChain(cadeia, { artifact: null, distDir: TMP });

    expect(r.valid).toBe(false);
    expect(r.certifiable).toBe(false);
    const motivos = [...(r.structuralFailures || []), ...(r.hashFailures || [])].map((f) => f.reason);
    expect(motivos).toEqual(expect.arrayContaining(['path_outside_root', 'path_not_canonical']));
  });

  test('ATAQUE: symlink que redireciona o caminho canônico para outro arquivo', () => {
    const alvo = arquivo('alvo-do-symlink');
    const link = path.join(TMP, 'symlink-para-substituto.bin');
    fs.symlinkSync(alvo, link);
    const mapa = mapaReal();
    mapa[7] = { id: 'proof_signature', path: path.relative(ROOT, link), absoluto: link, resolvido: true };

    const cadeia = montarCadeia((id) => (id === 'proof_signature' ? link : arquivo(id)));
    const falhas = verificarCaminhosCanonicos(cadeia, mapa);

    expect(falhas).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'proof_signature', reason: 'path_not_canonical' }),
    ]));
  });

  test('ATAQUE: caminho ABSOLUTO declarado no elo', () => {
    const cadeia = montarCadeia((id) => arquivo(id));
    cadeia.links[2].path = path.join(ROOT, 'governance', 'evidence-manifest.json');
    const falhas = verificarCaminhosCanonicos(cadeia, mapaReal());
    expect(falhas).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'evidence_manifest', reason: 'path_outside_root' }),
    ]));
  });

  test('FAIL-CLOSED: sem artefato de release, package/sidecar_manifest não são certificáveis', () => {
    const mapa = caminhosCanonicos({ distDir: path.join(TMP, 'dist-inexistente') });
    const pacote = mapa.find((m) => m.id === 'package');
    const sidecar = mapa.find((m) => m.id === 'sidecar_manifest');
    expect(pacote.resolvido).toBe(false);
    expect(pacote.path).toBeNull();
    expect(sidecar.resolvido).toBe(false);
    // Os oito elos de caminho fixo continuam resolvidos.
    expect(mapa.filter((m) => m.resolvido)).toHaveLength(8);
  });

  // ── ACHADOS DA REVISÃO ADVERSARIAL DE 2026-10-25 (P0/P2 do revisor) ──────────
  test('ATAQUE (revisor P0): barra final + homônimo em dist/ — o hash vinha do FALLBACK por basename', () => {
    const sandbox = criarSandboxLocal();
    // Substituto homônimo onde o fallback procuraria (dist/release/), com bytes diferentes.
    fs.writeFileSync(path.join(sandbox.raiz, 'dist', 'release', 'evidence-manifest.json'), 'SUBSTITUTO');
    let cumHash = GENESIS_HASH;
    const links = sandbox.caminhos.map((item) => {
      const rel = item.id === 'evidence_manifest' ? `${item.path}/` : item.path; // BARRA FINAL
      const absHash = item.id === 'evidence_manifest'
        ? path.join(sandbox.raiz, 'dist', 'release', 'evidence-manifest.json')
        : path.join(sandbox.raiz, item.path);
      const hash = sha256File(absHash);
      cumHash = sha256String(`${cumHash}:${hash}`);
      return { id: item.id, path: rel, exists: true, hash, cumulativeHash: cumHash };
    });

    const r = verifyChain({ chainRoot: cumHash, links }, sandbox.opcoes);
    expect(r.valid).toBe(false);
    expect(r.certifiable).toBe(false);
    // Os BYTES de certificação vêm do caminho canônico, não do arquivo que o manifesto indicou.
    const motivos = [...(r.structuralFailures || []), ...(r.hashFailures || [])].map((f) => f.reason);
    expect(motivos).toEqual(expect.arrayContaining(['hash_from_canonical_mismatch']));
    sandbox.limpar();
  });

  test('ATAQUE (revisor P2): elo apontando para DIRETÓRIO não faz a verificação lançar', () => {
    const cadeia = montarCadeia((id) => arquivo(id));
    cadeia.links[0].path = 'governance';
    let r;
    expect(() => { r = verifyChain(cadeia, { distDir: path.join(TMP, 'sem-dist') }); }).not.toThrow();
    expect(r.valid).toBe(false);
    expect(r.structuralFailures.map((f) => f.reason)).toContain('path_not_canonical');
  });

  test('CONTRATO: o mapa canônico cobre exatamente os 10 ids, na ordem canônica', () => {
    const mapa = caminhosCanonicos();
    expect(mapa.map((m) => m.id)).toEqual([...ORDEM_CANONICA]);
    for (const item of mapa.filter((m) => m.resolvido)) {
      expect(path.isAbsolute(item.path)).toBe(false);
      expect(item.path.startsWith('..')).toBe(false);
    }
  });

  test('REGRESSÃO: cadeia apontando para os caminhos canônicos REAIS não é reprovada por caminho', () => {
    const mapa = mapaReal();
    const cadeia = montarCadeia((id) => mapa.find((m) => m.id === id).absoluto);
    expect(verificarCaminhosCanonicos(cadeia, mapa)).toEqual([]);

    // E o veredito completo: estrutura + caminho OK, hash OK ⇒ certável.
    const r = verifyChain(cadeia, { artifact: mapa.find((m) => m.id === 'package').absoluto
      ? { zipPath: mapa.find((m) => m.id === 'package').absoluto, manifestPath: mapa.find((m) => m.id === 'sidecar_manifest').absoluto }
      : null });
    expect(r.structuralFailures).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.certifiable).toBe(true);
  });
});
