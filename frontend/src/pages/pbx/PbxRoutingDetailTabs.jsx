import React, { useState, useEffect, useMemo } from 'react';
import { listRoutes, listExtensions } from '../../api/pbx';

// ─── Estilos ──────────────────────────────────────────────────────────────────

const PANEL = 'bg-bg-primary border border-border-default rounded-xl p-6 space-y-4';
const INPUT =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all';
const BADGE_BLUE = 'inline-flex items-center px-2 py-0.5 bg-blue-500/10 text-blue-400 text-xs rounded-full border border-blue-500/20';
const BADGE_AMBER = 'inline-flex items-center px-2 py-0.5 bg-amber-500/10 text-amber-400 text-xs rounded-full border border-amber-500/20';

const ROUTING_TABS = [
  { key: 'routesDdr', label: 'DDR' },
  { key: 'routesDesvio', label: 'Desvio' },
  { key: 'routesTransbordo', label: 'Transbordo' },
  { key: 'routesRetorno', label: 'Retorno' },
  { key: 'routesRecusa', label: 'Recusa' },
  { key: 'routesFeriado', label: 'Feriado' },
  { key: 'routesTransferencia', label: 'Transferência' },
  { key: 'extensionsGrupos', label: 'Grupos' },
  { key: 'extensionsBloqueio', label: 'Bloqueio' },
];

// ─── Hooks de dados ───────────────────────────────────────────────────────────

function useRoutes() {
  const [routes, setRoutes] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    listRoutes()
      .then((r) => setRoutes(Array.isArray(r) ? r : r?.data || []))
      .catch(() => setRoutes([]))
      .finally(() => setLoading(false));
  }, []);
  return { routes, loading };
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

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function InfoCard({ badge, badgeClass = BADGE_BLUE, title, description, children }) {
  return (
    <div className={PANEL}>
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        {badge && <span className={badgeClass}>{badge}</span>}
      </div>
      {description && <p className="text-sm text-text-secondary leading-relaxed">{description}</p>}
      {children}
    </div>
  );
}

function RouteRow({ r, i }) {
  return (
    <tr key={r.id || i} className="border-b border-border-default/50 hover:bg-bg-secondary/50">
      <td className="py-1.5 pr-4 font-mono text-xs">{r.pattern || r.name || '—'}</td>
      <td className="py-1.5 pr-4 text-xs">{r.direction || r.contexto || '—'}</td>
      <td className="py-1.5 pr-4 text-xs">{r.action || r.destino || r.target || '—'}</td>
      <td className="py-1.5 text-xs text-text-secondary">{r.trunkId || r.trunk || r.tronco || '—'}</td>
    </tr>
  );
}

function RoutesTable({ routes, emptyMsg }) {
  if (!routes || routes.length === 0)
    return <p className="text-sm text-text-secondary">{emptyMsg || 'Nenhuma rota encontrada.'}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-default">
            <th className="pb-2 pr-4 text-left text-text-secondary">Padrão / Nome</th>
            <th className="pb-2 pr-4 text-left text-text-secondary">Direção / Contexto</th>
            <th className="pb-2 pr-4 text-left text-text-secondary">Ação / Destino</th>
            <th className="pb-2 text-left text-text-secondary">Tronco</th>
          </tr>
        </thead>
        <tbody>
          {routes.slice(0, 100).map((r, i) => <RouteRow key={r.id || i} r={r} i={i} />)}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-text-secondary">{routes.length} rota(s)</p>
    </div>
  );
}

function ExtRow({ e, i }) {
  return (
    <tr key={e.id || i} className="border-b border-border-default/50 hover:bg-bg-secondary/50">
      <td className="py-1.5 pr-4 font-mono text-xs">{e.extension || '—'}</td>
      <td className="py-1.5 pr-4 text-xs">{e.displayName || e.calleridName || '—'}</td>
      <td className="py-1.5 pr-4 text-xs">{e.tipo || e.type || '—'}</td>
      <td className="py-1.5 pr-4 text-xs">{e.grupo || '—'}</td>
      <td className="py-1.5 text-xs text-text-secondary">{e.contexto || e.context || '—'}</td>
    </tr>
  );
}

