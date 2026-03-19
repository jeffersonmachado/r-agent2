# Access Control

## Objetivo

Implementar um módulo horizontal de controle de acesso físico no `r-agent2` como parte da plataforma unificada de processos, comunicação e operação, sem tratar hardware como fonte de verdade e sem criar um silo paralelo à arquitetura canônica.

## Alinhamento com a arquitetura do r-agent2

- Multi-tenant real: persistência isolada por `tenant_key` no padrão atual do projeto, com `tenant_id` tratado como requisito lógico de domínio.
- Event model canônico: decisões e eventos de acesso entram como trilha operacional auditável.
- Backend decide, dispositivo executa: biometria/QR/RFID/PIN/mobile resolvem credencial e identidade, mas a autorização final vem do decision engine.
- Incremental: o módulo convive com biometria existente, `physicalPublicRoutes`, kiosk e filas físicas sem reescrever os fluxos já estáveis.

## Observe -> Project State -> Decide -> Execute -> Learn

1. Observe: credencial, device, subject, membership, billing, agenda e contexto operacional são observados.
2. Project State: o backend projeta o estado de acesso com subject, membership, policy, unidade, horário e anti-passback.
3. Decide: o `AccessDecision` emite `allow` ou `deny` com `reason_code`, TTL curto e assinatura.
4. Execute: o dispositivo físico ou canal operacional executa a decisão já calculada.
5. Learn: `AccessEvent` e `AccessDecision` ficam disponíveis para analytics, auditoria, operação e integração futura com runtime/process intelligence.

## Benchmark funcional e arquitetural

- Tecnofit: benchmark principal para controle de acesso fitness com billing e unidades.
- EVO / W12 / ABC Evo: benchmark de operação de academia, membership e presença.
- Wellhub / Gympass: benchmark de elegibilidade e identidade federada.
- Pacto: benchmark observacional ainda pendente de validação pública mais forte.

## Entidades implementadas

- `AccessSubject`
- `AccessMembership`
- `AccessCredential`
- `AccessPolicy`
- `AccessDevice`
- `AccessDecision`
- `AccessEvent`

## Subdomínios canônicos do módulo

- `devices`: cadastro e operação lógica de catracas, portas, leitores e totens
- `credentials`: biometria, QR, RFID, PIN e mobile
- `policies`: regras horizontais por vertical, horário, unidade e perfil
- `decisions`: resolução centralizada de autorização
- `events`: trilha operacional e auditável
- `integrations`: envelopes/adapters para vendors e modos de execução
- `visitor-access`: QR temporário e fluxo de visitante
- `anti-passback`: política física de reentrada/saída

## Fluxo de decisão

Ordem mínima do engine:

1. Resolver credencial
2. Identificar `subject`
3. Validar vínculo e status do subject
4. Validar membership quando necessário
5. Validar `billing_status`
6. Validar janela de horário
7. Validar unidade/escopo
8. Validar anti-passback
9. Validar limite diário
10. Emitir `AccessDecision`
11. Registrar `AccessEvent`
12. Reconciliar execução (`pending` / `executed` / `failed` / `expired`) a partir de `device_callback` e eventos operacionais
13. Classificar pendências críticas (`pending_critical`) quando a decisão envelhece sem confirmação de hardware

## Biometria

- O fluxo existente continua válido para captura e resolução da biometria.
- A semântica foi endurecida: biometria não libera acesso por si só.
- O valor biométrico pode resolver a credencial/identidade, mas a autorização final precisa passar pelo decision engine.

## QR temporário

- Visitor QR e QR dinâmico usam payload assinado com expiração curta.
- O QR resolve para `credential_id` e `subject_id`, mantendo separação entre identificação e autorização.
- A primeira fase usa SVG leve gerado no backend para operação MVP sem dependência pesada adicional.

## Integração pública controlada para devices

- `PublicAccessToken` passa a suportar o kind `access_control` para leitores, catracas, portas e gateways operacionais.
- `POST /physical/access/resolve?token=...` permite que o device envie credencial/biometria/QR e receba uma `AccessDecision` curta, assinada e expirável.
- Quando o `device` é conhecido, a resposta já inclui `execution_command` canônico para o vendor ou modo genérico de execução.
- `POST /physical/access/events?token=...` permite registrar a execução operacional do device sem abrir bypass de tenant.
- `POST /physical/access/ack?token=...` permite que o hardware confirme a execução do comando emitido, registrando `device_callback` auditável.
- `GET /api/access-control/decisions/:id/status` expõe o status reconciliado da decisão para operação, auditoria e troubleshooting.
- `GET /api/access-control/decisions` pode devolver `items + summary` com `execution_status` e `pending_critical`, permitindo triagem operacional sem N+1 no frontend.
- a listagem também aceita filtro `pending_critical_only=true` para foco direto em decisões que exigem follow-up imediato.
- a UI preserva filtros principais de decisões na query string, facilitando retomada e compartilhamento de contexto operacional.
- `GET /api/access-control/health` expõe snapshot operacional do módulo com threshold base configurável e reconciliação `policy/device-aware`.
- O threshold de `pending_critical` pode vir de:
  - `AccessPolicy.metadata.pending_critical_age_ms`
  - `AccessPolicy.metadata.pending_critical_age_by_unit[unitId]`
  - `AccessPolicy.grace_policy.pending_critical_age_ms`
  - `AccessDevice.metadata.pending_critical_age_ms`
  - variável de ambiente `ACCESS_CONTROL_PENDING_CRITICAL_AGE_MS` como fallback global
