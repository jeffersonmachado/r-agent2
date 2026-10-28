'use strict';

/**
 * APARÊNCIA DE VALIDADE DA CADEIA CRIPTOGRÁFICA (FASE 6 / P0 — 2026-10-16).
 *
 * DEFEITO REAL medido e reproduzido ANTES desta correção:
 *
 *   A. artefato persistido    : valid=true, completeChain=true, missingLayers=[]
 *   B. recalculado dos bytes  : 9 divergências, computedRoot diferente
 *   C. escritas posteriores   : 6 elos gravados até 9869 s DEPOIS da certificação
 *   D. conclusão do agregado  : `validate:self-proving` (passo 15) = PASS
 *
 * Causa-raiz: `buildChain()` gravava `valid: completeChain`, isto é, a palavra
 * "válido" significava apenas "todos os arquivos existem" — nenhum hash era
 * recalculado. Esse rótulo era persistido em disco e lido como VEREDITO pelo gate
 * de self-proving. Cadeia certificada com aparência de válida sobre conteúdo
 * alterado: exatamente o que a FASE 6 proíbe.
 *
 * Este teste protege as três metades do critério de aceite:
 *   (1) DECLARAÇÃO — o build não declara validade que não mediu;
 *   (2) CONTRADIÇÃO — declarar validade contra a recalculação é FAIL nomeado;
 *   (3) TEMPO       — elo gravado depois da certificação invalida a certificação.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  GENESIS_HASH,
  CLASSIFICACAO_ELOS,
  ORDEM_CANONICA,
  buildChain,
  certifyChain,
  verifyChain,
  verifyChainHashes,
  avaliarEstadoDaCadeia,
  elosPorClasse,
  sha256File,
  sha256String,
} = require('../../../governance/governance-chain');

const ROOT = path.resolve(__dirname, '..', '..', '..');

// Fixtures fora da árvore versionada. `verifyChain` resolve `link.path` com
// `path.join(ROOT, ...)`, então usamos caminhos relativos que sobem para um
// diretório temporário — o teste não polui o repositório.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-appearance-'));
const alvoRel = (nome) => path.relative(ROOT, path.join(TMP, nome));
const alvoAbs = (nome) => path.join(TMP, nome);

/** Monta a cadeia ESTRUTURALMENTE canônica (10 elos, ordem do contrato) com os
 * hashes EXATAMENTE como `verifyChain` calcula.
 *
 * Antes esta fixture montava 2 elos arbitrários ('a','b'): passava na matemática
 * de hash e reprovava no contrato estrutural — a mesma classe de "aparência de
 * validade" que este arquivo combate (cadeia curta não é cadeia completa).
 * Os dois primeiros elos continuam gravados como `a.json`/`b.json` porque os
 * testes de adulteração escrevem nesses arquivos.
 */
function cadeiaCoerente({ certificada = false, checkedAt = '2026-10-16T00:00:00.000Z' } = {}) {
  const arquivos = ORDEM_CANONICA.map((id, i) => {
    const nome = i === 0 ? 'a.json' : i === 1 ? 'b.json' : `elo-${id}.json`;
    return [id, nome, JSON.stringify({ elo: id, v: 1 })];
  });

  let cumHash = GENESIS_HASH;
  const links = arquivos.map(([id, nome, conteudo], i) => {
    fs.writeFileSync(alvoAbs(nome), conteudo);
    const hash = sha256File(alvoAbs(nome));
    const cumulativeHash = sha256String(`${cumHash}:${hash}`);
    const link = {
      index: i,
      id,
      path: alvoRel(nome),
      exists: true,
      hash,
      previousHash: i === 0 ? GENESIS_HASH : null,
      cumulativeHash,
    };
    cumHash = cumulativeHash;
    return link;
  });

  return {
    generatedAt: checkedAt,
    chainRoot: cumHash,
    chainLength: links.length,
    completeChain: true,
    missingLayers: [],
    valid: certificada,
    verification: certificada ? 'RECALCULADA_INTEGRA' : 'NAO_VERIFICADA_PELO_BUILD',
    certification: certificada
      ? { state: 'CERTIFICADA', origem: 'teste', checkedAt, certifiedAt: checkedAt }
      : null,
    links,
  };
}

/** `lerMtime` injetado: tudo ANTES da referência de certificação (nenhuma escrita posterior). */
const mtimeAnterior = () => Date.parse('2026-10-15T00:00:00.000Z');
/** `lerMtime` injetado: tudo DEPOIS da referência (escrita posterior à certificação). */
const mtimePosterior = () => Date.parse('2026-10-17T00:00:00.000Z');

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