function ExtTable({ exts, emptyMsg }) {
  if (!exts || exts.length === 0)
    return <p className="text-sm text-text-secondary">{emptyMsg || 'Nenhum ramal encontrado.'}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-default">
            <th className="pb-2 pr-4 text-left text-text-secondary">Ramal</th>
            <th className="pb-2 pr-4 text-left text-text-secondary">Nome</th>
            <th className="pb-2 pr-4 text-left text-text-secondary">Tipo</th>
            <th className="pb-2 pr-4 text-left text-text-secondary">Grupo</th>
            <th className="pb-2 text-left text-text-secondary">Contexto</th>
          </tr>
        </thead>
        <tbody>
          {exts.slice(0, 100).map((e, i) => <ExtRow key={e.id || i} e={e} i={i} />)}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-text-secondary">{exts.length} ramal(is)</p>
    </div>
  );
}

function LoadingRow() {
  return <p className="text-sm text-text-secondary">Carregando…</p>;
}

// ─── Tabs individuais ─────────────────────────────────────────────────────────

function DdrTab() {
  const { routes, loading } = useRoutes();
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!routes) return [];
    let r = routes.filter((x) =>
      String(x.direction || '').toLowerCase().includes('inbound') ||
      String(x.contexto || '').toLowerCase().includes('entrada') ||
      String(x.contexto || '').toLowerCase().includes('ddr') ||
      String(x.contexto || '').toLowerCase().includes('did'),
    );
    if (search) r = r.filter((x) => JSON.stringify(x).toLowerCase().includes(search.toLowerCase()));
    return r;
  }, [routes, search]);

  return (
    <div className="space-y-4">
      <InfoCard title="DDR — Discagem Direta a Ramal" badge="Rotas de entrada" badgeClass={BADGE_BLUE}
        description="O DDR permite que chamadas externas cheguem diretamente a um ramal sem passar pela URA. No sistema atual, é configurado como uma rota de entrada (inbound) que mapeia o DID recebido para um ramal ou contexto específico.">
        <div className="text-sm text-text-secondary space-y-1">
          <p>• Configure em <strong>Rotas</strong> com direção <em>inbound</em></p>
          <p>• O padrão de discagem deve corresponder ao DID recebido da operadora</p>
          <p>• O destino é o ramal, fila ou IVR para onde a chamada é encaminhada</p>
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Rotas de entrada (DDR)</h3>
        <input className={INPUT + ' max-w-xs'} placeholder="Filtrar…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {loading ? <LoadingRow /> : <RoutesTable routes={filtered} emptyMsg="Nenhuma rota de entrada configurada. Adicione em Rotas com direção inbound." />}
        {!loading && routes && routes.length > 0 && filtered.length === 0 && (
          <p className="text-xs text-text-secondary">Exibindo apenas rotas com direção/contexto de entrada. Total de rotas: {routes.length}</p>
        )}
      </div>
    </div>
  );
}

function DesvioTab() {
  const { routes, loading } = useRoutes();
  const filtered = useMemo(() => {
    if (!routes) return [];
    return routes.filter((x) =>
      String(x.contexto || x.action || x.name || '').toLowerCase().match(/desvio|forward|encaminh/),
    );
  }, [routes]);

  return (
    <div className="space-y-4">
      <InfoCard title="Desvio de Chamada" badge="Call Forward" badgeClass={BADGE_BLUE}
        description="O desvio encaminha chamadas recebidas para outro destino — outro ramal, número externo ou caixa postal. No sistema atual é implementado via regras de roteamento ou configuração por ramal.">
        <div className="text-sm text-text-secondary space-y-1">
          <p>• <strong>Desvio incondicional:</strong> todas as chamadas são redirecionadas</p>
          <p>• <strong>Desvio por ausência:</strong> redireciona quando não atende após N toques</p>
          <p>• <strong>Desvio por ocupado:</strong> redireciona quando o ramal está ocupado</p>
          <p>• Configure em <strong>Rotas</strong> usando prioridades e condições, ou diretamente no ramal (campo <em>desvio</em>)</p>
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Rotas de desvio configuradas</h3>
        {loading ? <LoadingRow /> : <RoutesTable routes={filtered} emptyMsg="Nenhuma rota de desvio identificada. Configure em Rotas com contexto 'desvio' ou 'forward'." />}
      </div>
    </div>
  );
}

