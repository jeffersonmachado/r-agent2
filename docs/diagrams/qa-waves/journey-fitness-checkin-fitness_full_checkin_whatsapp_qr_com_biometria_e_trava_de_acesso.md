---
title: fitness/checkin — Check-in completo via WhatsApp com QR dinâmico, validação de biometria na catraca e liberação de acesso (alto risco)
---

```mermaid
flowchart LR
    step_001["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_002{"validate_intent\n📡 whatsapp\n⚙ aiIntentService"}
    step_003["provide_data\n📡 whatsapp\n⚙ whatsapp"]
    step_004["validate_backend\n📡 whatsapp\n⚙ api"]
    step_005["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_006["trigger_channel_event\n📡 whatsapp\n⚙ whatsapp"]
    step_007["validate_context\n📡 whatsapp\n⚙ ragService"]
    step_008("wait_for_event\n📡 whatsapp\n⚙ eventMesh")
    step_009["validate_backend\n📡 whatsapp\n⚙ api"]
    step_010["validate_access_release\n📡 whatsapp\n⚙ accessControlService"]
    step_011["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_012["validate_sla\n📡 whatsapp\n⚙ meshValidator"]
    step_013["send_message\n📡 whatsapp\n⚙ whatsapp"]
    step_014["validate_backend\n📡 whatsapp\n⚙ api"]
    step_015["validate_response\n📡 whatsapp\n⚙ semanticValidator"]
    step_016["validate_fallback\n📡 whatsapp\n⚙ api"]
    step_001 -->| "Sistema identifica intenção de realizar check-in para ent..." | step_002
    step_002 -->| "Sistema solicita e o cliente confirma dados mínimos para ..." | step_003
    step_003 -->| "Sistema valida no backend: matrícula ativa, plano vigente..." | step_004
    step_004 -->| "Sistema informa status da elegibilidade e orienta que ser..." | step_005
    step_005 -->| "Sistema envia no WhatsApp um QR dinâmico (ou link seguro)..." | step_006
    step_006 -->| "Sistema mantém contexto de sessão (membro, unidade, inten..." | step_007
    step_007 -->| "Sistema aguarda evento de leitura do QR na catraca/contro..." | step_008
    step_008 -->| "Ao receber evento de leitura, sistema valida: token válid..." | step_009
    step_009 -->| "Sistema aciona liberação da catraca quando a validação fo..." | step_010
    step_010 -->| "Sistema confirma no WhatsApp o check-in concluído com suc..." | step_011
    step_011 -->| "Tempo total entre emissão do QR e confirmação de check-in..." | step_012
    step_012 -->| "Cliente tenta reutilizar o mesmo QR imediatamente após en..." | step_013
    step_013 -->| "Sistema detecta tentativa de reutilização (token já consu..." | step_014
    step_014 -->| "Sistema responde no WhatsApp que o QR é de uso único e já..." | step_015
    step_015 -->| "Se houver falha na integração com controle de acesso, sis..." | step_016

```

- **Status**: active
- **Canais**: whatsapp, chat, api
- **Risco**: critical
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true