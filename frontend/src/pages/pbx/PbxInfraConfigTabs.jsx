import React from 'react';

const PANEL_CLASS =
  'bg-bg-primary border border-border-default rounded-xl p-6 space-y-4';

const INFRA_TABS = [
  { key: 'usuarios', label: 'Usuários' },
  { key: 'networkConfig', label: 'Rede' },
  { key: 'dhcpConfig', label: 'DHCP' },
  { key: 'firewallConfig', label: 'Firewall' },
  { key: 'vpnConfig', label: 'VPN' },
];

function InfoBadge({ children }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 text-blue-400 text-xs rounded-full border border-blue-500/20">
      {children}
    </span>
  );
}

function CodeBlock({ children }) {
  return (
    <code className="font-mono text-xs bg-bg-secondary px-1.5 py-0.5 rounded border border-border-default/50">
      {children}
    </code>
  );
}

function SectionCard({ title, children }) {
  return (
    <div className={PANEL_CLASS}>
      <h3 className="text-base font-semibold text-text-primary">{title}</h3>
      <div className="text-sm text-text-secondary leading-relaxed space-y-2">{children}</div>
    </div>
  );
}

/* ---------- Usuários ---------- */
function UsuariosTab() {
  return (
    <div className="space-y-6">
      <div className={PANEL_CLASS}>
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Gerenciamento de Usuários</h2>
          <InfoBadge>Plataforma RAP</InfoBadge>
        </div>
        <p className="text-sm text-text-secondary leading-relaxed">
          Nesta plataforma, o controle de usuários e permissões é centralizado no módulo de{' '}
          <strong>Governança</strong> da RAP. Acesse a aba{' '}
          <strong>Governança → Provisioning</strong> para gerenciar tokens de acesso, auditoria de
          ações e controle de sessões.
        </p>
      </div>

      <SectionCard title="Funcionalidades disponíveis na plataforma">
        <ul className="list-disc list-inside space-y-1.5">
          <li>Criação e revogação de tokens de acesso via API</li>
          <li>Auditoria de ações por usuário e timestamp</li>
          <li>Controle de permissões por recurso (extensions, trunks, CDR, etc.)</li>
          <li>Histórico de login e uso da API</li>
        </ul>
      </SectionCard>

      <SectionCard title="Gestão de autenticação">
        <p>
          A autenticação é baseada em JWT. Usuários e credenciais são gerenciados no banco de dados
          da plataforma RAP. Para criar ou alterar usuários, utilize:
        </p>
        <ul className="list-disc list-inside space-y-1.5 mt-2">
          <li>
            API: <CodeBlock>POST /api/auth/users</CodeBlock> (requer permissão admin)
          </li>
          <li>
            Banco de dados: tabela <CodeBlock>users</CodeBlock> no schema PostgreSQL da aplicação
          </li>
          <li>Painel de administração disponível na rota /admin (quando habilitado)</li>
        </ul>
      </SectionCard>

      <SectionCard title="Diferença em relação ao sistema legado">
        <p>
          O sistema legado (Asterisk on-premise) possuía usuários locais gerenciados via interface
          web diretamente no appliance. Na arquitetura RAP (cloud/container), os usuários são
          desacoplados do PBX e gerenciados pela camada de plataforma, garantindo SSO e auditoria
          centralizada.
        </p>
      </SectionCard>
    </div>
  );
}

