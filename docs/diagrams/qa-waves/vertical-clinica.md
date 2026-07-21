---
title: CLINICA — Mapa de Jornadas QA Waves
---

```mermaid
flowchart TD
    v_clinica["CLINICA"]
    clinica_clinic_default_journey["✅ clinic_default_journey\n1/1 aprovados"]
    v_clinica --> clinica_clinic_default_journey
    clinic_ticket_manutencao["✅ Clinic abertura e resolução de ticket de manutenção"]
    clinica_clinic_default_journey --> clinic_ticket_manutencao

```