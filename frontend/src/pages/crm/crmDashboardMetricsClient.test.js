import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

/**
 * REGRESSÃO — o painel CRM sincroniza estado por PUSH (WebSocket), não por polling.
 *
 * DEFEITOS MEDIDOS (2026-10-19, aba real em `/crm`):
 *
 * 1) ARQUITETURA: `setInterval` de 60 s sincronizando estado. A regra do projeto
 *    PROÍBE polling para estado; o caminho é push. O backend agora emite
 *    `crm.metrics.updated` em toda mutação e a tela assina o evento.
 * 2) ROBUSTEZ: `fetch` cru sem timeout/abort. Com a conexão pendurada, cada poll
 *    deixava uma requisição aberta para sempre; elas se acumulavam, esgotavam o
 *    pool de conexões do browser para a origem e a ABA INTEIRA parava de
 *    responder (até o reload travava), com o console repetindo
 *    `Unexpected end of JSON input` (200 com corpo vazio lido como `response.ok`).
 * 3) UX: o botão "Atualizar" fazia `window.location.reload()` — recarregava a
 *    SPA inteira em vez de refazer a leitura.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const PAGINA = join(AQUI, 'CrmDashboardPage.jsx');

/** Remove comentários para não casar padrões dentro da explicação do defeito. */
function codigoSemComentarios(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linha) => !linha.trim().startsWith('//'))
    .join('\n');
}

describe('CRM painel — realtime por push, leitura resiliente', () => {
  const fonte = readFileSync(PAGINA, 'utf8');
  const codigo = codigoSemComentarios(fonte);

  it('não usa polling para sincronizar estado', () => {
    expect(codigo).not.toContain('setInterval(');
  });

  it('assina o evento crm.metrics.updated via WebSocket', () => {
    expect(codigo).toContain('useWebSocketContext(');
    expect(codigo).toContain("'crm.metrics.updated'");
  });

  it('não usa fetch cru', () => {
    expect(codigo).not.toMatch(/(^|[^.\w])fetch\s*\(/);
  });

  it('usa fetchJson com timeoutMs explícito', () => {
    expect(codigo).toContain('fetchJson(');
    expect(codigo).toMatch(/timeoutMs:\s*\d+/);
  });

  it('guarda contra leituras sobrepostas', () => {
    expect(codigo).toContain('emAndamento');
  });

  it('o botão Atualizar refaz a leitura em vez de recarregar a página', () => {
    expect(codigo).not.toContain('window.location.reload');
    expect(codigo).toMatch(/onClick=\{\(\)\s*=>\s*fetchCrmMetrics\(\)\}/);
  });
});
