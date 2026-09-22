# POST_RELEASE_MODEL_ROUTER_BACKLOG.md

Itens explicitamente **fora do escopo da V1** do Engineering Model Router. Registrados aqui e
**não implementados** nesta missão, por instrução direta do escopo congelado. Cada item deve
ser reavaliado como uma missão própria, com seu próprio ciclo de auditoria/backlog/execução.

## Roteamento adaptativo / aprendizado
- Aprendizado histórico (machine learning) do router — decisão de roteamento sempre
  determinística/explicável na V1.
- Reinforcement learning para seleção de modelo.
- Bandit selection (multi-armed bandit) entre modelos/providers.
- Pesos de roteamento dinâmicos/adaptativos.
- Motor `ModelPerformance` adaptativo completo (score histórico de acerto por modelo/tarefa).
- Motor de recomendação de modelo baseado em histórico.

## Providers e benchmarking
- Challenger models automáticos (testar modelo alternativo em paralelo silenciosamente).
- Benchmark automático de providers/modelos.
- Novos providers de IA além dos já existentes no registry (`openai`, `anthropic`, `deepseek`,
  `kimi`, `mistral`, `groq`) — a menos que uma necessidade real e concreta surja.

## Custo
- Otimização automática de custo (trocar de modelo sozinho para economizar).
- Matriz de performance avançada custo × qualidade × latência.

## Arquitetura
- Reescrita ampla do AI Control Plane (`engine/aiControlPlaneResilience.js`,
  `api/services/aiControlPlaneStatus.js`) — a V1 apenas consome o que já existe.
- Reescrita ampla do `AutoCorrectionService`/`FailureDiagnosisService`/`PatchProposalService`/
  `CorrectionValidationService` — a V1 cria um fluxo novo e paralelo, sem tocar nesses arquivos.
- Redesign completo da área "Engineering"/"Development" do frontend além das 5 telas da V1.
- Budget Manager real (hoje `BUDGET_MANAGER` no AI Control Plane nunca é alimentado) — a V1
  marca custo como `UNKNOWN` quando o provider não retorna `usage`; um Budget Manager real que
  acumule gasto por tenant/modelo/período é uma missão própria.
- Health check ativo/periódico (polling) de disponibilidade de provider — a V1 usa apenas o
  sinal reativo já existente (estado do circuit breaker + registro no `AiProvider`).
- Suporte a streaming de resposta de IA (hoje toda chamada é request/response síncrona).
- Credencial por modelo dentro do mesmo provider (hoje é `(tenant_id, provider)` único).

## Integração futura (registrada, não implementada)
- Ligar `FailureDiagnosisService`/pipeline de autocorreção de negócio como gatilho automático
  de criação de `EngineeringTask` (a V1 aceita criação direta via API/UI).
- Migração gradual de consumidores de `PatchProposalService` (diff ilustrativo) para o novo
  `coderService` (patch real) do Engineering Router — hoje os dois convivem sem conflito.
- SUPPORT com acesso de leitura a Engineering (hoje é `DEVELOPMENT`-only por padrão; a missão
  prevê isso como "policy explícita futura", não implementada).
- Dashboards avançados pós-release para a área de Models/Router (rankings, tendências).
- Isolamento do worktree de trabalho do Router em relação a pipelines de release concorrentes
  (um `two-pass-release.sh`/`seal-release.sh` rodando em paralelo pode restaurar o working
  tree principal e afetar arquivos ainda não commitados de uma execução em andamento do
  Router se ambos operarem no mesmo checkout — ver nota em `ENGINEERING_ROUTER_V1_BASELINE.md`).

