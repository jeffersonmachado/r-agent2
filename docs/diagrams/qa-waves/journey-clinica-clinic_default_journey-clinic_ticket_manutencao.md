---
title: clinica/clinic_default_journey — Clinic abertura e resolução de ticket de manutenção
---

```mermaid
flowchart LR
    step_clinic_001["Ticket de manutenção criado\n📡 ticket\n⚙ api"]
    step_clinic_002["Ticket resolvido com SLA\n⚙ api"]
    step_clinic_001 -->| "backendEntity, withinSla" | step_clinic_002

```

- **Status**: approved
- **Canais**: ticket
- **Risco**: high
- **Pré-condições**: Operação autenticada; Módulo de manutenção ativo
- **Validações**: replay=true, backend=true