'use strict';

/**
 * PERSISTÊNCIA JSON: SEM ESCRITA FANTASMA E SEM ALVO FORA DA TAXONOMIA
 * (P2 AUDITORIA-FASE-B-FALSO-POSITIVO-SCANNER-FILA e
 *  P2 HARDENING-…-TAXONOMIA-PERSISTENCIA-AI-MEMORY-EVIDENCE).
 *
 * DEFEITOS MEDIDOS
 * ----------------
 * 1. O scanner de persistência (`governance/json-persistence-audit.js`) reconhece
 *    LEITURA só quando o `path.join` está INLINE dentro de `fs.readFileSync(...)`.
 *    Módulos que resolvem o caminho numa variável e leem depois apareciam como
 *    ESCRITORES da fila oficial — inventário com escrita que não existe.
 * 2. `AI_MEMORY/evidence/` (prova versionada de auditoria) não estava na
 *    taxonomia canônica: qualquer produtor que gravasse ali virava UNKNOWN.
 *
 * CORREÇÃO: `path.resolve` nos leitores (mesmo caminho, sem falso positivo) e o
 * diretório de evidência classificado como configuração versionada.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');

const auditoria = fs.readFileSync(path.join(RAIZ, 'governance', 'json-persistence-audit.js'), 'utf8');
const inventario = JSON.parse(fs.readFileSync(path.join(RAIZ, 'governance', 'json-persistence-audit.json'), 'utf8'));

const LEITORES_DA_FILA = [
  'governance/bug-closure/defect-registry.js',
  'scripts/governance/validate-hardening-queue.js',
  'api/services/devGovernance/pendenciesService.js',
  'tools/audit/generate-audit-entrypoint.js',
];

describe('inventário de persistência — nenhuma escrita fantasma da fila oficial', () => {
  // Alvos da FILA (não dos relatórios que contêm o nome dela).
  const ehAlvoDaFila = (t) => String(t) === 'AI_MEMORY/hardening-queue.json' || String(t) === 'hardening-queue.json';

  it('módulos que apenas LEEM a fila não aparecem como escritores', () => {
    for (const leitor of LEITORES_DA_FILA) {
      const entradas = (inventario.entries || []).filter(
        (e) => String(e.writer) === leitor && ehAlvoDaFila(e.target)
      );
      expect({ leitor, entradas }).toEqual({ leitor, entradas: [] });
    }
  });

  it('os escritores LEGÍTIMOS da fila continuam registrados (não-vacuidade)', () => {
    const escritores = new Set(
      (inventario.entries || [])
        .filter((e) => String(e.target) === 'AI_MEMORY/hardening-queue.json')
        .map((e) => String(e.writer))
    );
    expect(escritores.has('scripts/governance/migrate-hardening-queue.js')).toBe(true);
    expect(escritores.has('scripts/governance/reconcile-hardening-queue.js')).toBe(true);
  });

  it('nenhum alvo de escrita fica sem classificação (UNKNOWN = 0)', () => {
    const desconhecidos = (inventario.entries || []).filter((e) => e.category === 'UNKNOWN');
    expect(desconhecidos).toEqual([]);
    expect(inventario.summary.unknown).toBe(0);
    expect(inventario.summary.status).toBe('PASS');
  });
});

describe('taxonomia — AI_MEMORY/evidence é prova versionada, não runtime', () => {
  it('o diretório está classificado na taxonomia canônica', () => {
    expect(auditoria).toContain("'AI_MEMORY/evidence/': 'STATIC_VERSIONED_CONFIG'");
  });

  it('a fila oficial segue classificada como configuração versionada', () => {
    expect(auditoria).toContain("'AI_MEMORY/hardening-queue.json': 'STATIC_VERSIONED_CONFIG'");
  });

  it('leitores da fila usam path.resolve (leitura não vira alvo de escrita)', () => {
    const registry = fs.readFileSync(path.join(RAIZ, 'governance', 'bug-closure', 'defect-registry.js'), 'utf8');
    expect(registry).toContain('path.resolve(__dirname');
    const validador = fs.readFileSync(path.join(RAIZ, 'scripts', 'governance', 'validate-hardening-queue.js'), 'utf8');
    expect(validador).toMatch(/const FILA = path\.resolve\(/);
  });
});