/**
 * Artefato sintético: `buildChain` só precisa de ZIP/manifesto/commit para montar
 * as camadas. Os arquivos são os das fixtures (existem de verdade, então o build
 * mede existência real em vez de aprovar por construção).
 */
function artefatoSintetico() {
  fs.writeFileSync(alvoAbs('a.json'), JSON.stringify({ elo: 'a', v: 1 }));
  fs.writeFileSync(alvoAbs('b.json'), JSON.stringify({ elo: 'b', v: 1 }));
  return {
    zip: 'candidato.zip',
    zipPath: alvoAbs('a.json'),
    manifestPath: alvoAbs('b.json'),
    manifest: { git_commit: 'a'.repeat(40) },
  };
}

/**
 * Remove comentários antes de procurar padrões de código. Sem isto o teste
 * falharia por causa das próprias notas que documentam o defeito corrigido.
 */
function semComentarios(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linha) => !linha.trim().startsWith('//'))
    .join('\n');
}

describe('(1) DECLARAÇÃO — o build não declara validade que não mediu', () => {
  it('buildChain marca valid=false e diz explicitamente que NÃO verificou', () => {
    const chain = buildChain(artefatoSintetico());
    expect(chain.valid).toBe(false);
    expect(chain.verification).toBe('NAO_VERIFICADA_PELO_BUILD');
    expect(chain.certification).toBeNull();
  });

  it('buildChain continua medindo COMPLETUDE (não confundir os dois conceitos)', () => {
    const chain = buildChain(artefatoSintetico());
    expect(typeof chain.completeChain).toBe('boolean');
    expect(Array.isArray(chain.missingLayers)).toBe(true);
  });

  it('todo elo declara classe, escritor e imutabilidade pós-selo (classificação exigida pela FASE 6)', () => {
    const chain = buildChain(artefatoSintetico());
    for (const link of chain.links) {
      expect(['CANONICO', 'DERIVADO']).toContain(link.classe);
      expect(typeof link.escritor).toBe('string');
      expect(link.escritor.length).toBeGreaterThan(0);
      expect(typeof link.imutavelPosSelo).toBe('boolean');
    }
  });

  it('a classificação separa fontes canônicas de relatórios derivados (10 elos conhecidos)', () => {
    expect(Object.keys(CLASSIFICACAO_ELOS)).toHaveLength(10);
    expect(elosPorClasse({ links: [] }, 'CANONICO')).toEqual([]);
    const canonicos = Object.entries(CLASSIFICACAO_ELOS)
      .filter(([, v]) => v.classe === 'CANONICO').map(([k]) => k);
    const derivados = Object.entries(CLASSIFICACAO_ELOS)
      .filter(([, v]) => v.classe === 'DERIVADO').map(([k]) => k);
    // O ZIP/manifesto/fonte do engine são imutáveis pós-selo; os RELATÓRIOS são
    // reescritos pela própria maquinaria de governança e por isso não podem ser
    // tratados como equivalentes.
    expect(canonicos.sort()).toEqual(['blocker_engine', 'package', 'sidecar_manifest']);
    expect(derivados).toContain('evidence_manifest');
    expect(derivados).toContain('proof_signature');
    expect(derivados).toHaveLength(7);
  });
});

