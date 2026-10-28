'use strict';

/**
 * IMAGEM DE RUNNER DOS WORKFLOWS — regressão de ambiente medida em 2026-10-26.
 *
 * O rótulo `ubuntu-latest` deixou de ser reprodutível: ele passou a resolver para ubuntu-26.04 e o
 * gate de branch quebrou por AMBIENTE, não por código —
 *   * `npx playwright install --with-deps chromium` ⇒ "Playwright does not support chromium on
 *     ubuntu26.04-x64" (run 40303567233), derrubando o job antes de qualquer teste;
 *   * o systemd do 26.04 mudou a redação do diagnóstico ("Unknown key 'X' in section [Unit]") e
 *     `devServicesSupervision` — que exige a mensagem antiga para provar que a verificação não é
 *     vacuosa — falhou no `L0-suite-oficial` (run 40303874392).
 *
 * Os runs de 2026-10-25 eram verdes no mesmo branch: a variável era o runner. A política do
 * repositório passou a ser imagem FIXA, e este teste é o enforcement dela — sem isso o rótulo volta
 * na próxima edição de workflow e o vermelho volta silenciosamente.
 *
 * Vive em `tests/unit/` de propósito: o L0 do gate de branch roda `npm test` (unit + flow + rpa), e é
 * lá que um pin removido precisa doer. `tests/ci/` só é executado por `npm run test:system`, que o
 * gate de branch de desenvolvimento NÃO roda.
 */

const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.join(__dirname, '..', '..', '..', '.github', 'workflows');

// Imagens que o repositório aceita como FIXAS. `-latest` nunca entra: é justamente o rótulo móvel.
const IMAGENS_PERMITIDAS = new Set(['ubuntu-24.04', 'ubuntu-22.04', 'windows-2022', 'macos-14']);

function listarWorkflows() {
  return fs.readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => ({ arquivo: f, conteudo: fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf8') }));
}

/** `runs-on: X` — só a forma simples; `runs-on: [a, b]` e matrizes são coletados também. */
function imagensDeRunner(conteudo) {
  const imagens = [];
  for (const linha of conteudo.split('\n')) {
    const m = linha.match(/^\s*runs-on:\s*(.+?)\s*$/);
    if (!m) continue;
    const valor = m[1].replace(/#.*$/, '').trim();
    if (valor.startsWith('[')) {
      for (const item of valor.slice(1, -1).split(',')) imagens.push(item.trim().replace(/['"]/g, ''));
    } else if (!valor.includes('${{')) {
      imagens.push(valor.replace(/['"]/g, ''));
    }
  }
  return imagens;
}

describe('CI — imagem de runner dos workflows', () => {
  const workflows = listarWorkflows();

  test('existe pelo menos um workflow para policiar (controle positivo)', () => {
    expect(workflows.length).toBeGreaterThanOrEqual(5);
  });

  test('nenhum workflow usa rótulo MÓVEL de runner (`*-latest`)', () => {
    const infratores = [];
    for (const { arquivo, conteudo } of workflows) {
      for (const imagem of imagensDeRunner(conteudo)) {
        if (/-latest$/.test(imagem)) infratores.push(`${arquivo}: runs-on: ${imagem}`);
      }
    }
    expect(infratores).toEqual([]);
  });

  test('toda imagem declarada está na lista de imagens suportadas', () => {
    const desconhecidas = [];
    for (const { arquivo, conteudo } of workflows) {
      for (const imagem of imagensDeRunner(conteudo)) {
        if (!IMAGENS_PERMITIDAS.has(imagem)) desconhecidas.push(`${arquivo}: runs-on: ${imagem}`);
      }
    }
    expect(desconhecidas).toEqual([]);
  });

  test('workflow que instala Playwright usa imagem suportada por ele (não a móvel)', () => {
    const comPlaywright = workflows.filter((w) => /playwright install/.test(w.conteudo));
    expect(comPlaywright.length).toBeGreaterThanOrEqual(2); // e2e + wave-reports + smoke
    for (const { arquivo, conteudo } of comPlaywright) {
      const imagens = imagensDeRunner(conteudo);
      expect(imagens.length).toBeGreaterThan(0);
      for (const imagem of imagens) {
        expect(IMAGENS_PERMITIDAS.has(imagem)).toBe(true);
        expect(imagem).not.toMatch(/-latest$/);
      }
    }
  });
});
