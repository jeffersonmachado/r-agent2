import React, { useState, useEffect, useMemo } from 'react';
import { listTrunks, listExtensions, listQueues } from '../../api/pbx';

// ─── Estilos ──────────────────────────────────────────────────────────────────

const PANEL = 'bg-bg-primary border border-border-default rounded-xl p-6 space-y-4';
const INPUT =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all';
const BADGE_BLUE = 'inline-flex items-center px-2 py-0.5 bg-blue-500/10 text-blue-400 text-xs rounded-full border border-blue-500/20';
const BADGE_GOV = 'inline-flex items-center px-2 py-0.5 bg-purple-500/10 text-purple-400 text-xs rounded-full border border-purple-500/20';

const CONFIG_TABS = [
  { key: 'trunksOperadoras', label: 'Operadoras' },
  { key: 'trunksInterconexao', label: 'Interconexão' },
  { key: 'extensionsCategoria', label: 'Categoria' },
  { key: 'extensionsFacilidades', label: 'Facilidades' },
  { key: 'queuesSala', label: 'Sala/Conf.' },
  { key: 'govConfiguracoes', label: 'Configurações' },
  { key: 'govLicenca', label: 'Licença' },
  { key: 'govAtualizacao', label: 'Atualização' },
  { key: 'govAssistencia', label: 'Assistência' },
  { key: 'govRecarga', label: 'Recarga' },
  { key: 'govServicos', label: 'Serviços' },
];

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useTrunks() {
  const [trunks, setTrunks] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    listTrunks()
      .then((r) => setTrunks(Array.isArray(r) ? r : r?.data || []))
      .catch(() => setTrunks([]))
      .finally(() => setLoading(false));
  }, []);
  return { trunks, loading };
}

function useExtensions() {
  const [extensions, setExtensions] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    listExtensions()
      .then((r) => setExtensions(Array.isArray(r) ? r : r?.data || []))
      .catch(() => setExtensions([]))
      .finally(() => setLoading(false));
  }, []);
  return { extensions, loading };
}

function useQueues() {
  const [queues, setQueues] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    listQueues()
      .then((r) => setQueues(Array.isArray(r) ? r : r?.data || []))
      .catch(() => setQueues([]))
      .finally(() => setLoading(false));
  }, []);
  return { queues, loading };
}

// ─── Componentes auxiliares ───────────────────────────────────────────────────

function InfoCard({ badge, badgeClass = BADGE_BLUE, title, description, children }) {
  return (
    <div className={PANEL}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        {badge && <span className={badgeClass}>{badge}</span>}
      </div>
      {description && <p className="text-sm text-text-secondary leading-relaxed">{description}</p>}
      {children}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-text-secondary w-52 flex-shrink-0">{label}:</span>
      <span className="text-text-primary">{value}</span>
    </div>
  );
}

function Code({ children }) {
  return (
    <code className="font-mono text-xs bg-bg-secondary px-1.5 py-0.5 rounded border border-border-default/50">
      {children}
    </code>
  );
}

function LoadingRow() {
  return <p className="text-sm text-text-secondary">Carregando…</p>;
}

// ─── Troncos: Operadoras ──────────────────────────────────────────────────────

