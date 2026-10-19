'use strict';

/**
 * CONTRATO DA CADEIA CRIPTOGRÁFICA — TESTES ADVERSARIAIS (missão BUG CLOSURE FIRST §6/§11).
 *
 * DEFEITOS P0 REPRODUZIDOS ANTES DA CORREÇÃO (2026-10-17):
 *
 *   P0-A cadeia VAZIA:
 *     verifyChain({ links: [], chainRoot: GENESIS_HASH })
 *       -> { valid: true }      // 0 elos, raiz inicial de 64 zeros "fecha a conta"
 *
 *   P0-B elos OBRIGATÓRIOS AUSENTES:
 *     um elo com `exists:false` entrava na conta como marcador `missing:<id>` e
 *     NÃO gerava failure; uma cadeia inteira de ausentes podia fechar a raiz
 *       -> { valid: true }
 *
 *   Consequência: `valid: true` sem evidência nenhuma, consumido por gates de
 *   certificação (`assert-canonical-release-decision`, `validate:self-proving`,
 *   `verify-delivery-strict`, selagem).
 *
 * Correção: `verifyChain` = contrato estrutural (conjunto canônico completo,
 * ordem, sem duplicação, arquivos presentes) + hashes. `verifyChainHashes`
 * permanece como matemática diagnóstica — e é explicitamente NÃO certificante.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  GENESIS_HASH,
  ORDEM_CANONICA,
  verifyChain,
  verifyChainHashes,
  verificarContratoEstrutural,
  certifyChain,
  avaliarEstadoDaCadeia,
  sha256File,
  sha256String,
} = require('../../../governance/governance-chain');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-contract-'));

function escrever(nome, conteudo) {
  const abs = path.join(TMP, nome);
  fs.writeFileSync(abs, conteudo);
  return { rel: path.relative(ROOT, abs), abs };
}

/**
 * Constrói uma cadeia COERENTE com os 10 ids canônicos na ordem canônica,
 * com hashes reais dos arquivos em disco.
 */
function cadeiaCanonica({ omitir = null, duplicar = null, inverter = false, adulterarHashDe = null } = {}) {
  const arquivos = {};
  const links = [];
  let cumHash = GENESIS_HASH;

  let ids = [...ORDEM_CANONICA];
  if (omitir) ids = ids.filter((id) => id !== omitir);
  if (inverter) ids = [...ids].reverse();
  if (duplicar) ids = [ids[0], ids[0], ...ids.slice(1)];

  for (const id of ids) {
    if (!arquivos[id]) arquivos[id] = escrever(`${id}.json`, JSON.stringify({ id, v: 1 }));
    const hash = sha256File(arquivos[id].abs);
    const cumulativeHash = sha256String(`${cumHash}:${hash}`);
    links.push({
      id,
      path: arquivos[id].rel,
      exists: true,
      hash: adulterarHashDe === id ? 'f'.repeat(64) : hash,
      cumulativeHash,
      classe: 'DERIVADO',
      imutavelPosSelo: false,
    });
    cumHash = cumulativeHash;
  }

  return { chainRoot: cumHash, links, chainLength: links.length };
}

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('§11 #1 — cadeia VAZIA é rejeitada (P0-A)', () => {
  it('verifyChain({links:[]}) NÃO é válido, mesmo com a raiz do gênesis', () => {
    const r = verifyChain({ links: [], chainRoot: GENESIS_HASH });
    expect(r.valid).toBe(false);
    expect(r.certifiable).toBe(false);
    expect(r.structuralFailures.map((f) => f.reason)).toContain('chain_empty');
  });

  it('a matemática de hash continua diagnosticando a cadeia vazia (mas não certifica)', () => {
    // Prova de não-vacuidade: se `verifyChainHashes` também reprovasse, o teste
    // acima passaria por acidente.
    expect(verifyChainHashes({ links: [], chainRoot: GENESIS_HASH }).valid).toBe(true);
  });
});

describe('§11 #2/#3 — elos obrigatórios ausentes (P0-B)', () => {
  it('cadeia só com elos ausentes é rejeitada', () => {
    const r = verifyChain({
      chainRoot: 'x',
      links: [
        { id: 'package', path: 'nao-existe-a', exists: false },
        { id: 'sidecar_manifest', path: 'nao-existe-b', exists: false },
      ],
    });
    expect(r.valid).toBe(false);
    expect(r.structuralFailures.map((f) => f.reason)).toContain('required_link_missing_file');
  });

  it('UM elo obrigatório ausente derruba a certificação', () => {
    const chain = cadeiaCanonica({ omitir: 'proof_signature' });
    const r = verifyChain(chain);
    expect(r.valid).toBe(false);
    expect(r.structuralFailures.some((f) => f.id === 'proof_signature' && f.reason === 'required_link_absent')).toBe(true);
    expect(r.structuralFailures.map((f) => f.reason)).toContain('links_count_mismatch');
  });

  it('elo declarado presente mas ARQUIVO inexistente é rejeitado', () => {
    const chain = cadeiaCanonica();
    const indice = chain.links.findIndex((l) => l.id === 'blocker_engine');
    chain.links[indice].exists = false;
    const r = verifyChain(chain);
    expect(r.valid).toBe(false);
    expect(r.structuralFailures.some((f) => f.reason === 'required_link_missing_file')).toBe(true);
    // diagnóstico explícito do elo ausente (representável, não certificável)
    expect(r.diagnostics.map((d) => d.id)).toContain('blocker_engine');
  });
});

