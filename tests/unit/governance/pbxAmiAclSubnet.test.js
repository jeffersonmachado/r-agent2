'use strict';

/**
 * T16 — ACL do AMI vs subnet dos composes. Defeito medido em 2026-09-20 no
 * test stack (r-agent2-api-test): "AMI login failed" porque o template
 * permitia só 127.0.0.1 e 172.30.0.0/16, mas NENHUM compose fixava subnet —
 * o docker atribuiu 172.21.0.0/16 e a ACL (primeira correspondência decide,
 * deny final) derrubou a origem. A subnet da plataforma e o permit da ACL
 * precisam vir da MESMA variável, ou a segunda camada de defesa vira
 * negação de serviço para a própria API.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('PBX AMI ACL — subnet autorizada coerente com os composes', () => {
  it('template nunca permite o mundo inteiro', () => {
    const tpl = read('pbx/asterisk/etc/asterisk/manager.conf.template');
    const effective = tpl.split('\n').filter((line) => !line.trimStart().startsWith(';')).join('\n');
    expect(effective).not.toMatch(/permit\s*=\s*0\.0\.0\.0\/0\.0\.0\.0/);
    expect(effective).toMatch(/deny\s*=\s*0\.0\.0\.0\/0\.0\.0\.0/);
    expect(effective).toMatch(/permit\s*=\s*127\.0\.0\.1\/255\.255\.255\.255/);
  });

  it('rede da plataforma na ACL vem de variável (não de literal que pode divergir)', () => {
    const tpl = read('pbx/asterisk/etc/asterisk/manager.conf.template');
    expect(tpl).toMatch(/permit\s*=\s*\$\{AMI_ACL_PLATFORM_NET\}/);
  });

  it('start script renderiza a variável da ACL com default seguro', () => {
    const start = read('pbx/asterisk/asterisk-start.sh');
    expect(start).toMatch(/AMI_ACL_PLATFORM_NET="\$\{AMI_ACL_PLATFORM_NET:-172\.30\.0\.0\/16\}"/);
    expect(start).toMatch(/envsubst '\$AMI_SECRET \$AMI_BINDADDR \$AMI_ACL_PLATFORM_NET'/);
    // envsubst só enxerga variáveis exportadas — sem export os defaults viram
    // string vazia/literal e o parser descarta a seção [ragent2] inteira
    expect(start).toMatch(/export AMI_BINDADDR AMI_ACL_PLATFORM_NET/);
  });

  it.each(['docker-compose.yml', 'docker-compose.test.yml'])(
    '%s fixa a subnet e passa a MESMA rede para a ACL do asterisk',
    (file) => {
      const compose = read(file);
      const subnetVar = file.includes('test') ? 'RAP_TEST_PLATFORM_SUBNET' : 'RAP_PLATFORM_SUBNET';
      // subnet da rede default pinada pela variável
      expect(compose).toMatch(new RegExp(`subnet:\\s*\\$\\{${subnetVar}:-172\\.30\\.0\\.0/16\\}`));
      // asterisk recebe a ACL da mesma variável
      expect(compose).toMatch(new RegExp(`AMI_ACL_PLATFORM_NET:\\s*"?\\$\\{${subnetVar}:-172\\.30\\.0\\.0/16\\}`));
    },
  );
});
