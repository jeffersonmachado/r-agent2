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
  GENESIS_HASH,
  ORDEM_CANONICA,
  sha256File,
  sha256String,
} = require('../../../governance/governance-chain');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SELO = path.join(ROOT, 'scripts', 'governance', 'seal-release.sh');

// Arquivo de prova DENTRO do repositório: `verifyChain` resolve `link.path` com
// `path.join(ROOT, ...)`, então o alvo precisa ser relativo à raiz. `reports/` é
// ignorado pelo git — o teste não polui a árvore versionada.
const ALVO_REL = 'reports/__chain-cert-test.json';
const ALVO_ABS = path.join(ROOT, ALVO_REL);

/**
 * Monta a cadeia ESTRUTURALMENTE canônica (10 elos, ordem do contrato) em que o
 * PRIMEIRO elo (id `package`) aponta para `caminhoRel`.
 *
 * Antes era uma cadeia de 1 elo com id `alvo`: a matemática de hash passava, mas
 * a cadeia não era a cadeia canônica. Depois de 2026-10-17 `verifyChain` aplica
 * também o contrato estrutural (10 elos obrigatórios, ordem fixa) — uma cadeia
 * curta não pode ser declarada válida.
 */
function cadeiaCanonica(caminhoRel, conteudo) {
  fs.mkdirSync(path.dirname(path.join(ROOT, caminhoRel)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, caminhoRel), conteudo);

  let cumHash = GENESIS_HASH;
  const links = ORDEM_CANONICA.map((id, i) => {
    const rel = i === 0 ? caminhoRel : `${caminhoRel}.${id}`;
    if (i > 0) fs.writeFileSync(path.join(ROOT, rel), JSON.stringify({ elo: id }));
    const hash = sha256File(path.join(ROOT, rel));
    const cumulativeHash = sha256String(`${cumHash}:${hash}`);
    const link = {
      index: i,
      id,
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

/** Remove os arquivos auxiliares criados por `cadeiaCanonica` (não versionados). */
function limparCadeia(caminhoRel) {
  fs.rmSync(path.join(ROOT, caminhoRel), { force: true });
  for (const id of ORDEM_CANONICA.slice(1)) {
    fs.rmSync(path.join(ROOT, `${caminhoRel}.${id}`), { force: true });
  }
}

afterAll(() => {
  limparCadeia(ALVO_REL);
});

describe('cadeia criptográfica — o hash cobre os BYTES do documento', () => {
  it('cadeia íntegra verifica (não-vacuidade: o teste não aprova por construção)', () => {
    const cadeia = cadeiaCanonica(ALVO_REL, JSON.stringify({ estado: 'congelado' }));
    const r = verifyChain(cadeia);
    expect(r.valid).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('ALTERAR o documento depois do hash ⇒ FAIL com hash_mismatch (critério da missão)', () => {
    const cadeia = cadeiaCanonica(ALVO_REL, JSON.stringify({ estado: 'congelado' }));
    // A alteração posterior — exatamente o que o `consolidate` fazia com os membros
    // certificados ao regravá-los depois da construção da cadeia.
    fs.writeFileSync(ALVO_ABS, JSON.stringify({ estado: 'MODIFICADO depois do hash' }));
    const r = verifyChain(cadeia);
    expect(r.valid).toBe(false);
    expect(r.failures.map((f) => f.reason)).toContain('hash_mismatch');
    expect(r.failures[0].id).toBe(ORDEM_CANONICA[0]);
  });

  it('documento certificado REMOVIDO ⇒ file_deleted', () => {
    const cadeia = cadeiaCanonica(ALVO_REL, 'conteudo');
    fs.rmSync(ALVO_ABS, { force: true });
    const r = verifyChain(cadeia);
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
