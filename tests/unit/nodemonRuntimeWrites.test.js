'use strict';

/**
 * Regressão: dados de runtime gravados pela API dentro da árvore vigiada pelo
 * nodemon não podem derrubar o servidor dev.
 *
 * Falha observada (QA Mesh 2026-07-27, 3ª corrida): POST/DELETE /templates
 * grava api/frontend/public/templates/qa-tpl-*.json — path sob api/**, vigiado
 * pelo nodemon. Cada escrita disparava "restarting due to changes" e os
 * cenários concorrentes/seguintes morriam com "API temporariamente
 * indisponível" (5 cenários fitness-matricula-* NO_GO colateral).
 *
 * Diferente de api/data/config.json — cujo restart é intencional (aplicar
 * config nova) — template salvo/removido não exige restart.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function loadNodemonIgnore() {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'nodemon.json'), 'utf8'));
  return config.ignore || [];
}

describe('nodemon ignore × diretórios de escrita em runtime', () => {
  test('api/frontend/public/templates (storage de templates) está ignorado', () => {
    const ignore = loadNodemonIgnore();
    const covered = ignore.some((entry) => {
      const normalized = String(entry).replace(/\*\*$/, '').replace(/\/$/, '');
      return normalized.endsWith('api/frontend/public/templates')
        || normalized.endsWith('frontend/public/templates');
    });
    expect(covered).toBe(true);
  });

  test('o diretório de templates realmente é alvo de escrita pela rota', () => {
    // Garante que o teste acima não vira falso positivo se o storage mudar
    // de lugar: a rota deve continuar apontando para frontend/public/templates
    // ou este teste deve ser revisto.
    const routeSource = fs.readFileSync(
      path.join(ROOT, 'api', 'modules', 'platform-content', 'handleTemplatesRoutes.js'),
      'utf8',
    );
    expect(routeSource).toContain('frontend');
    expect(routeSource).toContain('templates');
  });
});