function OperadorasTab() {
  const { trunks, loading } = useTrunks();
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!trunks) return [];
    let r = trunks.filter((x) =>
      !String(x.name || '').toLowerCase().match(/interconex|intern|interconne/),
    );
    if (search) r = r.filter((x) => JSON.stringify(x).toLowerCase().includes(search.toLowerCase()));
    return r;
  }, [trunks, search]);

  return (
    <div className="space-y-4">
      <InfoCard title="Operadoras" badge="Troncos SIP" description="Operadoras são troncos SIP/IAX que conectam o PBX à PSTN. Configure credenciais, endereço e codecs fornecidos pela operadora.">
        <div className="text-sm text-text-secondary space-y-1">
          <p>• Adicione e edite operadoras na aba <strong>Troncos</strong></p>
          <p>• Tipo <Code>pjsip</Code>: suporte a registros SIP, autenticação, TLS/SRTP</p>
          <p>• Tipo <Code>iax</Code>: protocolo IAX2 para interconexão com outros Asterisk</p>
          <p>• Após salvar, aplique o dialplan em <strong>Dialplan → Aplicar</strong></p>
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Troncos de operadora</h3>
        <input className={INPUT + ' max-w-xs'} placeholder="Filtrar…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {loading ? <LoadingRow /> : (
          filtered.length === 0
            ? <p className="text-sm text-text-secondary">Nenhum tronco cadastrado. Adicione na aba Troncos.</p>
            : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-default">
                      <th className="pb-2 pr-4 text-left text-text-secondary">Nome</th>
                      <th className="pb-2 pr-4 text-left text-text-secondary">Tipo</th>
                      <th className="pb-2 pr-4 text-left text-text-secondary">Transport</th>
                      <th className="pb-2 text-left text-text-secondary">Auth User</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t, i) => (
                      <tr key={t.id || i} className="border-b border-border-default/50 hover:bg-bg-secondary/50">
                        <td className="py-1.5 pr-4 font-medium">{t.name || '—'}</td>
                        <td className="py-1.5 pr-4"><Code>{t.type || '—'}</Code></td>
                        <td className="py-1.5 pr-4 text-xs">{t.transport || '—'}</td>
                        <td className="py-1.5 text-xs text-text-secondary">{t.authUsername || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-text-secondary">{filtered.length} tronco(s)</p>
              </div>
            )
        )}
      </div>
    </div>
  );
}

// ─── Troncos: Interconexão ────────────────────────────────────────────────────

function InterconexaoTab() {
  const { trunks, loading } = useTrunks();
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!trunks) return [];
    let r = trunks.filter((x) =>
      String(x.name || '').toLowerCase().match(/interconex|intern|interconne|pbx|central|branch/),
    );
    if (search) r = r.filter((x) => JSON.stringify(x).toLowerCase().includes(search.toLowerCase()));
    return r;
  }, [trunks, search]);

  return (
    <div className="space-y-4">
      <InfoCard title="Interconexão entre Centrais" badge="Trunk PBX-to-PBX" description="A interconexão conecta duas ou mais centrais PBX entre si — permitindo chamadas internas entre filiais sem custos de operadora.">
        <div className="text-sm text-text-secondary space-y-1">
          <p>• Configure como tronco SIP ou IAX2 na aba <strong>Troncos</strong></p>
          <p>• Para interconexão segura entre filiais, use TLS + SRTP ou VPN (ver aba VPN)</p>
          <p>• Plano de numeração: roteie chamadas para a filial via prefixo nas <strong>Rotas</strong></p>
          <p>• Exemplo: ramal 1xxx → filial A, ramal 2xxx → filial B</p>
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Troncos de interconexão</h3>
        <input className={INPUT + ' max-w-xs'} placeholder="Filtrar…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {loading ? <LoadingRow /> : (
          filtered.length === 0
            ? <p className="text-sm text-text-secondary">Nenhum tronco de interconexão identificado (buscando por nome com "interconex", "intern", etc.).</p>
            : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-default">
                      <th className="pb-2 pr-4 text-left text-text-secondary">Nome</th>
                      <th className="pb-2 pr-4 text-left text-text-secondary">Tipo</th>
                      <th className="pb-2 pr-4 text-left text-text-secondary">Contato AOR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t, i) => (
                      <tr key={t.id || i} className="border-b border-border-default/50 hover:bg-bg-secondary/50">
                        <td className="py-1.5 pr-4 font-medium">{t.name || '—'}</td>
                        <td className="py-1.5 pr-4"><Code>{t.type || '—'}</Code></td>
                        <td className="py-1.5 text-xs text-text-secondary">{t.aorContact || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-text-secondary">{filtered.length} tronco(s)</p>
              </div>
            )
        )}
      </div>
    </div>
  );
}

// ─── Ramais: Categoria ────────────────────────────────────────────────────────

