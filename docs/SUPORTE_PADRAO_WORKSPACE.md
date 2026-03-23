# Padrão do Workspace de Atendimento (`/support`)

Este documento codifica as convenções de arquitetura, visual e comportamento que devem ser preservadas em **toda** alteração na página `/support` e seus módulos relacionados.

---

## Arquitetura de Módulos

O workspace é composto por:

| Arquivo | Responsabilidade |
|---|---|
| `frontend/src/pages/SupportPage.jsx` | Orquestrador central: estado, handlers, lógica de negócio da UI |
| `frontend/src/modules/support-workspace/components/SupportWorkspaceHeader.jsx` | Cabeçalho com status WS, botão nova conversa, botão atualizar |
| `frontend/src/modules/support-workspace/components/SupportFiltersBar.jsx` | Barra de filtros: busca, fila, view filter chips |
| `frontend/src/modules/support-workspace/components/SupportTicketList.jsx` | Lista de tickets à esquerda |
| `frontend/src/modules/support-workspace/components/SupportConversationPane.jsx` | Painel central: histórico de mensagens + compositor |
| `frontend/src/modules/support-workspace/components/SupportDetailsSidebar.jsx` | Painel direito recolhível: cards de detalhes |
| `frontend/src/hooks/useSupportTicketContext.js` | Hook: mensagens, eventos, auditoria, resumo IA, entidades |
| `frontend/src/hooks/useSupportEvidence.js` | Hook: RAG evidence, sugestão de resposta, histórico de identidade |
| `frontend/src/components/support/SupportCard.jsx` | Card genérico reutilizável para o sidebar |
| `frontend/src/components/support/SupportResolvedEntityCard.jsx` | Card de identidade resolvida pelo RAG |
| `frontend/src/components/support/SupportEvidenceCard.jsx` | Card de evidências RAG |
| `frontend/src/components/support/SupportSuggestedReplyCard.jsx` | Card de sugestão de resposta IA |
| `frontend/src/components/support/SupportHistoryCard.jsx` | Card de histórico de conversas anteriores |
| `frontend/src/pages/support/SupportDeliveryFailuresModal.jsx` | Modal de falhas de entrega |
| `frontend/src/pages/support/SupportCloseTicketModal.jsx` | Modal de encerramento com motivo obrigatório |
| `frontend/src/pages/support/SupportNewConversationModal.jsx` | Modal para iniciar nova conversa |

**Regra:** toda lógica nova deve ficar no `SupportPage.jsx` ou em hooks dedicados. Os componentes filhos são Presentational — recebem only props e disparam callbacks.

---

## Layout de 3 Colunas

```
┌────────────────────────────────────────────────────────────┐
│  SupportWorkspaceHeader (cabeçalho full-width)             │
├────────────────────────────────────────────────────────────┤
│  SupportFiltersBar (filtros full-width, colapsável)        │
├──────────────┬─────────────────────────┬───────────────────┤
│ Ticket List  │  Conversation Pane      │ Details Sidebar   │
│ (coluna esq) │  (coluna central)       │ (coluna dir)      │
│              │                         │ recolhível mobile │
└──────────────┴─────────────────────────┴───────────────────┘
```

Classes CSS raiz usadas pelo layout:

```css
.support-grid          /* grid 3 colunas */
.support-grid.is-mobile
.support-grid.right-open
.support-grid.has-selected
.support-details-panel    /* wrapper do painel central + sidebar */
.support-details-split    /* flex row central + sidebar */
.support-details-empty    /* placeholder quando nenhum ticket selecionado */
```

**Mobile:** em `window.innerWidth <= 900`, a sidebar é escondida por padrão e o painel de lista some quando um ticket é selecionado. O botão de toggle `support-right-panel-toggle` controla `isRightPanelCollapsed`.

---

## Padrão Visual dos Cards do Sidebar

Todos os cards do painel direito usam **exatamente** esta classe Tailwind + estilo inline:

```jsx
<div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
  {/* Cabeçalho: título + badge/ação à direita */}
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
    <div style={{ fontWeight: 700 }}>Título do Card</div>
    <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>Metadado</div>
  </div>
  {/* Conteúdo */}
  <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
    …
  </div>
</div>
```

Para cards com título padronizados e reutilizáveis, usar `<SupportCard>`:

```jsx
<SupportCard id="support-section-entidades" title="Entidades" subtitle="Itens extraídos automaticamente">
  …
</SupportCard>
```

### Cards presentes no sidebar (ordem)

1. **Contato** — telefone, fila, status, canal, ID conversa, data criação + badge de modo (BOT / HUMANO / PAUSADO)
2. **Resumo IA** — texto gerado + metadado `Gerado em … • por IA`
3. **SupportResolvedEntityCard** — identidade RAG
4. **SupportEvidenceCard** — evidências RAG com ações copiar/usar/abrir
5. **SupportSuggestedReplyCard** — sugestão de resposta automática
6. **SupportHistoryCard** — histórico de interações anteriores
7. **Entidades** (`SupportCard`) — e-mails, telefones, CPF, CNPJ, URLs extraídos
8. **Tags** — chips com X para remover + input para adicionar
9. **Handover & atribuições** (condicional) — histórico das últimas 8 transições
10. **Eventos do ticket** — lista paginada (max 20) com payload inline
11. **Auditoria** — logs com `action`, `timestamp`, `username`, `details`

---

## Padrão de Renderização de Itens de Lista (Logs/Eventos/Auditoria)

Cada item de lista dentro dos cards usa:

```jsx
<div style={{
  padding: '8px',
  borderRadius: '10px',
  border: '1px solid var(--color-border-default)',
  background: 'var(--color-bg-secondary)',
  marginBottom: '8px',
}}>
  {/* Header: nome + data */}
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
    <div style={{ fontWeight: 600 }}>{item.action || item.type}</div>
    <div style={{ color: 'var(--color-text-tertiary)' }}>{formatDate(item.timestamp)}</div>
  </div>
  {/* Corpo: ator + detalhes */}
  <div style={{ marginTop: '4px' }}>
    <strong>{item.username || 'sistema'}</strong>
    {item.details && (
      <span style={{ color: 'var(--color-text-tertiary)' }}>
        {' • '}
        {typeof item.details === 'string'
          ? item.details
          : Object.entries(item.details)
              .filter(([, v]) => v != null)
              .map(([k, v]) => `${k}: ${v}`)
              .join(' • ')}
      </span>
    )}
  </div>
</div>
```

**❌ NUNCA** usar `JSON.stringify(obj)` diretamente para renderizar `details` ou `payload` de objetos. Sempre usar o padrão `Object.entries` acima ou um `<details><summary>Ver payload</summary><pre>…</pre></details>` para payloads complexos.

---

## Modo Badge (BOT / HUMANO / PAUSADO)

```jsx
const getModeLabel = (mode) => {
  const m = (mode || 'bot');
  if (m === 'human')  return { label: 'HUMANO',  bg: '#fff7ed', fg: '#9a3412' };
  if (m === 'paused') return { label: 'PAUSADO', bg: '#f3f4f6', fg: '#374151' };
  return                     { label: 'BOT',     bg: '#ecfdf5', fg: '#065f46' };
};
```

```jsx
<span style={{
  padding: '2px 8px',
  borderRadius: '999px',
  fontSize: '11px',
  border: '1px solid rgb(221, 221, 221)',
  background: getModeLabel(ticket.mode).bg,
  color: getModeLabel(ticket.mode).fg,
}}>
  {getModeLabel(ticket.mode).label}
</span>
```

---

## Compositor (Composer)

Classes CSS do compositor:

```
.support-message-compose          // wrapper flex
.support-form-textarea            // textarea base
.support-message-compose-textarea // textarea do compositor
.support-compose-actions          // linha de botões de ação
.support-compose-action-button    // botão de ação (emoji, anexo, mic, RAG)
.support-send-icon-button         // botão de envio com SVG
```

O botão de envio **deve** ter `display: inline-flex; align-items: center; justify-content: center;` para centralizar o ícone SVG. O SVG filho deve ter `display: block`.

### Menu Slash (`/`)

O compositor suporta menu slash com navegação por teclado:

| Tecla | Comportamento |
|-|-|
| `/` (início da linha) | Abre o menu slash |
| `ArrowDown` / `ArrowUp` | Navega nos itens com scroll automático (`scrollIntoView`) |
| `Enter` | Executa o item destacado (índice `slashMenuCursorIndex`) |
| `Ctrl+Enter` / `⌘+Enter` | Envia mensagem (sem menu slash) |
| Hover | Sincroniza `slashMenuCursorIndex` via `onHoverSlashItem` |

Estado gerenciado em `SupportPage.jsx`:
- `slashMenuCursorIndex` — índice do item ativo (-1 = nenhum)
- `quickReplySlashOpen` — visibilidade do menu
- `slashMenuMode` — `'commands'` | `'quick_replies'`
- `slashCommandResults` — lista de comandos filtrados
- `quickReplySlashResults` — lista de respostas rápidas filtradas

Classes CSS do menu:
```
.support-slash-menu               // container (tem ref para scroll)
.support-slash-menu-item          // item base
.support-slash-menu-item.is-active // item destacado pelo teclado/hover
```

Comandos slash disponíveis (condicionais ao `ticket.mode`):

| Modo | Comandos |
|-|-|
| `bot` | `/assumir`, `/resposta-rapida`, `/agendar`, `/falhas-entrega`, `/fechar-ticket` |
| `human` | `/devolver-bot`, `/pausar`, `/resposta-rapida`, `/agendar`, `/falhas-entrega`, `/fechar-ticket` |
| `paused` | `/retomar`, `/resposta-rapida`, `/agendar`, `/falhas-entrega`, `/fechar-ticket` |

Ao digitar 2+ caracteres que não correspondam a nenhum comando, uma busca por respostas rápidas é feita via `debouncedSearchSlashQuickReplies`.

---

## Ações do Ticket (Handover)

| Ação | Handler | Endpoint | Transição |
|-|-|-|-|
| Assumir | `handleTakeOver` | `POST /tickets/:id/take-over` | → `human` |
| Devolver ao bot | `handleReturnToBot` | `POST /tickets/:id/return-to-bot` | → `bot` |
| Pausar | `handlePause` | `POST /tickets/:id/pause` | → `paused` |
| Retomar | `handleResume` | `POST /tickets/:id/resume` | → `human` |
| Fechar | `handleClose` + modal | `POST /tickets/:id/close` | → `closed` |
| Atribuir | `handleAssign` | `POST /tickets/:id/assign` | assignedTo muda |

Todas as ações de handover usam o estado `handoverLoading` para desabilitar botões durante a chamada.  
Após qualquer handover: `setSelectedTicket(updated)`, `setTickets(prev => ...)`, reload da lista e mensagens.

---

## Resumo IA

- **Backend:** `api/services/ticketInsightService.js` → salva `{ text, generatedAt, generatedBy: { id: 'ai-summary-service', username: 'IA' } }` em `ticket.context.aiSummary`
- **Frontend:** `useSupportTicketContext.js` expõe `aiSummary` e `handleGenerateAiSummary`
- **Renderização:**
  - Se `aiSummary.text` existe: exibe como `white-space: pre-wrap` + linha de metadado `Gerado em … • por IA`
  - Se `aiSummary` é string (legado): exibe diretamente
  - Fallback (`text` ausente): `safeStringify` em `<pre>`
- **Regra:** `generatedBy` é sempre `'ai-summary-service'` — nunca depende do agente que clicou no botão

