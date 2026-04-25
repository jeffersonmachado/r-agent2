import React, { useMemo } from 'react';
import { NavigationLink } from './NavigationLink';
import { filterNavigationTree } from '../utils/menuPermissions';
import { navigationMenu } from '../navigation/menu';
import { buildWorkspaceAreas } from '../navigation/workspaceAreas';

const CONTEXT_PRESETS = {
  support: {
    title: 'Atendimento em foco',
    blocks: [
      { title: 'Contexto rapido', items: ['Cliente e conta', 'Resumo de atendimento', 'Tags e entidades', 'Historico recente'] },
      { title: 'Fluxo recomendado', items: ['Identificar prioridade', 'Registrar evidencia', 'Atualizar status', 'Encerrar com motivo'] },
    ],
  },
  crm: {
    title: 'Pipeline comercial',
    blocks: [
      { title: 'Visao comercial', items: ['Contas e contatos chave', 'Oportunidades criticas', 'Leads em risco', 'Atividades pendentes'] },
      { title: 'Acoes rapidas', items: ['Atualizar etapa', 'Registrar interacao', 'Criar tarefa de follow-up', 'Planejar campanha'] },
    ],
  },
  operations: {
    title: 'Operacao em tempo real',
    blocks: [
      { title: 'Saude operacional', items: ['Canais e filas', 'Alertas prioritarios', 'Eventos recentes', 'Disponibilidade de servicos'] },
      { title: 'Resposta operacional', items: ['Escalonar incidente', 'Revisar replay', 'Ajustar capacidade', 'Comunicar stakeholders'] },
    ],
  },
  builder: {
    title: 'Construcao e validacao',
    blocks: [
      { title: 'Ciclo de entrega', items: ['Fluxos recentes', 'Templates relevantes', 'Testes e validacoes', 'Execucoes monitoradas'] },
      { title: 'Proximos passos', items: ['Modelar mudanca', 'Executar smoke', 'Publicar versao', 'Acompanhar runtime'] },
    ],
  },
  admin: {
    title: 'Governanca da plataforma',
    blocks: [
      { title: 'Controles essenciais', items: ['Tenant ativo', 'Permissoes e acessos', 'Auditoria recente', 'Integracoes chave'] },
      { title: 'Higiene operacional', items: ['Revisar politicas', 'Atualizar credenciais', 'Verificar compliance', 'Registrar mudancas'] },
    ],
  },
  overview: {
    title: 'Panorama executivo',
    blocks: [
      { title: 'Resumo do workspace', items: ['Status atual', 'Pontos de atencao', 'Prioridades do dia', 'Atalhos por area'] },
    ],
  },
};

export function ContextPanel({ agent, currentPath, tenantLabel = '' }) {
  const filteredMenu = useMemo(() => filterNavigationTree(agent, navigationMenu), [agent]);
  const { activeArea } = useMemo(
    () => buildWorkspaceAreas(filteredMenu, currentPath),
    [filteredMenu, currentPath],
  );

  const shortcuts = useMemo(() => (activeArea?.items || []).slice(0, 6), [activeArea]);
  const presetKey = activeArea?.defaultContextPanel || 'overview';
  const preset = CONTEXT_PRESETS[presetKey] || CONTEXT_PRESETS.overview;

  return (
    <aside className="rap-context-panel" aria-label="Painel de contexto">
      <section className="rap-context-card">
        <h3>{preset.title}</h3>
        <p>{activeArea?.description || 'Sem area ativa.'}</p>
        <div className="rap-context-meta">
          <span>Perfil: {agent?.role || 'desconhecido'}</span>
          <span>Conta: {tenantLabel || agent?.tenantId || 'n/d'}</span>
          <span>Escopo: {activeArea?.searchScope || 'geral'}</span>
        </div>
      </section>

      {preset.blocks.map((block) => (
        <section key={block.title} className="rap-context-card">
          <h3>{block.title}</h3>
          <ul className="rap-context-list">
            {block.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}

      <section className="rap-context-card">
        <h3>Atalhos da area</h3>
        <div className="rap-context-shortcuts">
          {shortcuts.length > 0 ? shortcuts.map((item) => (
            <NavigationLink key={item.id} to={item.path} className="rap-context-shortcut-link">
              {item.label}
            </NavigationLink>
          )) : <span className="rap-context-empty">Nenhum atalho disponivel.</span>}
        </div>
      </section>

      <section className="rap-context-card">
        <h3>Produtividade</h3>
        <ul className="rap-context-tips">
          <li>Use Ctrl/Cmd + K para abrir a paleta de comandos.</li>
          <li>Priorize os atalhos da macroarea atual.</li>
          <li>Mantenha o contexto atualizado antes de agir.</li>
        </ul>
      </section>
    </aside>
  );
}

export default ContextPanel;
