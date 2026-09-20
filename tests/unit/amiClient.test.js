'use strict';

/**
 * amiClient fail-closed: sem AMI_SECRET o cliente NÃO tenta conectar nem cai
 * num default conhecido — rejeita com `ami_secret_required` antes de abrir
 * socket (AI_MEMORY/security-finding-pbx-ami-exposure.md).
 */

const amiClient = require('../../api/services/asterisk/amiClient');

describe('amiClient — AMI_SECRET fail-closed', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test.each(['command', 'originate'])('%s rejeita com ami_secret_required quando AMI_SECRET está ausente', async (fn) => {
    delete process.env.AMI_SECRET;
    process.env.AMI_HOST = '127.0.0.1';
    process.env.AMI_PORT = '1'; // nenhum listener: se tentar conectar, falha por socket, não por segredo

    const call = fn === 'command' ? amiClient.command('core show version') : amiClient.originate({ channel: 'PJSIP/x', context: 'c', exten: '1' });
    await expect(call).rejects.toMatchObject({ code: 'ami_secret_required' });
  });

  test('rejeita com ami_secret_required quando AMI_SECRET é só espaços', async () => {
    process.env.AMI_SECRET = '   ';
    await expect(amiClient.command('core show version')).rejects.toMatchObject({ code: 'ami_secret_required' });
  });

  test('com AMI_SECRET presente a falha é de socket (prova que o segredo passou no gate)', async () => {
    process.env.AMI_SECRET = 'segredo-de-teste';
    process.env.AMI_HOST = '127.0.0.1';
    process.env.AMI_PORT = '1';
    process.env.AMI_TIMEOUT_MS = '500';

    await expect(amiClient.command('core show version')).rejects.toMatchObject({ code: 'ami_socket_error' });
  });
});
