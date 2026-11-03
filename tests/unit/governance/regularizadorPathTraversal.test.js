'use strict';

/**
 * P1-A — PATH TRAVERSAL NO REGULARIZADOR (missão Codex 2026-10-23).
 *
 * Defeito reproduzido com filesystem real ANTES da correção: o regularizador montava
 * `path.join(ROOT, 'AI_MEMORY', 'evidence', 'bug-closure-regularization', `${id}.log`)` com o
 * `id` vindo da FILA (dado, não caminho). Um id `../../../../../tmp/p1a-fora-2` criava
 * `/tmp/p1a-fora-2.log` — fora da raiz autorizada.
 *
 * Este arquivo ataca o contrato que passou a valer:
 *   1. `governance/bug-closure/defect-id.js` (allowlist de id + contenção + escrita sem symlink);
 *   2. o regularizador usa ESSE contrato em TODO caminho derivado de id, e recusa o lote inteiro
 *      antes de qualquer efeito.
 *
 * Os testes usam diretório temporário isolado e comprovam ausência de mutação FORA da raiz por
 * snapshot com sha256 — nunca por inspeção visual.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const contrato = require('../../../governance/bug-closure/defect-id');
const regularizador = require('../../../scripts/governance/regularize-bug-closures');

function raiz() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p1a-'));
  fs.mkdirSync(path.join(root, 'AI_MEMORY', 'evidence', 'bug-closure-regularization'), { recursive: true });
  fs.mkdirSync(path.join(root, 'governance', 'bug-closure', 'proofs-drafts'), { recursive: true });
  return root;
}

/** Snapshot recursivo (caminho relativo → sha256) de uma árvore. */
function snapshot(dir) {
  const saida = {};
  const anda = (atual) => {
    for (const e of fs.readdirSync(atual, { withFileTypes: true })) {
      const abs = path.join(atual, e.name);
      const rel = path.relative(dir, abs);
      if (e.isDirectory()) { saida[`${rel}/`] = 'dir'; anda(abs); continue; }
      if (e.isSymbolicLink()) { saida[rel] = `link:${fs.readlinkSync(abs)}`; continue; }
      saida[rel] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    }
  };
  anda(dir);
  return saida;
}

const ATAQUES = [
  '../../outside',
  '../../../tmp/evil',
  '..\\..\\outside',
  '/tmp/absolute',
  'a/../../b',
  '....//....//etc',
  'id\u0000x',
  '',
  ' ',
  'x'.repeat(contrato.TAMANHO_MAXIMO + 1),
  '.oculto',
  '..',
  'C:\\Windows\\System32',
  'id/../../../../fora',
];

describe('P1-A — contrato de identificador de defeito', () => {
  test('todo ataque é recusado com motivo explícito (nunca silencioso)', () => {
    for (const id of ATAQUES) {
      const r = contrato.validarId(id);
      expect(r.ok).toBe(false);
      expect(typeof r.motivo).toBe('string');
      expect(r.motivo.length).toBeGreaterThan(0);
    }
  });

  test('os 135 identificadores históricos da fila continuam válidos (compatibilidade)', () => {
    const fila = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'AI_MEMORY', 'hardening-queue.json'), 'utf8'));
    const r = contrato.validarConjunto(fila.items.map((i) => i.id));
    expect(r.invalidos).toEqual([]);
    expect(r.colisoes).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test('colisão em filesystem case-insensitive é recusada (não "o último vence")', () => {
    const r = contrato.validarConjunto(['P0-1', 'p0-1']);
    expect(r.ok).toBe(false);
    expect(r.colisoes[0].normalizado).toBe('p0-1');
    expect(r.colisoes[0].ids.sort()).toEqual(['P0-1', 'p0-1']);
  });
});