/* ---------- Rede ---------- */
function NetworkConfigTab() {
  return (
    <div className="space-y-6">
      <div className={PANEL_CLASS}>
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Configuração de Rede</h2>
          <InfoBadge>Infraestrutura</InfoBadge>
        </div>
        <p className="text-sm text-text-secondary leading-relaxed">
          As configurações de rede (interfaces, endereços IP, roteamento, DNS) são gerenciadas na
          camada de infraestrutura — fora do escopo do painel PBX. Em ambientes Docker/Kubernetes,
          utilize os recursos de rede do orquestrador.
        </p>
      </div>

      <SectionCard title="Gerenciamento por ambiente">
        <div className="space-y-3">
          <div>
            <p className="font-medium text-text-primary mb-1">Docker Compose</p>
            <p>
              Edite o bloco <CodeBlock>networks:</CodeBlock> em{' '}
              <CodeBlock>docker-compose.prod.yml</CodeBlock>. Interfaces de host são configuradas
              via <CodeBlock>network_mode: host</CodeBlock> ou mapeamentos de porta.
            </p>
          </div>
          <div>
            <p className="font-medium text-text-primary mb-1">Appliance (on-premise)</p>
            <p>
              Utilize <CodeBlock>nmcli</CodeBlock> ou <CodeBlock>netplan</CodeBlock> no servidor
              host. Arquivo de configuração: <CodeBlock>/etc/netplan/*.yaml</CodeBlock>.
            </p>
          </div>
          <div>
            <p className="font-medium text-text-primary mb-1">SIP/RTP (Asterisk)</p>
            <p>
              Configure o bind address e externhost em{' '}
              <CodeBlock>/etc/asterisk/pjsip.conf</CodeBlock> (seção{' '}
              <CodeBlock>[transport-udp]</CodeBlock>) ou via aba{' '}
              <strong>Governança → Configurações PBX</strong>.
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Configurações relevantes para o PBX">
        <ul className="list-disc list-inside space-y-1.5">
          <li>
            IP externo do PBX: variável de ambiente <CodeBlock>ASTERISK_EXTERN_IP</CodeBlock>
          </li>
          <li>
            Rede local (localnet): variável <CodeBlock>ASTERISK_LOCALNET</CodeBlock>
          </li>
          <li>
            Portas RTP: <CodeBlock>10000–20000/udp</CodeBlock> (ajustável em rtp.conf)
          </li>
          <li>
            Porta SIP: <CodeBlock>5060/udp</CodeBlock> e <CodeBlock>5061/tcp</CodeBlock> (TLS)
          </li>
        </ul>
      </SectionCard>
    </div>
  );
}

/* ---------- DHCP ---------- */
function DhcpConfigTab() {
  return (
    <div className="space-y-6">
      <div className={PANEL_CLASS}>
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Configuração DHCP</h2>
          <InfoBadge>Infraestrutura</InfoBadge>
        </div>
        <p className="text-sm text-text-secondary leading-relaxed">
          O serviço DHCP é responsável pela distribuição automática de endereços IP para ramais
          físicos (IP phones). Em ambientes cloud/container, este serviço é gerenciado na
          infraestrutura de rede — não pelo painel PBX.
        </p>
      </div>

      <SectionCard title="Configuração para provisionamento de IP phones">
        <p className="mb-2">
          Para que IP phones recebam configuração automática (TFTP/HTTP provisioning), o servidor
          DHCP deve enviar as opções:
        </p>
        <ul className="list-disc list-inside space-y-1.5">
          <li>
            <CodeBlock>option 66</CodeBlock> — Endereço do servidor TFTP/HTTP de provisionamento
          </li>
          <li>
            <CodeBlock>option 67</CodeBlock> — Nome do arquivo de configuração base
          </li>
          <li>
            <CodeBlock>option 160</CodeBlock> — URL de provisionamento (alguns fabricantes)
          </li>
        </ul>
      </SectionCard>

      <SectionCard title="Arquivo de configuração (on-premise)">
        <p>
          Em appliances on-premise, o DHCP é gerenciado pelo <CodeBlock>dhcpd</CodeBlock>. Arquivo
          de configuração: <CodeBlock>/etc/dhcp/dhcpd.conf</CodeBlock>. Reiniciar com:{' '}
          <CodeBlock>systemctl restart dhcpd</CodeBlock>.
        </p>
      </SectionCard>

      <SectionCard title="Alternativa via RAP">
        <p>
          A plataforma RAP suporta o módulo de provisionamento automático de ramais. Acesse a aba{' '}
          <strong>Ramais → Provisionamento</strong> para configurar o servidor TFTP/HTTP e os
          templates de provisionamento por fabricante.
        </p>
      </SectionCard>
    </div>
  );
}

/* ---------- Firewall ---------- */
function FirewallConfigTab() {
  return (
    <div className="space-y-6">
      <div className={PANEL_CLASS}>
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Configuração de Firewall</h2>
          <InfoBadge>Infraestrutura</InfoBadge>
        </div>
        <p className="text-sm text-text-secondary leading-relaxed">
          Regras de firewall são gerenciadas na camada de infraestrutura. Em ambientes container,
          utilize as ACLs de rede do orquestrador. Para proteção de SIP, recomenda-se{' '}
          <strong>fail2ban</strong> + ACLs do Asterisk configuradas na aba <strong>ACLs</strong>{' '}
          desta plataforma.
        </p>
      </div>

      <SectionCard title="Portas necessárias para o PBX">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-text-secondary border-b border-border-default">
                <th className="text-left pb-1.5 pr-4">Porta / Protocolo</th>
                <th className="text-left pb-1.5 pr-4">Serviço</th>
                <th className="text-left pb-1.5">Direção</th>
              </tr>
            </thead>
            <tbody className="space-y-1">
              {[
                ['5060/udp', 'SIP', 'Entrada/Saída'],
                ['5061/tcp', 'SIP TLS', 'Entrada/Saída'],
                ['10000-20000/udp', 'RTP (áudio)', 'Entrada/Saída'],
                ['4569/udp', 'IAX2', 'Entrada/Saída'],
                ['8443/tcp', 'WebRTC WSS', 'Entrada'],
                ['80,443/tcp', 'Painel RAP', 'Entrada'],
              ].map(([porta, servico, direcao]) => (
                <tr key={porta} className="border-b border-border-default/30">
                  <td className="py-1.5 pr-4 font-mono">{porta}</td>
                  <td className="py-1.5 pr-4">{servico}</td>
                  <td className="py-1.5 text-text-secondary">{direcao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="ACLs no nível Asterisk">
        <p>
          Use a aba <strong>ACLs</strong> desta plataforma para definir redes permitidas/negadas a
          nível de aplicação. Para bloqueio a nível de SO, configure{' '}
          <CodeBlock>firewalld</CodeBlock> ou <CodeBlock>iptables</CodeBlock> no servidor host
          com: <CodeBlock>firewall-cmd --add-port=5060/udp --permanent</CodeBlock>.
        </p>
      </SectionCard>

      <SectionCard title="Proteção anti-flood SIP">
        <p>
          Recomenda-se instalar e configurar <CodeBlock>fail2ban</CodeBlock> com o jail{' '}
          <CodeBlock>asterisk</CodeBlock> para bloqueio automático de IPs com tentativas de
          autenticação inválidas.
        </p>
      </SectionCard>
    </div>
  );
}

/* ---------- VPN ---------- */
function VpnConfigTab() {
  return (
    <div className="space-y-6">
      <div className={PANEL_CLASS}>
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Configuração de VPN</h2>
          <InfoBadge>Infraestrutura</InfoBadge>
        </div>
        <p className="text-sm text-text-secondary leading-relaxed">
          A configuração de VPN (IPsec/OpenVPN/WireGuard) é gerenciada na camada de infraestrutura
          do servidor. O painel PBX não gerencia VPN diretamente — utilize as ferramentas do SO ou
          do orquestrador.
        </p>
      </div>

      <SectionCard title="Cenários de uso de VPN com o PBX">
        <ul className="list-disc list-inside space-y-1.5">
          <li>
            Ramais remotos conectados via VPN — utilizar VPN IPsec site-to-site ou cliente VPN nos
            dispositivos IP phone
          </li>
          <li>
            Interconexão de centrais (multi-site) — configurar trunco IAX2/SIP entre sites via
            túnel VPN
          </li>
          <li>
            Acesso seguro ao painel RAP de redes externas — VPN como pré-requisito de acesso
          </li>
        </ul>
      </SectionCard>

      <SectionCard title="IPsec (legado on-premise)">
        <p>
          Em appliances on-premise, o IPsec era configurado via <CodeBlock>strongSwan</CodeBlock>{' '}
          ou <CodeBlock>Libreswan</CodeBlock>. Arquivo de configuração:{' '}
          <CodeBlock>/etc/ipsec.conf</CodeBlock>. Status:{' '}
          <CodeBlock>ipsec status</CodeBlock>.
        </p>
      </SectionCard>

      <SectionCard title="Alternativas modernas">
        <ul className="list-disc list-inside space-y-1.5">
          <li>
            <strong>WireGuard</strong> — Recomendado para novos deployments. Simples, performático e
            com suporte nativo no kernel Linux ≥5.6.
          </li>
          <li>
            <strong>OpenVPN</strong> — Amplamente suportado por dispositivos IP phone de terceiros.
          </li>
          <li>
            <strong>SIP TLS + SRTP</strong> — Para ramais individuais, o TLS nativo do Asterisk
            pode substituir a VPN. Configure na aba <strong>Ramais</strong> habilitando o protocolo
            PJSIP com transporte TLS.
          </li>
        </ul>
      </SectionCard>
    </div>
  );
}

/* ---------- Export ---------- */

export function PbxInfraConfigTabs({ tab }) {
  const active = INFRA_TABS.some((t) => t.key === tab);
  if (!active) return null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-border-default pb-2 flex-wrap">
        {INFRA_TABS.map((t) => (
          <span
            key={t.key}
            className={
              tab === t.key
                ? 'px-3 py-1 text-sm rounded-t font-medium text-accent-primary border-b-2 border-accent-primary'
                : 'px-3 py-1 text-sm rounded-t text-text-secondary'
            }
          >
            {t.label}
          </span>
        ))}
      </div>
      {tab === 'usuarios' && <UsuariosTab />}
      {tab === 'networkConfig' && <NetworkConfigTab />}
      {tab === 'dhcpConfig' && <DhcpConfigTab />}
      {tab === 'firewallConfig' && <FirewallConfigTab />}
      {tab === 'vpnConfig' && <VpnConfigTab />}
    </div>
  );
}
