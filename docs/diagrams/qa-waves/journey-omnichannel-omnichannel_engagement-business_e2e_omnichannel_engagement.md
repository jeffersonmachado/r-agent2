---
title: omnichannel/omnichannel_engagement — Engajamento Omnichannel Completo
---

```mermaid
flowchart LR
    step_omnichannel_engagement_001["trigger_channel_event\n⚙ api"]
    step_omnichannel_engagement_002{"validate_intent\n⚙ api"}
    step_omnichannel_engagement_003["send_message\n⚙ api"]
    step_omnichannel_engagement_004["send_message\n⚙ api"]
    step_omnichannel_engagement_005["validate_flow_transition\n⚙ api"]
    step_omnichannel_engagement_001 -->| "intentDetected, handoffSuggested" | step_omnichannel_engagement_002
    step_omnichannel_engagement_002 -->| "transferInitiated, queueAssigned" | step_omnichannel_engagement_003
    step_omnichannel_engagement_003 -->| "agentConnected, conversationActive" | step_omnichannel_engagement_004
    step_omnichannel_engagement_004 -->| "historyIntact, allChannelsLinked, crmUpdated" | step_omnichannel_engagement_005

```

- **Status**: draft_ai
- **Canais**: whatsapp, webchat, pbx, email
- **Risco**: high
- **Pré-condições**: nenhuma
- **Validações**: replay=true, backend=true