function TransbordoTab() {
  const { routes, loading } = useRoutes();
  const filtered = useMemo(() => {
    if (!routes) return [];
    return routes.filter((x) =>
      String(x.contexto || x.action || x.name || '').toLowerCase().match(/transbordo|overflow|overf/),
    );
  }, [routes]);

  return (
    <div className="space-y-4">
      <InfoCard title="Transbordo / Overflow" badge="Overflow routing" badgeClass={BADGE_BLUE}
        description="O transbordo redireciona chamadas quando um recurso está saturado — fila cheia, todos os agentes ocupados, ou ramal não disponível. Garante continuidade do atendimento.">
        <div className="text-sm text-text-secondary space-y-1">
          <p>• Em filas ACD: configure <strong>joinempty</strong> e <strong>leavewhenempty</strong> na aba Filas</p>
          <p>• Em rotas: adicione regra com contexto <em>transbordo</em> apontando para destino alternativo</p>
          <p>• Pode transbordar para: outro ramal, fila secundária, URA, número externo ou caixa postal</p>
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Rotas de transbordo configuradas</h3>
        {loading ? <LoadingRow /> : <RoutesTable routes={filtered} emptyMsg="Nenhuma rota de transbordo identificada. Configure em Rotas com contexto 'transbordo' ou 'overflow'." />}
      </div>
    </div>
  );
}

function RetornoTab() {
  const { routes, loading } = useRoutes();
  const filtered = useMemo(() => {
    if (!routes) return [];
    return routes.filter((x) =>
      String(x.contexto || x.action || x.name || '').toLowerCase().match(/retorno|callback|return/),
    );
  }, [routes]);

  return (
    <div className="space-y-4">
      <InfoCard title="Retorno de Chamada" badge="Callback" badgeClass={BADGE_BLUE}
        description="O retorno automático (callback) permite que clientes deixem uma solicitação de retorno em vez de aguardar na fila. O sistema retorna a chamada quando um agente fica disponível.">
        <div className="text-sm text-text-secondary space-y-1">
          <p>• Callbacks agendados: veja a aba <strong>Callbacks</strong> no Contact Center</p>
          <p>• Callback automático de fila: configure na IVR com contexto <em>retorno</em></p>
          <p>• Retorno por ramal: configure a opção de retorno no dialplan da fila</p>
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Rotas de retorno configuradas</h3>
        {loading ? <LoadingRow /> : <RoutesTable routes={filtered} emptyMsg="Nenhuma rota de retorno identificada. Veja a aba Callbacks para retornos agendados." />}
      </div>
    </div>
  );
}

function RecusaTab() {
  const { routes, loading } = useRoutes();
  const filtered = useMemo(() => {
    if (!routes) return [];
    return routes.filter((x) =>
      String(x.contexto || x.action || x.name || '').toLowerCase().match(/recusa|reject|block|bloque/),
    );
  }, [routes]);

  return (
    <div className="space-y-4">
      <InfoCard title="Recusa de Chamada" badge="Call Rejection" badgeClass={BADGE_AMBER}
        description="Regras de recusa bloqueiam ou rejeitam chamadas de números específicos, faixas ou contextos indesejados. Pode ser feita a nível de rota ou ACL.">
        <div className="text-sm text-text-secondary space-y-1">
          <p>• <strong>ACLs de rede:</strong> bloqueio a nível SIP via aba <strong>ACLs</strong></p>
          <p>• <strong>Recusa por padrão:</strong> crie uma rota com ação <em>Hangup</em> para o padrão desejado</p>
          <p>• <strong>Bloqueio de ramal:</strong> configure permissão de discagem <em>0.0.0.0/0</em> na aba Ramais</p>
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Rotas de recusa configuradas</h3>
        {loading ? <LoadingRow /> : <RoutesTable routes={filtered} emptyMsg="Nenhuma rota de recusa identificada. Configure em Rotas com contexto 'recusa' ou 'reject'." />}
      </div>
    </div>
  );
}

