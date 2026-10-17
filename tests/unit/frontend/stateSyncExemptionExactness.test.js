'use strict';

/**
 * ISENÇÕES DE state-sync: EXATIDÃO, NÃO FOLGA
 * (P3 DEF-STATESYNC-EXEMPTION-STALE).
 *
 * A regra do repo é "estado realtime via WebSocket; PROIBIDO setInterval para
 * sincronizar estado". As isenções são por arquivo + CONTAGEM. O defeito medido
 * foi uma isenção declarando 4 timers onde existiam 3 — resíduo que mantém a
 * porta aberta para um timer novo passar sem revisão.
 *
 * Este teste exige os dois lados:
 *   - arquivo com MAIS timers que o permitido ⇒ FALHA (isenção vazada);
 *   - arquivo com MENOS timers que o permitido ⇒ FALHA (isenção obsoleta).
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const ISENCOES = path.join(RAIZ, 'config', 'state-sync-exemptions.json');

/** Remove comentários de linha e de bloco antes de contar (evita falso positivo). */
function semComentarios(fonte) {
  return String(fonte)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const contarTimers = (fonte) => (semComentarios(fonte).match(/\bsetInterval\s*\(/g) || []).length;

describe('isenções de state-sync são exatas', () => {
  const config = JSON.parse(fs.readFileSync(ISENCOES, 'utf8'));

  it('o arquivo declara o contrato e a regra (não é lista solta)', () => {
    expect(config.artifactType).toBe('state-sync-exemptions');
    expect(typeof config.rule).toBe('string');
    expect(Array.isArray(config.entries)).toBe(true);
    expect(config.entries.length).toBeGreaterThan(0);
  });

  it('toda isenção aponta arquivo existente com contagem declarada', () => {
    for (const entrada of config.entries) {
      expect(typeof entrada.file).toBe('string');
      expect(Number.isInteger(entrada.allowedIntervals)).toBe(true);
      expect(fs.existsSync(path.join(RAIZ, entrada.file))).toBe(true);
    }
  });

  it('nenhum arquivo excede a isenção (isenção vazada é FALHA)', () => {
    const vazadas = [];
    for (const entrada of config.entries) {
      const fonte = fs.readFileSync(path.join(RAIZ, entrada.file), 'utf8');
      const real = contarTimers(fonte);
      if (real > entrada.allowedIntervals) {
        vazadas.push({ arquivo: entrada.file, real, permitido: entrada.allowedIntervals });
      }
    }
    expect(vazadas).toEqual([]);
  });

  it('nenhuma isenção está obsoleta (declarar mais do que existe é resíduo)', () => {
    const obsoletas = [];
    for (const entrada of config.entries) {
      const fonte = fs.readFileSync(path.join(RAIZ, entrada.file), 'utf8');
      const real = contarTimers(fonte);
      if (real < entrada.allowedIntervals) {
        obsoletas.push({ arquivo: entrada.file, real, declarado: entrada.allowedIntervals });
      }
    }
    expect(obsoletas).toEqual([]);
  });

  it('o caso medido: WebSocketContext declara 3 timers (era 4 antes do DEF-WS-AUTH)', () => {
    const entrada = config.entries.find((e) => e.file === 'frontend/src/context/WebSocketContext.jsx');
    expect(entrada).toBeTruthy();
    expect(entrada.allowedIntervals).toBe(3);
    const fonte = fs.readFileSync(path.join(RAIZ, entrada.file), 'utf8');
    expect(contarTimers(fonte)).toBe(3);
  });
});
