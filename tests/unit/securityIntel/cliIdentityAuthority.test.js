'use strict';

/**
 * H2 (corrigido 2026-10-11) — identidade do CLI de segurança NÃO é declarada.
 *
 * DEFEITO: `--actor` definia o SOLICITANTE da isenção (`requester = args.actor ||
 * currentOsUser()`). Como a segregação de funções compara solicitante × aprovador,
 * declarar o solicitante deixava qualquer um escolher quem aparece como autor do
 * pedido no registro de auditoria — planting de identidade, e um caminho indireto
 * para contornar o SoD escolhendo um "solicitante" conveniente.
 *
 * A aprovação já era protegida (`resolveCliApprover`); agora a MESMA política vale
 * para execução/solicitação/revogação/scan. Estes testes cobrem a regra pura E o
 * comportamento real do processo (exit code), porque "recusar" só vale se o comando
 * de fato NÃO seguir.
 */

const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', '..', '..', 'scripts', 'security-intel.js');
const { currentOsUser, resolveCliActor, resolveCliApprover } = require('../../../scripts/security-intel');

const OS_USER = currentOsUser();

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60000 });
}

describe('H2 — regra de identidade do CLI (função pura)', () => {
  it('sem declaração, a identidade é o usuário do SO', () => {
    expect(OS_USER).toBeTruthy();
    expect(resolveCliActor(undefined, 'waive')).toBe(OS_USER);
    expect(resolveCliActor('', 'waive')).toBe(OS_USER);
  });

  it('declarar OUTRA pessoa é recusado (execução e aprovação)', () => {
    expect(resolveCliActor('outra-pessoa', 'waive')).toBeNull();
    expect(resolveCliApprover('outra-pessoa', 'waive-approve')).toBeNull();
  });

  it('reafirmar o próprio usuário é aceito (não é identidade autodeclarada)', () => {
    expect(resolveCliActor(OS_USER, 'scan')).toBe(OS_USER);
    expect(resolveCliApprover(OS_USER, 'patch-mission')).toBe(OS_USER);
  });

  it('espaços não viram identidade válida diferente do usuário', () => {
    expect(resolveCliActor(`  ${OS_USER}  `.trim(), 'scan')).toBe(OS_USER);
    expect(resolveCliActor('   ', 'scan')).toBe(OS_USER); // vazio após trim = reafirmação vazia
  });
});

describe('H2 — comportamento do processo (integração real, sem mock)', () => {
  it('`waive --actor <outro>` sai != 0 e NÃO solicita isenção', () => {
    const result = runCli([
      'waive',
      '--finding', 'GHSA-teste|npm:x@1.0.0#RESOLVED#api#x',
      '--actor', 'outra-pessoa',
      '--days', '30',
      '--reason', 'teste de identidade autodeclarada com mais de vinte caracteres',
    ]);
    expect(result.status).toBe(2);
    const saida = `${result.stdout}${result.stderr}`;
    expect(saida).toMatch(/identidade de execução não é declarada/);
    // A prova de que NADA foi criado: nenhuma linha de sucesso aparece.
    expect(saida).not.toMatch(/SOLICITADA/);
  });

  it('`waive-approve --approve <outro>` sai != 0 (aprovação nunca foi declarada, e segue assim)', () => {
    const result = runCli(['waive-approve', '--waiver', 'chave-qualquer', '--approve', 'outra-pessoa']);
    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toMatch(/identidade de aprovação não é declarada/);
  });

  it('`scan --actor <outro>` sai != 0 antes de varrer componentes', () => {
    const result = runCli(['scan', '--actor', 'outra-pessoa']);
    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toMatch(/identidade de execução não é declarada/);
  });

  it('`revoke --actor <outro>` sai != 0 antes de revogar nada', () => {
    const result = runCli(['revoke', '--waiver', 'chave-qualquer', '--actor', 'outra-pessoa']);
    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toMatch(/identidade de execução não é declarada/);
  });
});
