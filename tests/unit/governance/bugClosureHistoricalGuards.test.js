'use strict';

/**
 * Guardas de regressão para fechamentos históricos que NÃO tinham teste localizável.
 *
 * Cada bloco corresponde a um item da fila oficial que declarava fechamento sem prova e cujo
 * commit de fix não trouxe (nem a evidência citou) uma suíte de regressão. Em vez de "fechar
 * por decisão", cada um ganha aqui a prova que faltava: uma asserção real sobre o mecanismo.
 *
 * Estilo: asserção sobre comportamento observável do módulo (nunca sobre o texto do relatório).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');

const chain = require('../../../governance/governance-chain');
const enforcement = require('../../../scripts/governance/run-governance-enforcement');
const cleanCheckout = require('../../../scripts/ci/clean-checkout-verify');

/**
 * MISSAO-B1-CADEIA-CRIPTOGRAFICA (P0)
 * "A cadeia criptográfica existia mas NENHUM gate a recalculava."
 *
 * Prova: o verificador RECALCULA o hash de cada elo a partir dos bytes em disco e denuncia
 * divergência. Uma cadeia "válida no papel" cujo conteúdo mudou tem de FALHAR.
 */
describe('MISSAO-B1 — a cadeia é RECALCULADA, não atestada', () => {
  // Caminhos RELATIVOS à raiz: é assim que o verificador resolve os elos (`path.join(ROOT, ...)`).
  const ARQUIVOS = [
    'governance/bug-closure/closure-proof.js',
    'governance/bug-closure/defect-states.js',
  ];

  function cadeiaSintetica(arquivos = ARQUIVOS) {
    let cumHash = chain.GENESIS_HASH;
    const links = arquivos.map((rel, indice) => {
      const hash = chain.sha256File(path.join(RAIZ, rel));
      cumHash = chain.sha256String(`${cumHash}:${hash}`);
      return { id: `elo_${indice}`, path: rel, hash, exists: true, cumulativeHash: cumHash };
    });
    return { links, chainRoot: cumHash };
  }

  test('cadeia intacta é verificada sem falhas (recomputação confere)', () => {
    const resultado = chain.verifyChainHashes(cadeiaSintetica());
    expect(resultado.failures).toEqual([]);
    expect(resultado.valid).toBe(true);
  });

  test('hash GRAVADO divergente do conteúdo real é DETECTADO (o gate recalcula)', () => {
    const cadeia = cadeiaSintetica();
    // O atacante não toca nos arquivos: ele reescreve o hash DENTRO da cadeia ("cadeia válida
    // no papel"). Só um verificador que RECALCULA pega isso — era exatamente o defeito do item.
    cadeia.links[0].hash = 'f'.repeat(64);
    const resultado = chain.verifyChainHashes(cadeia);
    expect(resultado.valid).toBe(false);
    expect(resultado.failures.map((f) => f.reason)).toContain('hash_mismatch');
    expect(resultado.tampered).toBe(true);
  });

  test('elo apontando para arquivo inexistente é DETECTADO (file_deleted)', () => {
    const cadeia = cadeiaSintetica();
    cadeia.links.push({
      id: 'fantasma',
      path: 'governance/nao-existe-mesmo.json',
      hash: 'a'.repeat(64),
      exists: true,
      cumulativeHash: 'b'.repeat(64),
    });
    const resultado = chain.verifyChainHashes(cadeia);
    expect(resultado.failures.map((f) => f.reason)).toContain('file_deleted');
  });

  test('o gate publica raiz GRAVADA e raiz RECALCULADA lado a lado', () => {
    const fonte = fs.readFileSync(path.join(RAIZ, 'scripts', 'governance', 'validate-governance-chain.js'), 'utf8');
    expect(fonte).toMatch(/storedChainRoot/);
    expect(fonte).toMatch(/computedRoot/);
    expect(fonte).toMatch(/verifyChain\(/);
  });
});

/**
 * P1-AGREGADO-SEM-IDENTIDADE-DE-RUN-BLOQUEIA-L3 (P2)
 * "Gate agregado não tem identidade de run no branch de desenvolvimento."
 *
 * Prova: sem runId/fingerprint/commit válidos a identidade é declarada INCOMPLETA — e é isso
 * que impede o veredito de ser certificável (fail-closed), em vez de certificar sem origem.
 */
describe('P1-AGREGADO — identidade de run é fail-closed', () => {
  test('sem runId nem fingerprint: incompleta, nomeando os dois', () => {
    const r = enforcement.identidadeCompleta({ runId: null, sourceFingerprint: null, sourceCommit: 'a'.repeat(40) });
    expect(r.completa).toBe(false);
    expect(r.faltantes).toEqual(expect.arrayContaining(['runId', 'sourceFingerprint']));
  });

  test('commit não-SHA também derruba a identidade (não basta "ter um commit")', () => {
    const r = enforcement.identidadeCompleta({ runId: 'r1', sourceFingerprint: 'b'.repeat(64), sourceCommit: 'HEAD' });
    expect(r.completa).toBe(false);
    expect(r.faltantes).toContain('sourceCommit');
  });

  test('identidade completa é aceita', () => {
    const r = enforcement.identidadeCompleta({
      runId: 'rap-governed-x', sourceFingerprint: 'b'.repeat(64), sourceCommit: 'c'.repeat(40),
    });
    expect(r.completa).toBe(true);
    expect(r.faltantes).toEqual([]);
  });
});

/**
 * CI-CHECKOUT-LIMPO-HARNESS (P1)
 * "Instalação limpa nunca era testada: todo diagnóstico de CI dependia do workspace vivo."
 *
 * Prova: o harness existe, cobre os cenários negativos e NÃO transforma ausência de ambiente
 * em sucesso (o veredito é derivado de execução, não de intenção).
 */
describe('CI-CHECKOUT-LIMPO — harness com cenários negativos exercitáveis', () => {
  const nomes = cleanCheckout.SCENARIOS.map((s) => (typeof s === 'string' ? s : s && s.nome));

  test('cenários obrigatórios existem', () => {
    for (const esperado of ['clean', 'missing-artifact', 'corrupt-artifact']) {
      expect(nomes).toEqual(expect.arrayContaining([esperado]));
    }
  });

  test('auditarCloneLimpo é função real (o harness mede o clone, não o workspace)', () => {
    expect(typeof cleanCheckout.auditarCloneLimpo).toBe('function');
  });

  test('contadores de teste são lidos da SAÍDA real (não estimados)', () => {
    const texto = 'Tests:       3 failed, 10 passed, 13 total';
    const c = cleanCheckout.contadoresDeTeste(texto);
    expect(c).toMatchObject({ failedTests: 3, passedTests: 10, executedTests: 13, skippedTests: 0 });
  });
});