- O token público pode ser vinculado a `deviceId` via `meta`, impedindo que um hardware use o token de outro ponto físico.
- A borda pública continua fina: autentica o device, aplica rate limit, injeta contexto e delega a autorização ao decision engine.

## Fitness obrigatório

Fitness é o primeiro vertical profile operacional:

- plano ativo
- grace period
- bloqueio por inadimplência
- política por horário
- unidade permitida
- anti-passback
- visitante experimental por QR
- trilha de entrada/saída
- **auto-criação de `VerticalAttendance` a cada `allow` (fire-and-forget via `fitnessAttendanceService.recordCheckIn`)**
- **auto-fechamento de attendance em ação `exit`/`leave` via `recordCheckOut`**

## Beauty opcional

Beauty entra por profile/policy:

- acesso por agendamento válido
- janela de atendimento
- regras avançadas por sala/recurso/profissional via `beautyPolicyRules.validateBeautyPolicyRules`
  - `policy.metadata.room_ids`: lista de salas permitidas
  - `policy.metadata.resource_ids`: lista de recursos permitidos
  - `policy.metadata.professional_ids`: lista de profissionais permitidos
  - `policy.metadata.require_appointment`: exige agendamento ativo
  - `policy.metadata.require_active_bundle`: exige pacote/sessão disponível
  - tolerância de janela via `policy.metadata.appointment_window_tolerance_ms`
- QR temporário opcional

## Beauty – Jornada do cliente

O módulo `api/services/vertical/beautyJourneyService.js` orquestra a jornada completa:

```
confirmation_sent → confirmation_received → reminder_24h → reminder_1h
→ [allow decision]
→ service_completed (auto-deduct session + LoyaltyPointsGranted ledger)
→ follow_up_sent → review_requested
→ [inactive] → reactivation_sent
→ [no show] → no_show_detected → rescheduling_offered
```

### APIs Beauty

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/beauty/journey/:subjectId` | Timeline do cliente |
| POST | `/api/beauty/journey/event` | Emitir evento de jornada |
| GET | `/api/beauty/reminders/:subjectId` | Histórico de lembretes |
| GET | `/api/beauty/no-show-risk/:subjectId` | Score de risco de no-show |
| GET | `/api/beauty/bundle/:subjectId` | Saldo de sessões |
| POST | `/api/beauty/bundle` | Criar pacote de sessões |
| POST | `/api/beauty/service-completed` | Registrar serviço realizado |
| POST | `/api/beauty/no-show` | Detectar no-show |
| GET | `/api/beauty/metrics` | KPIs do vertical |
| GET | `/api/beauty/recommendations/:subjectId` | Recomendações IA/heurística |

## Fitness – Jornada e memberships

O módulo `api/services/vertical/fitnessMembershipService.js` gerencia o ciclo de vida:

```
active → grace_period → delinquent → blocked → cancelled → [reactivation] → active
```

Assiduidade rastreada por `api/services/vertical/fitnessAttendanceService.js`:

- Cada `allow` cria um `VerticalAttendance` (status=open)
- Cada `exit`/`leave` fecha o registro (status=completed, duration computada)
- No-show marcado manualmente (status=absent)

### APIs Fitness

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/fitness/subject/:subjectId/attendance` | Histórico + frequência |
| POST | `/api/fitness/attendance/check-in` | Check-in manual |
| POST | `/api/fitness/attendance/check-out` | Check-out manual |
| GET | `/api/fitness/membership/:membershipId` | Detalhe da membership |
| PATCH | `/api/fitness/membership/:membershipId/billing` | Atualizar billing status |
| PATCH | `/api/fitness/membership/:membershipId/details` | Atualizar datas/plano |
| POST | `/api/fitness/membership/:membershipId/grace-period` | Iniciar período de graça |
| POST | `/api/fitness/membership/:membershipId/renew` | Processar renovação |
| GET | `/api/fitness/subject/:subjectId/access-status` | Elegibilidade de acesso |
| GET | `/api/fitness/subject/:subjectId/churn-risk` | Score de risco de churn |
| GET | `/api/fitness/subject/:subjectId/timeline` | Timeline operacional |
| GET | `/api/fitness/metrics` | KPIs do vertical |
| GET | `/api/fitness/memberships` | Listar memberships |
| POST | `/api/fitness/journey/event` | Emitir evento de jornada |
| GET | `/api/fitness/attendance/open` | Attendances abertas |

## Roadmap incremental

Fase atual (Beauty + Fitness v1 vendável):

- núcleo canônico
- CRUD de devices/credentials/policies/events
- decision engine centralizado
- membership mínima isolada
- visitor QR
- UI operacional mínima
- decisão -> comando -> ack -> status reconciliado
- listagem reconciliada de decisões com resumo operacional
- pendência crítica destacada para follow-up operacional
- snapshot de saúde operacional para triagem rápida
- threshold de criticidade configurável por policy/unidade/device sem migration extra
- **jornada do cliente Beauty completa (confirmação/lembrete/no-show/pós-serviço/reativação)**
- **jornada do cliente Fitness completa (welcome/frequência/churn/bloqueio/renovação)**
- **auto-attendance Fitness no access decision**
- **regras avançadas de policy Beauty (sala/recurso/profissional)**
- **engine de engajamento e detecção de churn**
- **engine de métricas verticais (KPIs)**
- **serviço de recomendações heurísticas (pluggable ML)**

Próximas fases:

- callbacks de execução/ack mais ricos por vendor
- override operacional formal para delinquent
- dashboards analíticos dedicados
- adapters explícitos para Control iD, ZKTeco e parceiros
- integração com PSP real (Stripe/Pagar.me) para billing automático