## Achados do PILOT REAL (ERV1-CLOSE, release closure hardening)
Registrados durante a execução de uma tarefa real através do pipeline completo com providers de
IA reais (não fake) — nenhum é bloqueante para GO da V1 (o pipeline reagiu corretamente a todos,
com reroute real e evidência honesta), mas cada um é um hardening real a considerar depois:
- Status de credencial "valid" persistido no banco (`tenant_ai_credentials.status`) pode ficar
  desatualizado entre o último teste de saldo e o uso real — no pilot, DeepSeek estava marcado
  `valid` mas retornou HTTP 402 (sem saldo real) na primeira chamada. O Router reagiu
  corretamente (reroute real via `classifyModelFailure`/`NO_CREDIT`), mas um re-check de saldo
  com TTL curto antes de rotear (não só no momento do salvamento da credencial) reduziria
  tentativas desperdiçadas. Relacionado ao item já registrado acima ("Health check
  ativo/periódico de disponibilidade de provider").
- `credentialRef`/mecanismo de injeção de segredo dedicado para o Engineering Router: hoje a
  credencial de IA é resolvida por `(tenant_id, provider)` como qualquer outro consumidor da
  plataforma (`ENGINEERING_CREDENTIAL_SCOPE` fixo) — não há um mecanismo separado de
  referência/rotação de credencial específico para tarefas de auto-modificação de código. Uma
  missão própria poderia avaliar se o Engineering Router precisa de um escopo de credencial mais
  restrito/rotativo do que o resto da plataforma, dado que aqui a IA recebe código-fonte real.
- `max_iterations` é consumido por QUALQUER outcome do loop (`REROUTE` inclusive), não só por
  tentativas reais de patch — no pilot, 2 das 8 iterações permitidas foram "gastas" só em
  reroutes de infraestrutura (provider sem saldo/modelo indisponível) antes da primeira geração
  de patch real acontecer. Comportamento correto e intencional da V1 (evita loop infinito de
  reroute), mas o operador/UI que cria a task precisa saber dimensionar `max_iterations` com
  folga quando o cenário de credenciais é instável — um contador separado
  (ex.: `codingAttemptsUsed` vs. `reroutesUsed`) seria mais claro para quem está configurando a
  task, sem mudar o comportamento de segurança atual.

## Achados da missão FINAL_SEAL (ER-V1-SEAL-005 — Current Model Policy)
Registrado durante a investigação do RED real de ER-V1-SEAL-005 (modelos OpenAI desmentidos por
evidência real ainda mapeados na allowlist). Classificado como POST_RELEASE_HARDENING — não é
CLOSURE_BLOCKER da V1 porque a allowlist estática já é, hoje, a ÚNICA autoridade de elegibilidade
de roteamento real (confirmado por leitura de `engineeringModelAvailabilityService.buildAvailableModels`),
e o fix mínimo aplicado (remover os modelIds desmentidos da allowlist) já fecha o RED real sem
depender deste item:
- **Catálogo governado (`EngineeringModelCatalogEntry`/`modelCatalogService`, ER-V1-FINAL-008) é
  write-only para fins de roteamento**: `reconcileDiscoveredModel` persiste
  DISCOVERED/APPROVED/RETIRED/DENIED para auditoria, e `isEligibleForRisk` existe e é testado,
  mas **nenhum código de produção lê o status persistido do catálogo para decidir elegibilidade**
  — `buildAvailableModels` decide elegibilidade SOMENTE a partir da allowlist estática
  (`modelCapabilities.js`) + `modelAvailabilityStore` (reativo, em memória, por processo) +
  `providerModelDiscoveryCache` (proativo, em memória, por processo). Um status `DENIED`
  persistido no catálogo (ex.: uma decisão humana de banir um modelo específico por
  segurança/compliance) hoje **não bloquearia** esse modelo de continuar sendo roteado, e um
  `RETIRED` persistido de uma sessão anterior é **esquecido a cada restart do processo** (o
  filtro reativo em memória reaprende do zero). Não há hoje nenhuma rota/mecanismo para um
  humano de fato setar `DENIED` (nenhum endpoint existe) — o estado é alcançável só via
  reconciliação automática, então o gap é teórico até que um mecanismo de decisão humana seja
  construído; mas se um `POST /engineering/model-catalog/:id/deny` (ou equivalente) for
  adicionado no futuro sem TAMBÉM conectar o catálogo como fonte de leitura em
  `buildAvailableModels`, a decisão de banimento seria completamente ignorada em produção.
  Missão própria deveria: (a) decidir se vale ter um endpoint de decisão humana; (b) SE sim,
  conectar `buildAvailableModels` para consultar `modelCatalogService.getCatalogEntry`/
  `listCatalogEntries` e excluir candidatos `DENIED`/`RETIRED` persistidos, mesmo sem discovery
  recente confirmando isso na memória do processo atual.
- **Vocabulário de estados do catálogo diverge nominalmente da spec desta missão** (projeto usa
  `UNCLASSIFIED`/`APPROVED`/`DENIED`; a spec de ER-V1-SEAL-005 pede
  `CLASSIFICATION_PENDING`/`ELIGIBLE`/`DISABLED`) — mantido como está nesta missão (puro
  vocabulário, sem mudança de comportamento, renomear é churn fora do escopo mínimo). Se uma
  missão futura decidir alinhar o vocabulário literal, fazer como rename mecânico isolado
  (migração de dado + constante + testes), nunca misturado com mudança de comportamento.
- `openai:gpt-5.4-mini` permanece mapeado sem confirmação real (nem positiva, nem negativa) de
  disponibilidade atual — nenhuma evidência refuta nem confirma. Uma missão de discovery real
  (com credencial OpenAI real disponível) poderia confirmar/reclassificar.

## Regra de promoção
Qualquer item desta lista só pode ser promovido a uma nova V-seguinte mediante nova missão com
seu próprio escopo congelado, backlog e critério de aceite — nunca por ampliação silenciosa da
V1 em andamento.