function CategoriaTab() {
  const { extensions, loading } = useExtensions();
  const [search, setSearch] = useState('');

  const byCategory = useMemo(() => {
    if (!extensions) return null;
    const map = {};
    for (const e of extensions) {
      const k = e.tipo || e.type || 'Sem categoria';
      if (!map[k]) map[k] = [];
      map[k].push(e);
    }
    return Object.entries(map).sort((a, b) => b[1].length - a[1].length);
  }, [extensions]);

  const filtered = useMemo(() => {
    if (!byCategory) return null;
    if (!search) return byCategory;
    return byCategory
      .map(([cat, exts]) => [cat, exts.filter((e) => JSON.stringify(e).toLowerCase().includes(search.toLowerCase()))])
      .filter(([, exts]) => exts.length > 0);
  }, [byCategory, search]);

  return (
    <div className="space-y-4">
      <InfoCard title="Categorias de Ramal" badge="Plano de discagem" description="As categorias definem o perfil de discagem permitido para cada ramal — controlando quais destinos podem ser discados (local, DDD, DDI, celular, etc.).">
        <div className="text-sm text-text-secondary space-y-1">
          <p>• Configure o campo <strong>tipo</strong> de cada ramal na aba <strong>Ramais</strong></p>
          <p>• Tipos típicos: <Code>Livre</Code>, <Code>Local</Code>, <Code>DDD</Code>, <Code>DDI</Code>, <Code>Corporativo</Code></p>
          <p>• O tipo é usado pelo dialplan para aplicar as regras de bloqueio de discagem</p>
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Ramais por categoria</h3>
        <input className={INPUT + ' max-w-xs'} placeholder="Filtrar…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {loading ? <LoadingRow /> : filtered && filtered.map(([cat, exts]) => (
          <div key={cat} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary">{cat}</span>
              <span className="text-xs text-text-secondary bg-bg-secondary px-2 py-0.5 rounded-full">{exts.length}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {exts.slice(0, 30).map((e, i) => (
                <span key={e.id || i} className="font-mono text-xs bg-bg-secondary border border-border-default px-2 py-0.5 rounded" title={e.displayName || ''}>
                  {e.extension || '?'}
                </span>
              ))}
              {exts.length > 30 && <span className="text-xs text-text-secondary">+{exts.length - 30} mais</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Ramais: Facilidades ──────────────────────────────────────────────────────

function FacilidadesTab() {
  const { extensions, loading } = useExtensions();
  const filtered = useMemo(() => {
    if (!extensions) return [];
    return extensions.filter((e) =>
      String(e.contexto || e.context || '').toLowerCase().match(/facilidade|feature|code/) ||
      String(e.tipo || '').toLowerCase().match(/facilidade|feature/) ||
      String(e.extension || '').match(/^\*[0-9]/),
    );
  }, [extensions]);

  return (
    <div className="space-y-4">
      <InfoCard title="Facilidades / Feature Codes" badge="Códigos especiais" description="Facilidades são códigos de discagem especial (ex: *1, *98) que ativam funcionalidades do PBX — como correio de voz, bloqueio de chamada, DND, etc.">
        <div className="space-y-3 text-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="pb-1.5 pr-4 text-left text-text-secondary">Código</th>
                  <th className="pb-1.5 pr-4 text-left text-text-secondary">Funcionalidade</th>
                  <th className="pb-1.5 text-left text-text-secondary">Configuração</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['*1', 'Transferência cega', 'features.conf → blindxfer'],
                  ['*2', 'Transferência supervisionada', 'features.conf → atxfer'],
                  ['*3', 'Parque de chamada', 'features.conf → parkcall'],
                  ['*98', 'Correio de voz', 'Contexto voicemail no dialplan'],
                  ['*67', 'Não perturbe (DND)', 'Dialplan ou database AstDB'],
                  ['**', 'Espionagem de ramal', 'features.conf → spy'],
                ].map(([code, fn, cfg]) => (
                  <tr key={code} className="border-b border-border-default/30">
                    <td className="py-1.5 pr-4 font-mono font-medium">{code}</td>
                    <td className="py-1.5 pr-4">{fn}</td>
                    <td className="py-1.5 text-text-secondary"><Code>{cfg}</Code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-text-secondary text-xs">Configure em <Code>/etc/asterisk/features.conf</Code> e aplique via dialplan na aba <strong>Dialplan</strong>.</p>
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Ramais de facilidade cadastrados</h3>
        {loading ? <LoadingRow /> : (
          filtered.length === 0
            ? <p className="text-sm text-text-secondary">Nenhum ramal de facilidade identificado (padrão *XX). As facilidades são configuradas no dialplan/features.conf.</p>
            : (
              <div className="flex flex-wrap gap-2">
                {filtered.map((e, i) => (
                  <div key={e.id || i} className="bg-bg-secondary border border-border-default rounded-lg px-3 py-2 text-sm">
                    <span className="font-mono font-medium">{e.extension}</span>
                    {e.displayName && <span className="text-text-secondary ml-2">— {e.displayName}</span>}
                  </div>
                ))}
              </div>
            )
        )}
      </div>
    </div>
  );
}

// ─── Filas: Sala / Conferência ────────────────────────────────────────────────

function SalaTab() {
  const { queues, loading } = useQueues();
  const filtered = useMemo(() => {
    if (!queues) return [];
    return queues.filter((q) =>
      String(q.name || '').toLowerCase().match(/sala|conf|meet|reuni/) ||
      String(q.strategy || '').toLowerCase() === 'ringall' ||
      String(q.queueNumber || '').match(/^[89]/),
    );
  }, [queues]);

  return (
    <div className="space-y-4">
      <InfoCard title="Salas de Conferência" badge="ConfBridge / MeetMe" description="Salas de conferência permitem que múltiplos participantes (internos e externos) participem de uma chamada simultânea. No Asterisk moderno, usa-se ConfBridge.">
        <div className="text-sm text-text-secondary space-y-1">
          <p>• Configure salas de conferência com a aplicação <Code>ConfBridge</Code> no dialplan</p>
          <p>• Cada sala recebe um número de discagem (ex: 8000, 8001)</p>
          <p>• Opções: PIN de acesso, mudo ao entrar, anúncio de participantes</p>
          <p>• Alternativa moderna: integração com WebRTC para conferências no navegador</p>
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Filas/grupos identificados como sala</h3>
        {loading ? <LoadingRow /> : (
          filtered.length === 0
            ? <p className="text-sm text-text-secondary">Nenhuma sala de conferência identificada nas filas. Configure salas via dialplan usando ConfBridge.</p>
            : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-default">
                      <th className="pb-2 pr-4 text-left text-text-secondary">Número</th>
                      <th className="pb-2 pr-4 text-left text-text-secondary">Nome</th>
                      <th className="pb-2 text-left text-text-secondary">Estratégia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((q, i) => (
                      <tr key={q.id || i} className="border-b border-border-default/50 hover:bg-bg-secondary/50">
                        <td className="py-1.5 pr-4 font-mono">{q.queueNumber || '—'}</td>
                        <td className="py-1.5 pr-4">{q.name || '—'}</td>
                        <td className="py-1.5 text-text-secondary text-xs">{q.strategy || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        )}
      </div>
    </div>
  );
}

// ─── Governança: tabs informacionais ─────────────────────────────────────────

function ConfiguracoesTab() {
  return (
    <div className="space-y-4">
      <InfoCard title="Configurações do PBX" badge="Parâmetros gerais" badgeClass={BADGE_GOV}
        description="Parâmetros gerais de funcionamento do Asterisk — codec global, timeout de chamada, idioma, fuso horário, logs e integrações.">
        <div className="space-y-2">
          <InfoRow label="Arquivo principal" value="/etc/asterisk/asterisk.conf" />
          <InfoRow label="Configuração SIP/PJSIP" value="/etc/asterisk/pjsip.conf" />
          <InfoRow label="Timezone" value="Variável de ambiente TZ / asterisk.conf" />
          <InfoRow label="Idioma padrão" value="defaultlanguage=pt_BR em asterisk.conf" />
          <InfoRow label="Log de chamadas" value="/var/log/asterisk/cdr-csv/ ou PostgreSQL" />
          <InfoRow label="Aplicar configurações" value="Aba Dialplan → Aplicar (sem reiniciar)" />
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Parâmetros via variáveis de ambiente</h3>
        <div className="space-y-2 text-sm text-text-secondary">
          {[
            ['ASTERISK_EXTERN_IP', 'IP externo para SIP (NAT)'],
            ['ASTERISK_LOCALNET', 'Rede local (ex: 192.168.0.0/24)'],
            ['ASTERISK_CONTEXT_DEFAULT', 'Contexto padrão de discagem'],
            ['PBX_CODEC_ALLOW', 'Codecs permitidos (ex: ulaw,alaw,g729)'],
            ['PBX_MAX_CALLS', 'Limite máximo de chamadas simultâneas'],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <Code>{k}</Code>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LicencaTab() {
  return (
    <div className="space-y-4">
      <InfoCard title="Licença e Versão" badge="Open Source / Comercial" badgeClass={BADGE_GOV}
        description="O núcleo do PBX (Asterisk) é open source sob licença GPLv2. A plataforma RAP que o envolve pode ter termos adicionais conforme o plano contratado.">
        <div className="space-y-2">
          <InfoRow label="Asterisk" value="Open Source — GPL v2 (digium.com)" />
          <InfoRow label="PJSIP" value="Open Source — GPL / BSD (pjsip.org)" />
          <InfoRow label="Plataforma RAP" value="Consulte contrato de serviço com o fornecedor" />
          <InfoRow label="Codecs proprietários" value="G.729 / G.723: requer licença por canal (Digium/Sangoma)" />
          <InfoRow label="Módulos DAHDI" value="Requer hardware Sangoma/Digium para E1/T1" />
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Verificar versão instalada</h3>
        <div className="space-y-2 text-sm text-text-secondary">
          <p>Execute no servidor ou container do Asterisk:</p>
          <div className="bg-bg-secondary rounded-lg p-3 font-mono text-xs space-y-1">
            <div>asterisk -rx "core show version"</div>
            <div>asterisk -rx "module show like res_pjsip"</div>
            <div>asterisk -rx "license show"</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AtualizacaoTab() {
  return (
    <div className="space-y-4">
      <InfoCard title="Atualização do Sistema" badge="Manutenção" badgeClass={BADGE_GOV}
        description="Atualizações do PBX são aplicadas via rebuild do container Docker ou atualização do pacote no servidor host. Sempre teste em homologação antes de aplicar em produção.">
        <div className="space-y-2">
          <InfoRow label="Atualização do container" value="docker pull + docker compose up -d" />
          <InfoRow label="Atualização do Asterisk (host)" value="apt upgrade asterisk / yum update asterisk" />
          <InfoRow label="Backup antes de atualizar" value="Exportar dialplan, configurações e CDR" />
          <InfoRow label="Rollback" value="Aba Dialplan → Versões → Restaurar versão anterior" />
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Procedimento de atualização segura</h3>
        <ol className="list-decimal list-inside space-y-2 text-sm text-text-secondary">
          <li>Faça backup completo das configurações (<Code>/etc/asterisk/</Code>) e do banco de dados.</li>
          <li>Teste a nova versão em ambiente de homologação.</li>
          <li>Agende a janela de manutenção (baixo volume de chamadas).</li>
          <li>Execute: <Code>docker compose pull &amp;&amp; docker compose up -d</Code></li>
          <li>Valide CDR, ramais registrados e rotas de saída.</li>
          <li>Em caso de problema, reverta com a imagem anterior usando o rollback do dialplan.</li>
        </ol>
      </div>
    </div>
  );
}

function AssistenciaTab() {
  return (
    <div className="space-y-4">
      <InfoCard title="Assistência Técnica" badge="Suporte" badgeClass={BADGE_GOV}
        description="Recursos de diagnóstico e suporte para problemas no PBX. Use os comandos AMI/CLI para diagnóstico em tempo real.">
        <div className="space-y-2">
          <InfoRow label="CLI do Asterisk" value="asterisk -rvvv (modo verboso)" />
          <InfoRow label="Log de erros" value="/var/log/asterisk/messages" />
          <InfoRow label="Chamadas ativas" value='asterisk -rx "core show channels"' />
          <InfoRow label="Ramais registrados" value='asterisk -rx "pjsip show endpoints"' />
          <InfoRow label="Auditoria RAP" value="Aba Governança → Auditoria" />
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Diagnóstico rápido</h3>
        <div className="bg-bg-secondary rounded-lg p-3 font-mono text-xs space-y-1 text-text-primary">
          <div># Ver chamadas em andamento</div>
          <div>asterisk -rx "core show channels verbose"</div>
          <div className="mt-2"># Ver registros SIP ativos</div>
          <div>asterisk -rx "pjsip show registrations"</div>
          <div className="mt-2"># Verificar tronco específico</div>
          <div>asterisk -rx "pjsip show endpoint NOME_TRONCO"</div>
          <div className="mt-2"># Recarregar módulo sem reiniciar</div>
          <div>asterisk -rx "module reload res_pjsip"</div>
        </div>
      </div>
    </div>
  );
}

function RecargaTab() {
  return (
    <div className="space-y-4">
      <InfoCard title="Recarga e Créditos" badge="Billing" badgeClass={BADGE_GOV}
        description="O módulo de recarga controla créditos de discagem para ramais pré-pagos — limitando o gasto por ramal ou por conta.">
        <div className="space-y-2">
          <InfoRow label="Controle de saldo" value="Implementado via AstDB ou banco externo de billing" />
          <InfoRow label="Limite por ramal" value="Configure em Ramais → campo chamadas/tempo" />
          <InfoRow label="CDR para billing" value="Consulte a aba CDR para custo por chamada" />
          <InfoRow label="Integração billing" value="Use webhook AGI para consulta de saldo em tempo real" />
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Controle via dialplan</h3>
        <p className="text-sm text-text-secondary">
          Para implementar controle de saldo em tempo real, configure um script AGI que consulta o saldo antes de autorizar a chamada:
        </p>
        <div className="bg-bg-secondary rounded-lg p-3 font-mono text-xs space-y-0.5 text-text-primary">
          <div>; No dialplan (extensions.conf)</div>
          <div>exten =&gt; _X.,1,AGI(check-balance.agi,$&#123;CALLERID(num)&#125;)</div>
          <div>same =&gt; n,GotoIf($[$&#123;AGISTATUS&#125; = SUCCESS]?dial:deny)</div>
          <div>same =&gt; n(dial),Dial(PJSIP/$&#123;EXTEN&#125;@trunk)</div>
          <div>same =&gt; n(deny),Playback(insufficient-funds)</div>
        </div>
      </div>
    </div>
  );
}

function ServicosTab() {
  return (
    <div className="space-y-4">
      <InfoCard title="Serviços do PBX" badge="Módulos ativos" badgeClass={BADGE_GOV}
        description="Status e configuração dos serviços integrados ao PBX — voicemail, gravação, FAX, TTS, transcrição e integrações externas.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default">
                <th className="pb-2 pr-4 text-left text-text-secondary">Serviço</th>
                <th className="pb-2 pr-4 text-left text-text-secondary">Módulo Asterisk</th>
                <th className="pb-2 text-left text-text-secondary">Aba de configuração</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Correio de voz', 'app_voicemail', 'Dialplan → IVR'],
                ['Gravação de chamadas', 'app_mixmonitor', 'Ramais → Gravações'],
                ['FAX T.38', 'res_fax_spandsp', 'Fax → Configuração Fax'],
                ['Conferência', 'app_confbridge', 'Dialplan ou Filas'],
                ['IVR / URA', 'app_playback + app_goto', 'IVR'],
                ['TTS (text-to-speech)', 'res_speech + engine externo', 'Dialplan (AGI/EAGI)'],
                ['Transcrição', 'Google/AWS Speech API', 'Integração via AGI'],
                ['Click2Call', 'AMI Originate', 'Contact Center → Click2Call'],
              ].map(([svc, mod, tab]) => (
                <tr key={svc} className="border-b border-border-default/30">
                  <td className="py-1.5 pr-4 font-medium">{svc}</td>
                  <td className="py-1.5 pr-4"><Code>{mod}</Code></td>
                  <td className="py-1.5 text-text-secondary text-xs">{tab}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Verificar módulos carregados</h3>
        <div className="bg-bg-secondary rounded-lg p-3 font-mono text-xs space-y-1 text-text-primary">
          <div>asterisk -rx "module show"</div>
          <div>asterisk -rx "module show like app_voicemail"</div>
          <div>asterisk -rx "module show like res_fax"</div>
        </div>
      </div>
    </div>
  );
}

// ─── Export principal ─────────────────────────────────────────────────────────

export function PbxConfigDetailTabs({ tab }) {
  const active = CONFIG_TABS.some((t) => t.key === tab);
  if (!active) return null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-border-default pb-2 flex-wrap">
        {CONFIG_TABS.map((t) => (
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
      {tab === 'trunksOperadoras' && <OperadorasTab />}
      {tab === 'trunksInterconexao' && <InterconexaoTab />}
      {tab === 'extensionsCategoria' && <CategoriaTab />}
      {tab === 'extensionsFacilidades' && <FacilidadesTab />}
      {tab === 'queuesSala' && <SalaTab />}
      {tab === 'govConfiguracoes' && <ConfiguracoesTab />}
      {tab === 'govLicenca' && <LicencaTab />}
      {tab === 'govAtualizacao' && <AtualizacaoTab />}
      {tab === 'govAssistencia' && <AssistenciaTab />}
      {tab === 'govRecarga' && <RecargaTab />}
      {tab === 'govServicos' && <ServicosTab />}
    </div>
  );
}