describe('P1-A — resolução de destino e escrita (filesystem real)', () => {
  test('ataque de traversal não cria, não trunca e não remove NADA fora da raiz', () => {
    const base = raiz();
    const fora = raiz(); // árvore vizinha que serve de "mundo exterior"
    fs.writeFileSync(path.join(fora, 'sentinela.txt'), 'INTACTO');
    fs.mkdirSync(path.join(fora, 'sub'));
    fs.writeFileSync(path.join(fora, 'sub', 'outro.txt'), 'INTACTO');
    const antesFora = snapshot(fora);
    // Alvos de escape que os ataques tentariam criar (um por ataque que resolva fora).
    const alvosDeEscape = [
      path.join(os.tmpdir(), 'outside'),
      path.join(os.tmpdir(), 'evil'),
      path.join(os.tmpdir(), 'absolute'),
      path.join(os.tmpdir(), 'b'),
    ];

    for (const id of ATAQUES) {
      const alvo = contrato.resolverDestino({
        rootDir: base, dirRel: path.join('AI_MEMORY', 'evidence', 'bug-closure-regularization'), id, ext: '.log',
      });
      expect(alvo.ok).toBe(false);
    }

    expect(snapshot(fora)).toEqual(antesFora);
    // Nenhum dos alvos de escape foi criado (o helper nunca abriu arquivo).
    for (const alvo of alvosDeEscape) expect(fs.existsSync(alvo)).toBe(false);
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(fora, { recursive: true, force: true });
  }, 60000);

  test('symlink de DIRETÓRIO apontando para fora é recusado (contenção por realpath)', () => {
    const base = raiz();
    const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'p1a-fora-'));
    fs.symlinkSync(fora, path.join(base, 'AI_MEMORY', 'evidence', 'bug-closure-regularization', 'link'), 'dir');
    const alvo = contrato.resolverDestino({
      rootDir: base, dirRel: path.join('AI_MEMORY', 'evidence', 'bug-closure-regularization', 'link'), id: 'P0-1', ext: '.log',
    });
    expect(alvo.ok).toBe(false);
    // Recusa por contenção — o motivo exato depende de qual componente resolve fora.
    expect(['DIR_FORA_DA_RAIZ', 'DESTINO_FORA_DA_RAIZ']).toContain(alvo.motivo);
    expect(fs.readdirSync(fora)).toEqual([]);
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(fora, { recursive: true, force: true });
  }, 60000);

  test('destino que é SYMLINK: recusa e não toca no alvo do link (TOCTOU no ponto de uso)', () => {
    const base = raiz();
    const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'p1a-alvo-'));
    const alvoExterno = path.join(fora, 'vitima.txt');
    fs.writeFileSync(alvoExterno, 'INTACTO');
    const dirEvid = path.join(base, 'AI_MEMORY', 'evidence', 'bug-closure-regularization');
    const destino = path.join(dirEvid, 'P0-1.log');
    fs.symlinkSync(alvoExterno, destino);

    const r = contrato.gravarSemSeguirSymlink(destino, 'CONTEUDO DO ATACANTE');
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('DESTINO_E_SYMLINK');
    expect(fs.readFileSync(alvoExterno, 'utf8')).toBe('INTACTO');
    expect(fs.readlinkSync(destino)).toBe(alvoExterno);
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(fora, { recursive: true, force: true });
  }, 60000);

  test('id legítimo grava dentro da raiz e o conteúdo confere', () => {
    const base = raiz();
    const alvo = contrato.resolverDestino({
      rootDir: base, dirRel: path.join('governance', 'bug-closure', 'proofs-drafts'), id: 'P0-1', ext: '.json',
    });
    expect(alvo.ok).toBe(true);
    expect(contrato.gravarSemSeguirSymlink(alvo.abs, '{"ok":1}\n').ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(alvo.abs, 'utf8'))).toEqual({ ok: 1 });
    expect(alvo.rel.startsWith('governance/bug-closure/proofs-drafts/')).toBe(true);
    fs.rmSync(base, { recursive: true, force: true });
  }, 60000);
});

describe('P1-A — o regularizador usa o contrato em TODO caminho derivado de id', () => {
  test('o código não concatena id cru em caminho (contrato de fonte)', () => {
    const fonte = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'scripts', 'governance', 'regularize-bug-closures.js'), 'utf8');
    for (const proibido of [
      '${defectId}.log',
      '`${r.id}.json`',
      "path.join(DRAFTS, `${item.id}",
      "path.join(DRAFTS_REL, `${item.id}",
      "path.join(dirItens, `${r.id}",
    ]) {
      expect(fonte.includes(proibido)).toBe(false);
    }
    // E o helper de resolução é realmente usado.
    expect(fonte).toContain('defectId.resolverDestino');
    expect(fonte).toContain('defectId.validarConjunto');
  });

  test('executarTeste recusa id inválido ANTES de executar qualquer processo', () => {
    // Se executasse, o comando `npx jest` seria chamado; aqui o contrato aborta primeiro.
    expect(() => regularizador.executarTeste('../../../../../../tmp/p1a-exec', 'tests/unit/x.test.js'))
      .toThrow(/ID_INVALIDO/);
    expect(fs.existsSync(path.join(os.tmpdir(), 'p1a-exec.log'))).toBe(false);
  }, 60000);
});