describe('(2) CONTRADIÇÃO — declarar validade contra a recalculação é FAIL nomeado', () => {
  it('cadeia declarada válida com elo ALTERADO ⇒ AUTO_DECLARACAO_DE_VALIDADE_FALSA', () => {
    const chain = cadeiaCoerente({ certificada: true });
    fs.writeFileSync(alvoAbs('b.json'), JSON.stringify({ elo: 'b', v: 'ALTERADO depois do hash' }));

    const estado = avaliarEstadoDaCadeia(chain, { verificar: verifyChainHashes, lerMtime: mtimeAnterior });
    expect(estado.status).toBe('FAIL');
    expect(estado.recalculadaIntegra).toBe(false);
    expect(estado.autoDeclaracao).toBe('FALSA');
    expect(estado.codes).toContain('CADEIA_DIVERGENTE');
    expect(estado.codes).toContain('AUTO_DECLARACAO_DE_VALIDADE_FALSA');
  });

  it('o caso MEDIDO no repositório: valid=true + completeChain=true + divergência nunca é PASS', () => {
    // Reprodução fiel do artefato encontrado: declaração completa e otimista.
    const chain = cadeiaCoerente({ certificada: true });
    chain.completeChain = true;
    chain.missingLayers = [];
    fs.writeFileSync(alvoAbs('a.json'), '{ "elo": "a", "v": 2 }');

    const estado = avaliarEstadoDaCadeia(chain, { verificar: verifyChainHashes, lerMtime: mtimeAnterior });
    expect(estado.status).not.toBe('PASS');
    expect(estado.autoDeclaracao).toBe('FALSA');
  });

  it('declarar validade SEM declarar quem/quando certificou é FAIL (declaração não auditável)', () => {
    const chain = cadeiaCoerente();
    chain.valid = true;               // declara validade
    chain.certification = null;       // mas não diz quem certificou nem quando
    const estado = avaliarEstadoDaCadeia(chain, { verificar: verifyChainHashes, lerMtime: mtimeAnterior });
    expect(estado.status).toBe('FAIL');
    expect(estado.autoDeclaracao).toBe('SEM_CERTIFICACAO');
    expect(estado.codes).toContain('AUTO_DECLARACAO_DE_VALIDADE_SEM_CERTIFICACAO');
  });

  it('cadeia coerente e certificada, sem escritas posteriores ⇒ PASS', () => {
    const chain = cadeiaCoerente({ certificada: true });
    const estado = avaliarEstadoDaCadeia(chain, { verificar: verifyChainHashes, lerMtime: mtimeAnterior });
    expect(estado.status).toBe('PASS');
    expect(estado.autoDeclaracao).toBe('VALIDA');
    expect(estado.codes).toEqual([]);
  });

  it('cadeia íntegra mas apenas construída (não certificada) ⇒ PASS sem auto-declaração', () => {
    const chain = cadeiaCoerente({ certificada: false });
    const estado = avaliarEstadoDaCadeia(chain, { verificar: verifyChainHashes, lerMtime: mtimeAnterior });
    expect(estado.status).toBe('PASS');
    expect(estado.autoDeclaracao).toBe('AUSENTE');
  });
});

describe('(3) TEMPO — escritas posteriores à certificação', () => {
  it('conteúdo IDÊNTICO reescrito depois ⇒ registra a informação e NÃO reprova', () => {
    // MEDIDO 2026-10-16: `git checkout` restaurou bytes idênticos e a regra
    // antiga reprovava. Conteúdo comprovadamente igual (mesmo hash) não invalida
    // certificação alguma — reprovar ali é falso NO_GO.
    const chain = cadeiaCoerente({ certificada: true, checkedAt: '2026-10-16T00:00:00.000Z' });
    const estado = avaliarEstadoDaCadeia(chain, { verificar: verifyChainHashes, lerMtime: mtimePosterior });
    expect(estado.status).toBe('PASS');
    expect(estado.codes).not.toContain('CERTIFICACAO_ULTRAPASSADA_POR_ESCRITA');
    expect(estado.escritasPosteriores.ids.sort()).toEqual(['blocker_engine', 'consistency_report', 'cross_report', 'evidence_manifest', 'final_proof_report', 'final_readiness', 'package', 'package_validation', 'proof_signature', 'sidecar_manifest'].sort());
    expect(estado.escritasPosteriores.comConteudoAlterado).toEqual([]);
    expect(estado.escritasPosteriores.detalhes.every((d) => d.conteudoIdentico)).toBe(true);
  });

  it('conteúdo ALTERADO depois da certificação ⇒ CERTIFICACAO_ULTRAPASSADA_POR_ESCRITA', () => {
    const chain = cadeiaCoerente({ certificada: true, checkedAt: '2026-10-16T00:00:00.000Z' });
    // Bytes realmente trocados DEPOIS da certificação, e mtime posterior.
    fs.writeFileSync(alvoAbs('b.json'), JSON.stringify({ elo: 'b', v: 'TROCADO' }));
    const estado = avaliarEstadoDaCadeia(chain, { verificar: verifyChainHashes, lerMtime: mtimePosterior });
    expect(estado.status).toBe('FAIL');
    expect(estado.codes).toContain('CERTIFICACAO_ULTRAPASSADA_POR_ESCRITA');
    expect(estado.escritasPosteriores.comConteudoAlterado).toEqual(['sidecar_manifest']);
    expect(estado.codes).toContain('CADEIA_DIVERGENTE');
  });

  it('a referência de tempo é a da CERTIFICAÇÃO, não a do build', () => {
    const chain = cadeiaCoerente({ certificada: true, checkedAt: '2026-10-16T00:00:00.000Z' });
    chain.generatedAt = '2026-01-01T00:00:00.000Z';
    fs.writeFileSync(alvoAbs('a.json'), '{ "elo": "a", "v": 9 }');
    const estado = avaliarEstadoDaCadeia(chain, { verificar: verifyChainHashes, lerMtime: mtimePosterior });
    expect(estado.codes).toContain('CERTIFICACAO_ULTRAPASSADA_POR_ESCRITA');
  });
});