---

## Contato: Resolução do Nome

A função `getContactName(ticket)` segue esta cadeia de fallback (a expandir quando necessário):

```js
function getContactName(ticket) {
  return ticket?.contactName
    || ticket?.contact?.name
    || ticket?.context?.contactName
    || ticket?.context?.contact?.name
    || ticket?.customerName
    || ticket?.context?.metadata?.contactName
    || ticket?.context?.variables?.customerName
    || ticket?.context?.variables?.name
    || ticket?.context?.variables?.nome
    || ticket?.phoneNumber
    || 'Sem contato';
}
```

**❌ Nunca** retornar `phoneNumber` antes de esgotar as fontes de nome acima. O telefone é último recurso antes de `'Sem contato'`.

---

## Conectividade (WebSocket)

O workspace usa WebSocket como fonte primária de atualizações em tempo real — **sem polling**.

Eventos subscritos:
- `ticket.created`
- `ticket.assigned`
- `ticket.updated`
- `ticket.closed`
- `ticket.message.received`
- `ticket.message.sent`

Status visual exibido no header:

| Phase | Label | Cor |
|-|-|-|
| `ready` | Conectado | `rgb(37, 211, 102)` (verde) |
| `auth` | Autenticando... | `rgb(59, 130, 246)` (azul) |
| `connecting` | Conectando... | `rgb(59, 130, 246)` (azul) |
| `disconnected` | Desconectado | `rgb(245, 158, 11)` (âmbar) |

Erros `ECONNRESET` / `socket hang up` no Vite proxy são **transitórios** e causados pelo reinício do processo API pelo nodemon — não indicam bug de código.

---

## Conteúdo de Mensagens (Renderização por Tipo)

A função `renderTimelineMessageContent(msg)` trata os seguintes tipos de mensagem de canal:

| Tipo | Renderização |
|-|-|
| `text` | Texto plano |
| `interactive` | Header "Interativo" + resposta escolhida + `<details>` com payload |
| `image` | Preview com `<img>` ou fallback MIME+ID |
| `document` | Link "Abrir documento" ou fallback MIME+ID |
| `audio` / `voice` | Player `<audio>` ou fallback |
| `video` | Player `<video>` ou fallback |
| outros | Texto + `<details>Ver payload</details>` |

Payloads complexos **sempre** ficam dentro de `<details><summary>Ver payload</summary><pre>…</pre></details>`.

---

## Encerramento de Ticket

O encerramento requer **motivo obrigatório** (Blip-like):

1. `handleClose(ticketId)` abre `SupportCloseTicketModal`
2. Agente seleciona/digita motivo + opcionalmente tags CSV
3. `handleConfirmClose` exige `selectedCloseReasonId` ou `selectedCloseReasonName` preenchido
4. Exibe `ConfirmDialog` de confirmação antes de chamar a API
5. Após sucesso: `setSelectedTicket(null)`, reload da lista

---

## Regras de Manutenção

1. **Não adicionar `JSON.stringify` direto em render** — usar o padrão `Object.entries` ou `<details>`.
2. **Não criar polling** — toda atualização deve vir via WebSocket ou ação explícita do usuário.
3. **Não mover lógica de handover para componentes filhos** — handlers ficam em `SupportPage.jsx`.
4. **Não mostrar `phoneNumber` como nome do contato** — seguir a cadeia `getContactName`.
5. **Não adicionar estilos estáticos inline** — usar classes CSS existentes ou classes Tailwind; inline só para valores dinâmicos (cores de badge, etc.).
6. **Sempre desabilitar botões de handover com `handoverLoading`** durante chamadas assíncronas.
7. **Menu slash deve sempre sincronizar cursor via `onHoverSlashItem`** e fazer scroll automático via `scrollIntoView({ block: 'nearest' })`.
8. **O resumo IA nunca deve expor o agente solicitante** — `generatedBy` é sempre `'ai-summary-service'`.
