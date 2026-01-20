## Fase 4 — Console Operacional (Support)

Objetivo: deixar o `SupportPage` operacionalmente “pronto para produção”, com foco em produtividade do operador e rastreabilidade.

### Principais entregas

- **Quick Replies + atalhos**
  - Sugestões automáticas por contexto: baseado na última mensagem do cliente, o frontend chama `POST /quick-replies/search`.
  - Atalho por barra: digitar `/<termo>` busca `GET /quick-replies?search=<termo>` e permite inserir com um clique.
  - Substituição simples de variáveis: placeholders `{{chave}}` são resolvidos usando `ticket.context.variables` no frontend.

- **Tags com trilha auditável**
  - A UI permite adicionar/remover tags diretamente no ticket.
  - Persistência (compatível com legado):
    - **Legado**: mantém `Ticket.tags` (JSONB/array) para filtros/compatibilidade.
    - **Novo**: registra trilha em `ticket_tags` com `action=add|remove` (best-effort).
  - Ações ficam visíveis também como **mensagens `system`** no histórico do ticket (ex.: “Tag adicionada: cobrança”).

- **Motivos de encerramento**
  - Tabela `close_reasons` (por tenant) sem defaults automáticos (seed explícito por tenant).
  - UI de encerramento exibe um modal com:
    - seleção de motivo via `GET /close-reasons`
    - campo texto livre alternativo
  - Encerramento compatível: `POST /tickets/:id/close` continua funcionando sem body, mas agora aceita `{ closeReasonId, closeReasonName }`.
  - Motivo escolhido é salvo em `ticket.context.closeReasonName` e aparece como mensagem `system` de encerramento.

- **Resumo IA (best-effort)**
  - Endpoint:
    - `GET /tickets/:id/ai-summary` retorna cache em `ticket.context.aiSummary`
    - `POST /tickets/:id/ai-summary` gera/atualiza
  - Implementação:
    - tenta usar provider configurado via `aiProviderService.generateAiResponse`
    - se falhar, faz **fallback heurístico** baseado na última mensagem do cliente, tags e variáveis
  - UI mostra o resumo e um botão “Gerar/Atualizar”.

### Modelo de dados

- `close_reasons`
  - `id`, `tenant_key`, `name`, `active`, `created_by`, `created_at`, `updated_at`

- `ticket_tags`
  - `id`, `tenant_key`, `ticket_id`, `tag`, `action`, `actor_user_id`, `created_at`

### Observações importantes

- **Multi-tenant**: `close_reasons` e `ticket_tags` são `tenant_key-based`. O endpoint de listagem de motivos filtra por `req.tenantId`.
- **Compatibilidade**: nenhuma rota existente foi removida; `POST /tickets/:id/close` mantém o comportamento anterior quando não há JSON body.
- **Rastreabilidade**: além da auditoria global existente (`auditService`), ações-chave aparecem no próprio ticket via mensagens `system`.