describe('certifyChain — recalcula antes de rotular', () => {
  it('cadeia coerente ⇒ CERTIFICADA com data e raiz medidas', () => {
    const chain = cadeiaCoerente();
    const r = certifyChain(chain, { origem: 'teste', agora: '2026-10-16T12:00:00.000Z', verificar: verifyChainHashes });
    expect(r.certificada).toBe(true);
    expect(chain.valid).toBe(true);
    expect(chain.verification).toBe('RECALCULADA_INTEGRA');
    expect(chain.certification.state).toBe('CERTIFICADA');
    expect(chain.certification.certifiedAt).toBe('2026-10-16T12:00:00.000Z');
    expect(chain.certification.computedRoot).toBe(chain.chainRoot);
    expect(chain.certification.divergencias).toEqual([]);
  });

  it('cadeia divergente ⇒ NÃO certifica, grava DIVERGENTE e mantém valid=false', () => {
    const chain = cadeiaCoerente();
    fs.writeFileSync(alvoAbs('a.json'), '{ "elo": "a", "v": 99 }');
    const r = certifyChain(chain, { origem: 'teste', agora: '2026-10-16T12:00:00.000Z', verificar: verifyChainHashes });
    expect(r.certificada).toBe(false);
    expect(chain.valid).toBe(false);
    expect(chain.verification).toBe('RECALCULADA_DIVERGENTE');
    expect(chain.certification.state).toBe('DIVERGENTE');
    expect(chain.certification.certifiedAt).toBeNull();
    expect(chain.certification.divergencias.map((d) => d.id)).toContain('package');
  });

  it('certificar não é tautológico: o veredito deriva dos bytes, não do rótulo de entrada', () => {
    const chain = cadeiaCoerente({ certificada: true });   // entra dizendo que é válida
    fs.writeFileSync(alvoAbs('b.json'), '{ "elo": "b", "v": 2 }'); // e não é
    const r = certifyChain(chain, { origem: 'teste' });
    expect(r.certificada).toBe(false);
    expect(chain.valid).toBe(false);
  });
});

describe('fiação — os gates consomem o veredito recalculado, nunca o campo persistido', () => {
  const ler = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  it('validate:self-proving recalcula e compara declaração com realidade', () => {
    const fonte = semComentarios(ler('scripts/governance/validate-self-proving.js'));
    expect(fonte).toContain('avaliarEstadoDaCadeia');
    expect(fonte).toContain('loadChain');
    // O padrao antigo — ler o campo gravado — e o defeito medido.
    expect(fonte).not.toContain('governanceChain.valid === true');
    expect(fonte).not.toContain('governanceChain.chainValid === true');
  });

  it('o gate da cadeia publica os códigos de aparência de validade no relatório', () => {
    const fonte = ler('scripts/governance/validate-governance-chain.js');
    expect(fonte).toContain('avaliarEstadoDaCadeia');
    expect(fonte).toContain('autoDeclaracao');
    expect(fonte).toContain('escritasPosteriores');
    expect(fonte).toContain('classificacaoElos');
  });

  it('o caminho canônico de assinatura certifica antes de assinar', () => {
    const fonte = ler('governance/sign-governance.js');
    expect(fonte).toContain('certifyChain');
    expect(fonte).toContain('CADEIA_NAO_CERTIFICAVEL');
    // O preSign assinava a raiz sem nunca verificar.
    expect(fonte).toMatch(/certifyChain\(chain,\s*\{/);
  });

  it('verifyChain continua sendo a autoridade de hash usada pela avaliação', () => {
    // A fixture vive FORA da árvore canônica de propósito (não polui o repositório). O que este
    // teste mede é a MATEMÁTICA de hash: elo alterado ⇒ raiz não confere. Desde a missão de
    // 2026-10-25, `verifyChain` TAMBÉM exige que cada id aponte para o caminho canônico — contrato
    // coberto por `governanceChainCanonicalPath.test.js`, que constrói a cadeia sobre os arquivos
    // canônicos reais.
    const chain = cadeiaCoerente({ certificada: true });
    expect(verifyChainHashes(chain).valid).toBe(true);
    fs.writeFileSync(alvoAbs('a.json'), 'x');
    expect(verifyChainHashes(chain).valid).toBe(false);

    // E o contrato canônico REPROVA esta fixture (caminhos fora da árvore) — prova de que a
    // autoridade de certificação não é a matemática isolada.
    expect(verifyChain(chain).valid).toBe(false);
    expect(verifyChain(chain).structuralFailures.map((f) => f.reason)).toContain('path_not_canonical');
  });
});
