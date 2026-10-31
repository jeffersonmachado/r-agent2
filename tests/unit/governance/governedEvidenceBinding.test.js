'use strict';

/**
 * FASE 3 — BINDING ENTRE EVIDÊNCIA VERSIONADA E O MANIFESTO GOVERNEDO (achado 5 da revisão).
 *
 * DEFEITO REPRODUZIDO: um commit da Fase 3 (`95820c0fa`) levou junto dois relatórios REGERADOS por
 * execução local de testes:
 *   - `reports/tenant-isolation-report.json` perdeu `runId/sourceFingerprint/sourceCommit`;
 *   - `reports/rag-domain-segregation-report.json` virou `status: FAIL` sem lineage.
 * Isso quebra o binding do `governance/evidence-manifest.json`, que guarda o `sha256` dos bytes
 * governados (`9340e595…` e `783fb018…`) — a evidência empacotada deixa de corresponder ao
 * manifesto (`SCORECARD_EVIDENCE_HASH_MISMATCH`) e o `validate:coverage-gate` passa a contar um
 * relatório RAG FAIL "fresco", derrubando o `consolidate` do selo.
 *
 * Causa: `git add -A` depois de rodar a suíte, sem conferência. Este teste é a conferência.
 *
 * O QUE É COMPARADO: os bytes que SHIPAM — `git show HEAD:<path>` — e não o arquivo do worktree.
 * Motivo medido: as próprias suítes (`report:tenant-isolation`, validador de domínio RAG) REGERAM
 * esses dois relatórios a cada execução de `jest tests/unit`, então comparar o worktree tornava o
 * guard dependente da ordem de execução (auto-sabotagem). O contrato que importa é: o que está
 * commitado corresponde ao manifesto governado.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const MANIFESTO = path.join(ROOT, 'governance', 'evidence-manifest.json');

const manifesto = JSON.parse(fs.readFileSync(MANIFESTO, 'utf8'));
const registros = (manifesto.scorecardEvidence && manifesto.scorecardEvidence.records) || [];
const derivados = registros.filter((r) => r && r.path && r.sha256 && r.classification === 'DERIVED_REPORT');
// Última ocorrência por caminho (o manifesto registra o mesmo caminho em mais de um contexto).
const porCaminho = new Map();
for (const registro of derivados) porCaminho.set(registro.path, registro);

describe('P3 — evidência versionada corresponde ao manifesto governedo', () => {
  test('o manifesto declara registros DERIVED_REPORT verificáveis', () => {
    expect(derivados.length).toBeGreaterThan(0);
    expect(porCaminho.size).toBeGreaterThan(0);
  });

  /**
   * O escopo é o que SHIPA: arquivo versionado (`git ls-files`). Artefato de runtime
   * (gitignored) é regerado por qualquer validador local e sua divergência não é deste teste.
   */
  /** Bytes COMMITADOS de um caminho (o que o release leva), não o estado do worktree. */
  const bytesDeHead = (rel) => execFileSync('git', ['show', `HEAD:${rel}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });

  const ehVersionado = (rel) => {
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', rel], { cwd: ROOT, stdio: 'ignore' });
      return true;
    } catch (_) {
      return false;
    }
  };

  test('todo relatório derivado VERSIONADO confere byte-a-byte com o manifesto', () => {
    const divergentes = [];
    const verificados = [];
    for (const [rel, registro] of porCaminho) {
      const abs = path.join(ROOT, rel);
      if (!fs.existsSync(abs)) continue; // artefato de runtime ausente não é divergência
      if (!ehVersionado(rel)) continue; // artefato de runtime (gitignored): fora do escopo
      const sha = crypto.createHash('sha256').update(bytesDeHead(rel)).digest('hex');
      if (sha !== registro.sha256) divergentes.push({ rel, esperado: registro.sha256.slice(0, 12), encontrado: sha.slice(0, 12) });
      else verificados.push(rel);
    }
    expect({ divergentes, verificados: verificados.length }).toEqual({ divergentes: [], verificados: expect.any(Number) });
    expect(verificados.length).toBeGreaterThan(0);
  });

  test('os dois relatórios que já foram reescritos por execução local continuam governados', () => {
    for (const rel of ['reports/tenant-isolation-report.json', 'reports/rag-domain-segregation-report.json']) {
      const registro = porCaminho.get(rel);
      expect(registro).toBeDefined();
      const abs = path.join(ROOT, rel);
      expect(fs.existsSync(abs)).toBe(true);
      const sha = crypto.createHash('sha256').update(bytesDeHead(rel)).digest('hex');
      expect({ rel, sha }).toEqual({ rel, sha: registro.sha256 });
    }
  });
});
