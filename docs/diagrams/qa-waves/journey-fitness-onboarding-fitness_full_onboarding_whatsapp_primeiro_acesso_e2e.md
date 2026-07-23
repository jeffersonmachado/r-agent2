---
title: fitness/onboarding — [Manual] Onboarding de novo aluno via WhatsApp — primeiro acesso completo
---

```mermaid
flowchart LR
    step_001["trigger_channel_event\n📡 whatsapp\n⚙ whatsapp"]
    step_002["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_003{"validate_intent\n📡 whatsapp\n⚙ aiIntentService"}
    step_004["provide_data\n📡 whatsapp\n⚙ whatsapp"]
    step_005["validate_backend\n📡 whatsapp\n⚙ api"]
    step_006["validate_context\n📡 whatsapp\n⚙ ragService"]
    step_007["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_008["provide_data\n📡 whatsapp\n⚙ whatsapp"]
    step_009["check_availability\n📡 whatsapp\n⚙ schedulingService"]
    step_010["select_slot\n📡 whatsapp\n⚙ schedulingService"]
    step_011["create_booking\n📡 whatsapp\n⚙ schedulingService"]
    step_012["validate_backend\n📡 whatsapp\n⚙ api"]
    step_013["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_014["validate_access_release\n📡 whatsapp\n⚙ accessControlService"]
    step_015["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_016["validate_sla\n📡 whatsapp\n⚙ meshValidator"]
    step_017["validate_flow_transition\n📡 whatsapp\n⚙ flowEngine"]
    step_018["validate_fallback\n📡 whatsapp\n⚙ api"]
    step_001 -->| "Aluno informa que acabou de se matricular e quer entender..." | step_002
    step_002 -->| "Assistente identifica intenção de onboarding de novo alun..." | step_003
    step_003 -->| "Aluno informa nome completo e CPF para localizar a matríc..." | step_004
    step_004 -->| "Sistema localiza matrícula ativa no CRM e confirma plano ..." | step_005
    step_005 -->| "Contexto do aluno carregado: plano, unidade, data de iníc..." | step_006
    step_006 -->| "Assistente apresenta visão geral: app, horários, modalida..." | step_007
    step_007 -->| "Aluno escolhe modalidade de interesse (ex.: musculação) e..." | step_008
    step_008 -->| "Sistema verifica disponibilidade de avaliação física inic..." | step_009
    step_009 -->| "Aluno seleciona slot para avaliação física inicial entre ..." | step_010
    step_010 -->| "Agendamento da avaliação física inicial é criado e confir..." | step_011
    step_011 -->| "Agendamento persistido na agenda da unidade e vínculo alu..." | step_012
    step_012 -->| "Assistente envia confirmação com data/hora, orientações (..." | step_013
    step_013 -->| "Acesso do aluno à catraca liberado a partir da data de in..." | step_014
    step_014 -->| "Aluno confirma recebimento das orientações e do agendamento." | step_015
    step_015 -->| "Fluxo completo de onboarding concluído dentro do SLA de a..." | step_016
    step_016 -->| "Transição de estado onboarding → aluno_ativo registrada c..." | step_017
    step_017 -->| "Em caso de dúvida fora do fluxo, assistente aplica fallba..." | step_018

```

- **Status**: active
- **Canais**: whatsapp, chat, api
- **Risco**: high
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true