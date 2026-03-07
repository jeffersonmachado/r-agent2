# Roadmap consolidado — r-agent2

## Visão

O r-agent2 evolui de plataforma de atendimento para **Customer Operating System (COS)** / **Plataforma de Operações Autônomas para negócios de serviços**.

## Pilares

1. Automation Platform
2. CRM Operacional Integrado
3. Contact Center Omnichannel
4. Scheduling
5. Autonomous Operations
6. Predictive Operations
7. Revenue Engine
8. Physical Channels (Kiosk)
9. Vertical Templates

## Benchmarks por pilar

- Automação: n8n, LangFlow, Flowise
- CRM/Marketing: HubSpot, RD Station
- Atendimento: Zendesk, Blip, Huggy
- Scheduling: Calendly, Fresha
- Autonomous Operations: Mindbody, Fresha (referência parcial)
- Kiosk/Queue: Qminder, QLess, Waitwhile, McDonald's (UX)
- Food: iFood, Uber Eats, Rappi, DoorDash
- Field Service: Housecall Pro, Jobber

## Verticais oficiais

- Beauty
- Fitness
- Food
- Prestadores de Serviços
- Services (consultoria, clínica, etc.)

## Próximas fases

### Fase 1 — Runtime operacional do core
- `autonomous_runtime`
- feature flags por tenant
- quiet hours
- limites por rodada
- segurança de execução

### Fase 2 — Predictive Operations
- idle risk
- no-show risk
- fill probability
- recomendações preventivas

### Fase 3 — Revenue Engine
- revenue opportunities
- reactivation
- upsell / cross-sell
- pricing optimization leve

### Fase 4 — Kiosk / Smart Lobby
- check-in
- fila
- autoatendimento
- agendamento imediato
- integração com agenda autônoma

### Fase 5 — Vertical templates robustos
- beauty
- fitness
- food
- services

## Próximo passo recomendado

Implementar o **runtime operacional por tenant** e a **camada de métricas operacionais agregadas**, porque esses dois blocos sustentam previsão, automação recorrente, revenue engine e kiosks.
