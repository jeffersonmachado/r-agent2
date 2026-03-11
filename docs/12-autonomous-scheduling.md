# Autonomous Scheduling

## Papel na plataforma

`Autonomous Scheduling` é o primeiro domínio completo de **Closed-Loop Autonomous Operations** implementado no projeto.

## Fluxo de referência

```text
booking.cancelled
↓
gap detection
↓
candidate ranking
↓
campaign invite
↓
booking confirmed
```

## Leitura pela arquitetura

- `Observe`: `booking.cancelled`
- `Project State`: detecção do gap e projeção da agenda
- `Decide`: ranking de candidatos e escolha de estratégia
- `Execute`: campanha, convite, oferta ou reativação
- `Learn`: confirmação ou falha do booking e aprendizado operacional

## Componentes envolvidos

- `GapDetectionService`
- `AutonomousCampaignService`
- `WaitingListService`
- `AutonomousRuntimeService`
- `VerticalTemplateRegistry`

## Por que este domínio é importante

Ele demonstra, de forma concreta, que o projeto já não é apenas um runtime de automação. Ele já fecha um loop operacional orientado a resultado.
