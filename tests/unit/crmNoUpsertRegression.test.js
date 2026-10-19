'use strict';

/**
 * Regressão estática do P0-02 — o padrão que causou a transferência de tenant
 * não pode existir no código do CRM.
 *
 * A vulnerabilidade não estava em "um campo mal validado": estava no uso de
 * `Model.upsert` com chave primária apenas `id`, que transforma criação em
 * `ON CONFLICT (id) DO UPDATE` — inclusive do `tenant_key`. Reintroduzir o
 * `upsert` reintroduz o P0. Este teste é a trava.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const ARQUIVOS = [
  'api/modules/crm/routes.js',
  'api/services/crm/crmRecordStore.js',
];

/** Remove comentários: o defeito é o CÓDIGO, não a documentação que o descreve. */
function somenteCodigo(conteudo) {
  return conteudo
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linha) => !linha.trim().startsWith('//'))
    .join('\n');
}

describe('P0-02 — upsert é proibido na persistência do CRM', () => {
  test.each(ARQUIVOS)('%s não contém chamada de upsert', (relativo) => {
    const conteudo = somenteCodigo(fs.readFileSync(path.join(RAIZ, relativo), 'utf8'));
    // aceita "Model.upsert(", "model().upsert(", "sequelize.upsert("
    expect(conteudo).not.toMatch(/\.upsert\s*\(/);
  });

  test('a criação e a atualização são funções distintas no caminho de escrita', () => {
    const rotas = fs.readFileSync(path.join(RAIZ, 'api/modules/crm/routes.js'), 'utf8');
    expect(rotas).toMatch(/function criarRegistro\(/);
    expect(rotas).toMatch(/function atualizarRegistro\(/);
    expect(rotas).toMatch(/criarRegistroStore\(/);
    expect(rotas).toMatch(/atualizarRegistroStore\(/);
  });

  test('a atualização carrega a condição de tenant na própria operação SQL', () => {
    const store = fs.readFileSync(path.join(RAIZ, 'api/services/crm/crmRecordStore.js'), 'utf8');
    const blocoUpdate = store.slice(store.indexOf('async function atualizarRegistro'));
    expect(blocoUpdate).toMatch(/where:\s*\{\s*id:\s*registroId,\s*tenant_key:\s*chave,\s*entity:\s*alvo\s*\}/s);
    const blocoDelete = store.slice(store.indexOf('async function removerRegistro'));
    expect(blocoDelete).toMatch(/where:\s*\{\s*id:\s*registroId,\s*tenant_key:\s*chave,\s*entity:\s*alvo\s*\}/s);
  });

  test('tenant_key nunca é escrito a partir do payload do cliente', () => {
    const store = fs.readFileSync(path.join(RAIZ, 'api/services/crm/crmRecordStore.js'), 'utf8');
    expect(store).toMatch(/delete limpo\.tenant_key/);
    expect(store).toMatch(/delete limpo\.tenantId/);
    expect(store).toMatch(/delete limpo\.tenantKey/);
  });
});
