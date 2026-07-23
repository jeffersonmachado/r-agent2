---
title: omnichannel/omnichannel_engagement — Engajamento Omnichannel Completo
---

```mermaid
flowchart LR
    step_omnichannel_engagement_001["trigger_channel_event\n📡 whatsapp\n⚙ api"]
    step_omnichannel_engagement_002{"validate_intent\n📡 whatsapp\n⚙ api"}
    step_omnichannel_engagement_003["send_message\n📡 whatsapp\n⚙ api"]
    step_omnichannel_engagement_004["send_message\n📡 whatsapp\n⚙ api"]
    step_omnichannel_engagement_005["validate_flow_transition\n📡 whatsapp\n⚙ api"]
    step_omnichannel_engagement_006["validate_backend\n📡 whatsapp\n⚙ api"]
    step_omnichannel_engagement_001 -->| "intentDetected, handoffSuggested" | step_omnichannel_engagement_002
    step_omnichannel_engagement_002 -->| "transferInitiated, queueAssigned" | step_omnichannel_engagement_003
    step_omnichannel_engagement_003 -->| "agentConnected, conversationActive" | step_omnichannel_engagement_004
    step_omnichannel_engagement_004 -->| "historyIntact, allChannelsLinked, crmUpdated" | step_omnichannel_engagement_005
    step_omnichannel_engagement_005 -->| "backendEntity, conversationUpdated, mutation_recorded" | step_omnichannel_engagement_006

```

- **Status**: approved
- **Canais**: whatsapp, pbx
- **Risco**: high
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true