function FeriadoTab() {
  const { routes, loading } = useRoutes();
  const filtered = useMemo(() => {
    if (!routes) return [];
    return routes.filter((x) =>
      String(x.contexto || x.action || x.name || '').toLowerCase().match(/feriado|holiday|horario|fora/),
    );
  }, [routes]);

  return (
    <div className="space-y-4">
      <InfoCard title="Feriados e Horário de Funcionamento" badge="Holiday routing" badgeClass={BADGE_BLUE}
        description="Permite roteamento diferenciado em feriados e fora do horário comercial — redirecionando para URA de ausência, caixa postal ou número de plantão.">
        <div className="text-sm text-text-secondary space-y-1">
          <p>• Configure na IVR usando a função <strong>GotoIfTime</strong> no dialplan</p>
          <p>• Defina a lista de feriados e o destino alternativo para cada período</p>
          <p>• Exemplo de contexto: <em>[horario-comercial]</em> com salto para <em>[fora-horario]</em></p>
          <p>• Veja a aba <strong>IVR</strong> para configurar os fluxos de atendimento por horário</p>
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Rotas de feriado/horário</h3>
        {loading ? <LoadingRow /> : <RoutesTable routes={filtered} emptyMsg="Nenhuma rota de feriado identificada. Configure no IVR ou em Rotas com contexto 'feriado' ou 'holiday'." />}
      </div>
    </div>
  );
}

function TransferenciaTab() {
  const { routes, loading } = useRoutes();
  const filtered = useMemo(() => {
    if (!routes) return [];
    return routes.filter((x) =>
      String(x.contexto || x.action || x.name || '').toLowerCase().match(/transfer|transf/),
    );
  }, [routes]);

  return (
    <div className="space-y-4">
      <InfoCard title="Transferência de Chamada" badge="Call Transfer" badgeClass={BADGE_BLUE}
        description="Permite transferir chamadas em curso para outro ramal, fila ou número externo — via DTMF durante a chamada ou por regra de roteamento.">
        <div className="text-sm text-text-secondary space-y-1">
          <p>• <strong>Transferência cega:</strong> tecla <em>*1</em> + número destino (configurável no dialplan)</p>
          <p>• <strong>Transferência supervisionada:</strong> tecla <em>*2</em> + número, aguarda antes de transferir</p>
          <p>• <strong>Attended transfer SIP:</strong> suportado via PJSIP com <em>REFER</em> habilitado</p>
          <p>• Configure os feature codes em <strong>features.conf</strong> ou via variáveis de contexto</p>
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Rotas de transferência configuradas</h3>
        {loading ? <LoadingRow /> : <RoutesTable routes={filtered} emptyMsg="Nenhuma rota de transferência identificada. Configure em Rotas com contexto 'transferencia'." />}
      </div>
    </div>
  );
}

