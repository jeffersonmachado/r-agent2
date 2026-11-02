'use strict';

/**
 * Portabilidade do normalizador da blocklist de payload.
 *
 * DEFEITO MEDIDO (2026-11-02): `release_payload_normalize_entry` removia o
 * prefixo `r-agent2/` FIXO. Num checkout com outro nome de diretório
 * (`/opt/results/ria/er-fixci`, worktree de auditoria) o primeiro segmento de
 * toda entrada do ZIP deixava de ser removido, então `docs/` e
 * `frontend/public/` não casavam mais com a allowlist de imagens e o
 * empacotador reprovava 9 PNGs legítimos:
 *
 *   FORBIDDEN_CONTEXT=runtime-image-outside-approved-assets
 *   er-fixci/docs/manual/img/mfa.png
 *
 * Resultado: `npm run zip:release` abortava no PASS 1 sem produzir o ZIP.
 *
 * O teste extrai a função REAL do script (não duplica a lógica) e prova os dois
 * sentidos: com a raiz declarada o asset aprovado normaliza; sem a declaração
 * (caminho de OUTRA raiz) a imagem continua sendo reprovada.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'release-payload-blocklist.sh');

function normalizar(entry, rootBasename) {
  const prelude = rootBasename === null
    ? 'unset RELEASE_PAYLOAD_ROOT_BASENAME'
    : `RELEASE_PAYLOAD_ROOT_BASENAME='${rootBasename}'`;
  const source = [
    'set -euo pipefail',
    `source '${SCRIPT}'`,
    prelude,
    `release_payload_normalize_entry '${entry}'`,
  ].join('\n');
  return execFileSync('bash', ['-c', source], { encoding: 'utf8' }).trim();
}

function ehImagemPermitida(entry, rootBasename) {
  const prelude = rootBasename === null
    ? 'unset RELEASE_PAYLOAD_ROOT_BASENAME'
    : `RELEASE_PAYLOAD_ROOT_BASENAME='${rootBasename}'`;
  const source = [
    'set -euo pipefail',
    `source '${SCRIPT}'`,
    prelude,
    `if release_payload_is_runtime_image '${entry}'; then echo FORBIDDEN; else echo ALLOWED; fi`,
  ].join('\n');
  return execFileSync('bash', ['-c', source], { encoding: 'utf8' }).trim();
}

describe('normalizador da blocklist de payload respeita a raiz do checkout', () => {
  test('raiz `r-agent2` (caso histórico) continua normalizando', () => {
    expect(normalizar('r-agent2/frontend/public/icons/icon-192.png', 'r-agent2'))
      .toBe('frontend/public/icons/icon-192.png');
    expect(normalizar('r-agent2/docs/manual/img/mfa.png', null))
      .toBe('docs/manual/img/mfa.png');
  });

  test('raiz com OUTRO nome (worktree) também normaliza quando declarada', () => {
    expect(normalizar('er-fixci/docs/manual/img/mfa.png', 'er-fixci'))
      .toBe('docs/manual/img/mfa.png');
    expect(normalizar('er-fixci/frontend/public/icons/icon-512.png', 'er-fixci'))
      .toBe('frontend/public/icons/icon-512.png');
  });

  test('asset aprovado deixa de ser reprovado com a raiz declarada', () => {
    expect(ehImagemPermitida('er-fixci/frontend/public/icons/icon-192.png', 'er-fixci'))
      .toBe('ALLOWED');
    expect(ehImagemPermitida('er-fixci/docs/manual/img/mfa.png', 'er-fixci'))
      .toBe('ALLOWED');
  });

  test('imagem fora da allowlist continua reprovada (nada foi afrouxado)', () => {
    // Raiz errada: o prefixo não é removido, então o caminho não casa com a
    // allowlist — a imagem é reprovada, como antes.
    expect(ehImagemPermitida('er-fixci/frontend/public/icons/icon-192.png', null))
      .toBe('FORBIDDEN');
    // Caminho de OUTRA raiz que imita a estrutura aprovada continua reprovado.
    expect(ehImagemPermitida('outro/frontend/public/icons/icon-192.png', 'er-fixci'))
      .toBe('FORBIDDEN');
    // Diretório de runtime continua reprovado mesmo com a raiz correta.
    expect(ehImagemPermitida('er-fixci/runtime/evidence/shot.png', 'er-fixci'))
      .toBe('FORBIDDEN');
  });
});
