'use strict';

/**
 * Certificação da CADEIA CRIPTOGRÁFICA (P0-2).
 *
 * DEFEITO REAL medido em 2026-10-16: a cadeia (`governance/governance-chain.json` —
 * 10 camadas, cada uma com o hash dos BYTES de um membro) é construída na fase
 * `final` do selo (two-pass), mas o `consolidate` reescreve 4-5 desses membros
 * DEPOIS: `system:go-no-go` regrava evidenciário/proof/readiness/package-validation e
 * `materialize-proof-artifacts` regrava `proof-signature.json`. Nenhum passo
 * reconstruía a cadeia, então TODO ciclo terminava com a cadeia estruturalmente
 * inválida — `governance-chain.js --verify` acusava 9 divergências
 * (hash_mismatch ×5, cumulative_hash_broken ×3, chain_root_mismatch ×1) — e o único
 * gate que recomputa não era executado por ninguém.
 *
 * Este teste protege as duas metades do critério de aceite:
 *   (1) COMPORTAMENTO: qualquer alteração posterior ao hash derruba a verificação;
 *   (2) ORDEM: a certificação acontece DEPOIS de todos os escritores e é verificada
 *       de novo no FECHO do ciclo (alteração posterior ⇒ NO_GO).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  verifyChain,
  caminhosCanonicos,
  GENESIS_HASH,
  ORDEM_CANONICA,
  sha256File,
  sha256String,
} = require('../../../governance/governance-chain');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SELO = path.join(ROOT, 'scripts', 'governance', 'seal-release.sh');

/**
 * SANDBOX COM O LAYOUT CANÔNICO (missão 2026-10-25).
 *
 * Antes esta fixture escrevia `reports/__chain-cert-test.json` DENTRO do repositório e apontava os
 * 10 elos para arquivos irmãos: a matemática de hash fechava, mas os caminhos não eram os canônicos
 * de cada id. Com o contrato de caminho canônico (`verifyChain`, P0 de 2026-10-25), uma cadeia só é
 * válida quando cada id aponta para o arquivo canônico DAQUELE id — então a fixture passou a criar um
 * `raiz` temporário com o MESMO layout de produção e a informar `{ raiz, artifact }` ao verificar.
 * O invariante testado continua o mesmo: o hash cobre os BYTES do documento real.
 */
const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-cert-'));
const ARTEFATO = (() => {
  const dist = path.join(RAIZ, 'dist', 'release');
  fs.mkdirSync(dist, { recursive: true });
  const zipPath = path.join(dist, 'r-agent2-teste.zip');
  const manifestPath = path.join(dist, 'r-agent2-teste.manifest.json');
  fs.writeFileSync(zipPath, 'ZIP-DE-TESTE');
  fs.writeFileSync(manifestPath, JSON.stringify({ artifact: 'teste' }));
  return { zipPath, manifestPath };
})();

