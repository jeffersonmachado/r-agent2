'use strict';

/**
 * Travas do ponto de entrada de auditoria (`AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md`).
 *
 * Três invariantes, todas nascidas de falhas REAIS desta sessão:
 *
 *  1. `audit:json-persistence --check` precisa ficar PASS. Ela reprovou de verdade
 *     (agg8, exit 1, unknown=2) porque o ponto de entrada escrevia dois `.json` em
 *     `AI_MEMORY/evidence/`, fora da taxonomia canônica de persistência. Este teste
 *     falha se alguém reintroduzir escrita `.json` a partir de `tools/audit/`.
 *  2. O payload embutido no Markdown precisa ser EXTRAÍVEL e PARSEÁVEL — a migração
 *     de `.json` para `.md` não pode ter perdido informação.
 *  3. O `auditEpoch` precisa ser RECALCULÁVEL de forma independente a partir do
 *     payload: o auditor confere sem confiar no arquivo (verificador reimplementado
 *     aqui de propósito, para não compartilhar código com o produtor).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const ARTEFATO = path.join(RAIZ, 'AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md');

/** Stringify canônico — reimplementação independente da do produtor. */
function canonicoIndependente(v) {
  if (Array.isArray(v)) return `[${v.map(canonicoIndependente).join(',')}]`;
  if (v && typeof v === 'object') {
    const chaves = Object.keys(v).sort();
    return `{${chaves.map((k) => `${JSON.stringify(k)}:${canonicoIndependente(v[k])}`).join(',')}}`;
  }
  if (v === undefined) return 'null';
  return JSON.stringify(v);
}

function extrairPayload(markdown) {
  // O payload é o ÚLTIMO bloco cercado do arquivo (a dica de extração no texto
  // também cita a cerca, então buscar a última ocorrência é a regra correta).
  const inicio = markdown.lastIndexOf('```json');
  if (inicio === -1) return null;
  const corpo = markdown.slice(inicio + '```json'.length).split('```')[0];
  return JSON.parse(corpo);
}

describe('AUDIT_ENTRYPOINT.md — invariantes do ponto de entrada de auditoria', () => {
  test('o artefato existe, declara auditEpoch e traz o payload JSON embutido parseável', () => {
    expect(fs.existsSync(ARTEFATO)).toBe(true);
    const md = fs.readFileSync(ARTEFATO, 'utf8');
    expect(md).toMatch(/auditEpoch/i);
    const doc = extrairPayload(md);
    expect(doc).toBeTruthy();
    expect(typeof doc.payload).toBe('object');
    expect(Array.isArray(doc.payload.provas)).toBe(true);
    expect(doc.payload.provas.length).toBeGreaterThan(0);
    expect(typeof doc.payload.git.headAtGeneration).toBe('string');
    // O artefato declara explicitamente que não é `.json` e por quê.
    expect(md).toContain('audit:json-persistence');
  });

  test('todo proof registrado tem veredito e sha256 — nenhuma linha oca', () => {
    const doc = extrairPayload(fs.readFileSync(ARTEFATO, 'utf8'));
    for (const p of doc.payload.provas) {
      expect(typeof p.path).toBe('string');
      expect(p.existe).toBe(true);
      expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(p.veredito).not.toBeNull();
    }
  });

  test('o auditEpoch é RECALCULÁVEL de forma independente a partir do payload', () => {
    const doc = extrairPayload(fs.readFileSync(ARTEFATO, 'utf8'));
    const recalculado = crypto.createHash('sha256').update(canonicoIndependente(doc.payload)).digest('hex');
    expect(doc.auditEpoch.valor).toBe(recalculado);
  });

  test('audit:json-persistence está PASS e sem alvos UNKNOWN (trava da regressão do agg8)', () => {
    // ATENÇÃO — por que este teste NÃO executa `json-persistence-audit.js`:
    // aquele script grava `governance/json-persistence-audit.json` ANTES de checar a flag
    // (`fs.writeFileSync` incondicional em main()). Esse arquivo é artefato AUTORITATIVO do
    // run governado: regravá-lo fora da janela do run faz
    // `validate:current-run-temporal-integrity` reprovar com
    // INVALID_AUTHORITATIVE_ARTIFACT — medido de verdade em 2026-10-16 (mtime 16:47:39 contra
    // fim do agregado 16:33:58, causado por este próprio teste). Um teste de unidade NÃO pode
    // mutar evidência governada. A trava continua: o artefato é regenerado a cada ciclo de
    // validação, então exigir PASS/unknown=0 aqui pega a regressão sem efeito colateral.
    const artefato = path.join(RAIZ, 'governance/json-persistence-audit.json');
    expect(fs.existsSync(artefato)).toBe(true);
    const d = JSON.parse(fs.readFileSync(artefato, 'utf8'));
    expect(d.summary.status).toBe('PASS');
    expect(d.summary.unknown).toBe(0);
    expect(d.summary.deprecated).toBe(0);
    // Nenhum alvo sob AI_MEMORY/ pode ficar UNKNOWN (é isso que reprova o gate).
    // Observação medida em 2026-10-16: existe 1 alvo `AI_MEMORY/hardening-queue.json`
    // classificado como STATIC_VERSIONED_CONFIG, e ele é FALSO POSITIVO do scanner —
    // `tools/audit/generate-audit-entrypoint.js` apenas LÊ a fila; o caminho aparece no
    // mesmo arquivo que escreve o .md e o scanner o trata como alvo de escrita.
    const alvosUnknown = (d.entries || []).filter((e) => /^AI_MEMORY\//.test(e.target) && e.category === 'UNKNOWN');
    expect(alvosUnknown).toHaveLength(0);
  });
});