function GruposTab() {
  const { extensions, loading } = useExtensions();
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!extensions) return [];
    let r = extensions.filter((x) =>
      String(x.tipo || x.type || '').toLowerCase().match(/grupo|group|ring/) ||
      String(x.contexto || x.context || '').toLowerCase().includes('grupo') ||
      String(x.grupo || '').trim() !== '',
    );
    if (search) r = r.filter((x) => JSON.stringify(x).toLowerCase().includes(search.toLowerCase()));
    return r;
  }, [extensions, search]);

  return (
    <div className="space-y-4">
      <InfoCard title="Grupos de Ramais" badge="Ring Groups" badgeClass={BADGE_BLUE}
        description="Grupos permitem que uma chamada toque simultaneamente em vários ramais (ring group). Qualquer membro do grupo pode atender. Diferente de filas ACD, os grupos não têm gerenciamento de agentes.">
        <div className="text-sm text-text-secondary space-y-1">
          <p>• Configure grupos na aba <strong>Ramais</strong> usando tipo <em>grupo</em> ou contexto <em>grupo</em></p>
          <p>• Para filas com distribuição automática, use a aba <strong>Filas</strong></p>
          <p>• O campo <em>grupo</em> no ramal associa o endpoint a um grupo específico</p>
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Ramais de grupo</h3>
        <input className={INPUT + ' max-w-xs'} placeholder="Filtrar…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {loading ? <LoadingRow /> : <ExtTable exts={filtered} emptyMsg="Nenhum ramal de grupo encontrado. Configure em Ramais com tipo 'grupo' ou campo grupo preenchido." />}
        {!loading && extensions && extensions.length > 0 && filtered.length === 0 && (
          <p className="text-xs text-text-secondary">Total de ramais: {extensions.length}. Nenhum identificado como grupo.</p>
        )}
      </div>
    </div>
  );
}

function BloqueioTab() {
  const { extensions, loading } = useExtensions();
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!extensions) return [];
    let r = extensions.filter((x) =>
      (String(x.bloqueio || '').trim() && x.bloqueio !== '0.0.0.0/0') ||
      String(x.permissao || '').trim() === '0.0.0.0/0' ||
      String(x.tipo || '').toLowerCase().includes('bloque'),
    );
    if (search) r = r.filter((x) => JSON.stringify(x).toLowerCase().includes(search.toLowerCase()));
    return r;
  }, [extensions, search]);

  return (
    <div className="space-y-4">
      <InfoCard title="Bloqueio de Discagem" badge="Call Blocking" badgeClass={BADGE_AMBER}
        description="O bloqueio restringe quais números um ramal pode discar — impedindo chamadas internacionais, celulares ou DDDs específicos. Configurado por categoria/permissão no ramal.">
        <div className="text-sm text-text-secondary space-y-1">
          <p>• Configure o campo <strong>permissão</strong> e <strong>bloqueio</strong> por ramal na aba <strong>Ramais</strong></p>
          <p>• O campo <em>tipo</em> define a categoria de discagem permitida (Livre, Local, DDD, DDI)</p>
          <p>• Para bloqueio de entrada, use ACLs SIP na aba <strong>ACLs</strong></p>
        </div>
      </InfoCard>
      <div className={PANEL}>
        <h3 className="text-base font-semibold text-text-primary">Ramais com bloqueio ativo</h3>
        <input className={INPUT + ' max-w-xs'} placeholder="Filtrar…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {loading ? <LoadingRow /> : <ExtTable exts={filtered} emptyMsg="Nenhum ramal com bloqueio específico encontrado." />}
        {!loading && extensions && extensions.length > 0 && filtered.length === 0 && (
          <p className="text-xs text-text-secondary">Todos os ramais estão com permissão padrão. Total: {extensions.length}</p>
        )}
      </div>
    </div>
  );
}

// ─── Export principal ─────────────────────────────────────────────────────────

export function PbxRoutingDetailTabs({ tab }) {
  const active = ROUTING_TABS.some((t) => t.key === tab);
  if (!active) return null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-border-default pb-2 flex-wrap">
        {ROUTING_TABS.map((t) => (
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
      {tab === 'routesDdr' && <DdrTab />}
      {tab === 'routesDesvio' && <DesvioTab />}
      {tab === 'routesTransbordo' && <TransbordoTab />}
      {tab === 'routesRetorno' && <RetornoTab />}
      {tab === 'routesRecusa' && <RecusaTab />}
      {tab === 'routesFeriado' && <FeriadoTab />}
      {tab === 'routesTransferencia' && <TransferenciaTab />}
      {tab === 'extensionsGrupos' && <GruposTab />}
      {tab === 'extensionsBloqueio' && <BloqueioTab />}
    </div>
  );
}