describe('§11 #4/#5 — duplicação e ordem', () => {
  it('elo duplicado é rejeitado', () => {
    const chain = cadeiaCanonica({ duplicar: 'package' });
    const r = verifyChain(chain);
    expect(r.valid).toBe(false);
    expect(r.structuralFailures.map((f) => f.reason)).toContain('duplicate_link');
  });

  it('ordem canônica alterada é rejeitada', () => {
    const chain = cadeiaCanonica({ inverter: true });
    const r = verifyChain(chain);
    expect(r.valid).toBe(false);
    expect(r.structuralFailures.map((f) => f.reason)).toContain('link_order_invalid');
  });

  it('elo fora do contrato é rejeitado (unexpected_link)', () => {
    const chain = cadeiaCanonica();
    const extra = escrever('extra.json', '{"extra":true}');
    chain.links.push({ id: 'elo_inventado', path: extra.rel, exists: true, hash: sha256File(extra.abs), cumulativeHash: chain.chainRoot });
    const r = verifyChain(chain);
    expect(r.valid).toBe(false);
    expect(r.structuralFailures.map((f) => f.reason)).toContain('unexpected_link');
  });
});

describe('§11 #6 — hash adulterado', () => {
  it('hash de elo alterado derruba a cadeia', () => {
    const chain = cadeiaCanonica({ adulterarHashDe: 'evidence_manifest' });
    const r = verifyChain(chain);
    expect(r.valid).toBe(false);
    expect(r.hashFailures.map((f) => f.reason)).toContain('hash_mismatch');
  });

  it('cadeia canônica coerente é ACEITA (não-vacuidade do contrato)', () => {
    const chain = cadeiaCanonica();
    const r = verifyChain(chain);
    expect(r.structuralFailures).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.certifiable).toBe(true);
    expect(verificarContratoEstrutural(chain)).toEqual([]);
  });
});

describe('consumidores: certificação e avaliação de estado honram o contrato', () => {
  it('certifyChain RECUSA certificar cadeia vazia', () => {
    const chain = { links: [], chainRoot: GENESIS_HASH };
    const r = certifyChain(chain, { origem: 'teste' });
    expect(r.certificada).toBe(false);
    expect(chain.valid).toBe(false);
    expect(r.failures.length).toBeGreaterThan(0);
  });

  it('avaliarEstadoDaCadeia reporta CADEIA_ESTRUTURA_INVALIDA para elo ausente', () => {
    const chain = cadeiaCanonica({ omitir: 'final_readiness' });
    chain.certification = { state: 'CERTIFICADA', checkedAt: '2026-10-17T00:00:00.000Z' };
    chain.valid = true; // declaração falsa
    const estado = avaliarEstadoDaCadeia(chain, { lerMtime: () => Date.parse('2026-10-16T00:00:00.000Z') });
    expect(estado.status).toBe('FAIL');
    expect(estado.codes).toContain('CADEIA_ESTRUTURA_INVALIDA');
    expect(estado.codes).toContain('AUTO_DECLARACAO_DE_VALIDADE_FALSA');
  });

  it('cadeia canônica completa e coerente passa pelo avaliador', () => {
    const chain = cadeiaCanonica();
    chain.valid = true;
    chain.certification = { state: 'CERTIFICADA', checkedAt: '2026-10-17T00:00:00.000Z' };
    const estado = avaliarEstadoDaCadeia(chain, { lerMtime: () => Date.parse('2026-10-16T00:00:00.000Z') });
    expect(estado.status).toBe('PASS');
    expect(estado.recalculadaIntegra).toBe(true);
  });
});

describe('§11 #7 — cadeia de OUTRO run não certifica', () => {
  const { clasificar } = require('../../../governance/canonical-release-decision');

  const gatesCompletos = [
    { id: 'final_governance', status: 'PASS' },
    { id: 'final_readiness', status: 'PASS' },
    { id: 'final_proof', status: 'PASS' },
  ];

  it('gate pertencente a outro runId produz NO_GO', () => {
    // Fonte canônica da identidade em `clasificar` é `input.identidade`.
    const d = clasificar({
      gates: [{ ...gatesCompletos[0], runId: 'run-de-outro-ciclo' }, gatesCompletos[1], gatesCompletos[2]],
      selado: true,
      certificado: true,
      identidade: { runId: 'run-corrente' },
    });
    expect(d.state).toBe('NO_GO');
    expect(String(d.reason)).toContain('GATE_DE_OUTRO_RUN');
  });

  it('com o runId corrente e os três gates, a decisão é CERTIFIED_GO (controle positivo)', () => {
    const d = clasificar({
      gates: gatesCompletos.map((g) => ({ ...g, runId: 'run-corrente' })),
      selado: true,
      certificado: true,
      identidade: { runId: 'run-corrente' },
    });
    expect(d.state).toBe('CERTIFIED_GO');
  });
});