const CAMINHOS = (() => {
  const mapa = caminhosCanonicos({ raiz: RAIZ, artifact: ARTEFATO });
  for (const item of mapa) {
    if (!item.resolvido) continue;
    const abs = path.join(RAIZ, item.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (!fs.existsSync(abs)) fs.writeFileSync(abs, JSON.stringify({ elo: item.id }));
  }
  return mapa;
})();

const ALVO_REL = 'reports/__chain-cert-test.json';
const ALVO_ABS = path.join(RAIZ, ALVO_REL);

/**
 * Monta a cadeia ESTRUTURALMENTE canônica (10 elos, ordem do contrato) sobre a raiz sandbox.
 * `caminhoRel` (quando informado) substitui o caminho do PRIMEIRO elo — é assim que os testes de
 * adulteração apontam um elo para outro arquivo.
 */
function cadeiaCanonica(caminhoRel, conteudo) {
  fs.mkdirSync(path.dirname(path.join(RAIZ, ALVO_REL)), { recursive: true });
  fs.writeFileSync(ALVO_ABS, conteudo === undefined ? JSON.stringify({ estado: 'congelado' }) : conteudo);

  let cumHash = GENESIS_HASH;
  const links = CAMINHOS.map((item, i) => {
    const rel = i === 0 && caminhoRel ? caminhoRel : item.path;
    const abs = path.join(RAIZ, rel);
    if (i > 0) fs.writeFileSync(abs, JSON.stringify({ elo: item.id }));
    if (i === 0 && caminhoRel) fs.writeFileSync(abs, fs.readFileSync(ALVO_ABS));
    const hash = sha256File(abs);
    const cumulativeHash = sha256String(`${cumHash}:${hash}`);
    const link = {
      index: i,
      id: item.id,
      path: rel,
      exists: true,
      hash,
      previousHash: i === 0 ? GENESIS_HASH : null,
      cumulativeHash,
    };
    cumHash = cumulativeHash;
    return link;
  });

  return {
    chainRoot: cumHash,
    chainLength: links.length,
    completeChain: true,
    missingLayers: [],
    valid: true,
    links,
  };
}

/** Opções de verificação: raiz sandbox + artefato de teste (mesma forma da produção). */
const VERIFICAR = { raiz: RAIZ, artifact: ARTEFATO };

/** Remove o sandbox inteiro. */
function limparCadeia() {
  fs.rmSync(RAIZ, { recursive: true, force: true });
}

afterAll(() => {
  limparCadeia();
});

describe('cadeia criptográfica — o hash cobre os BYTES do documento', () => {
  it('cadeia íntegra verifica (não-vacuidade: o teste não aprova por construção)', () => {
    // Sem override: todos os 10 elos apontam para o caminho CANÔNICO de cada id dentro do sandbox.
    const cadeia = cadeiaCanonica();
    const r = verifyChain(cadeia, VERIFICAR);
    expect(r.valid).toBe(true);
    expect(r.failures).toEqual([]);

    // Contraprova do MESMO teste: apontar um id para um arquivo que não é o canônico dele — ainda que
    // os hashes sejam recalculados — não certifica.
    const foraDoCanonico = cadeiaCanonica(ALVO_REL, JSON.stringify({ estado: 'congelado' }));
    const adulterada = verifyChain(foraDoCanonico, VERIFICAR);
    expect(adulterada.valid).toBe(false);
    expect(adulterada.structuralFailures.map((f) => f.reason)).toContain('path_not_canonical');
  });

  it('ALTERAR o documento depois do hash ⇒ FAIL com hash_mismatch (critério da missão)', () => {
    const cadeia = cadeiaCanonica(ALVO_REL, JSON.stringify({ estado: 'congelado' }));
    // A alteração posterior — exatamente o que o `consolidate` fazia com os membros
    // certificados ao regravá-los depois da construção da cadeia.
    fs.writeFileSync(ALVO_ABS, JSON.stringify({ estado: 'MODIFICADO depois do hash' }));
    const r = verifyChain(cadeia, VERIFICAR);
    expect(r.valid).toBe(false);
    expect(r.failures.map((f) => f.reason)).toContain('hash_mismatch');
    expect(r.failures[0].id).toBe(ORDEM_CANONICA[0]);
  });

  it('documento certificado REMOVIDO ⇒ file_deleted', () => {
    const cadeia = cadeiaCanonica(ALVO_REL, 'conteudo');
    fs.rmSync(ALVO_ABS, { force: true });
    const r = verifyChain(cadeia, VERIFICAR);
    expect(r.valid).toBe(false);
    expect(r.failures.map((f) => f.reason)).toContain('file_deleted');
  });

  it('cadeia ausente/malformada ⇒ erro explícito (nunca "válida por ausência")', () => {
    expect(verifyChain(null).valid).toBe(false);
    expect(verifyChain({}).error).toBe('chain_missing_or_malformed');
  });
});

describe('selo — a certificação da cadeia está na ORDEM certa (tripwire de P0-2)', () => {
  const fonte = () => fs.readFileSync(SELO, 'utf8');

  it('reconstrói e assina a cadeia no consolidate, pelo caminho SANCIONADO', () => {
    expect(fonte()).toContain('governance/sign-governance.js');
    // `--env-file-if-exists=.env` é obrigatório: sem ele o preSign aborta com
    // REPLAY_SIGNING_KEY_REQUIRED DEPOIS de gravar a cadeia (pior que não rodar).
    expect(fonte()).toMatch(/node --env-file-if-exists=\.env governance\/sign-governance\.js/);
  });

  it('a certificação vem DEPOIS dos escritores de membros certificados', () => {
    const texto = fonte();
    const posNoGo = texto.indexOf('npm run system:go-no-go');
    const posCert = texto.indexOf('governance/sign-governance.js');
    expect(posNoGo).toBeGreaterThan(-1);
    expect(posCert).toBeGreaterThan(posNoGo);
  });

  it('o gate que RECALCULA é executado na certificação E no fecho do ciclo', () => {
    const texto = fonte();
    const invocacoes = texto.split('validate-governance-chain.js').length - 1;
    // meio da fase (após congelar) + fecho (depois de verify:delivered-release).
    expect(invocacoes).toBe(2);
  });

  it('o fecho detém a alteração posterior: o gate vem depois do verify:delivered-release', () => {
    const texto = fonte();
    const ultimoVerifyDelivered = texto.lastIndexOf('npm run verify:delivered-release');
    const ultimaVerificacaoCadeia = texto.lastIndexOf('validate-governance-chain.js');
    expect(ultimaVerificacaoCadeia).toBeGreaterThan(ultimoVerifyDelivered);
  });

  it('propaga o atestado para o workspace (a cópia lida pelo self-proving não fica stale)', () => {
    expect(fonte()).toContain('governance-attestation.json');
    expect(fonte()).toMatch(/cp "\$src" "\$ROOT\/governance\/governance-attestation\.json"/);
  });
});
