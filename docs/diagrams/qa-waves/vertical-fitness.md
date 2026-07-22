---
title: FITNESS — Mapa de Jornadas QA Waves
---

```mermaid
flowchart TD
    v_fitness["FITNESS"]
    fitness_leads["✅ leads\n1/1 aprovados"]
    v_fitness --> fitness_leads
    fitness_matricula_leads["✅ Captação de Lead via WhatsApp"]
    fitness_leads --> fitness_matricula_leads
    fitness_agendamento["⬜ agendamento\n0/3 aprovados"]
    v_fitness --> fitness_agendamento
    fitness_matricula_agendamento["⬜ Agendamento de Aula Experimental"]
    fitness_agendamento --> fitness_matricula_agendamento
    fitness_full_agendamento_whatsapp_e2e_pagamento_confirmacao["⬜ E2E no WhatsApp: agendar aula (pilates) com escolha de unidade, checagem de elegibilidade, pagamento e confirmação com política de cancelamento"]
    fitness_agendamento --> fitness_full_agendamento_whatsapp_e2e_pagamento_confirmacao
    fitness_full_agendamento_avaliacao_e_pagamento_whatsapp["⬜ WhatsApp: agendar avaliação física com personal, validar disponibilidade, pagamento antecipado e confirmação com política de cancelamento"]
    fitness_agendamento --> fitness_full_agendamento_avaliacao_e_pagamento_whatsapp
    fitness_checkout["⬜ checkout\n0/4 aprovados"]
    v_fitness --> fitness_checkout
    fitness_matricula_checkout["⬜ Checkout e Pagamento de Matrícula"]
    fitness_checkout --> fitness_matricula_checkout
    fitness_full_whatsapp_checkout_pix_confirmacao_e2e["⬜ WhatsApp: checkout completo de plano mensal com PIX e confirmação de matrícula (E2E) para academia"]
    fitness_checkout --> fitness_full_whatsapp_checkout_pix_confirmacao_e2e
    fitness_full_whatsapp_checkout_pix_aprovacao_pospagamento["⬜ Checkout end-to-end no WhatsApp: compra de plano mensal + matrícula, pagamento via Pix, aprovação e liberação imediata de acesso"]
    fitness_checkout --> fitness_full_whatsapp_checkout_pix_aprovacao_pospagamento
    fitness_full_whatsapp_checkout_pix_aprovacao_e2e["⬜ WhatsApp checkout completo: compra de plano mensal com cupom, PIX, aprovação e liberação imediata de acesso no app"]
    fitness_checkout --> fitness_full_whatsapp_checkout_pix_aprovacao_e2e
    fitness_onboarding["⬜ onboarding\n0/2 aprovados"]
    v_fitness --> fitness_onboarding
    fitness_matricula_onboarding["⬜ Onboarding do Novo Aluno"]
    fitness_onboarding --> fitness_matricula_onboarding
    fitness_full_onboarding_whatsapp_primeiro_acesso_e2e["⬜ [Manual] Onboarding de novo aluno via WhatsApp — primeiro acesso completo"]
    fitness_onboarding --> fitness_full_onboarding_whatsapp_primeiro_acesso_e2e
    fitness_checkin["⬜ checkin\n0/3 aprovados"]
    v_fitness --> fitness_checkin
    fitness_matricula_checkin["⬜ Check-in Diário na Academia"]
    fitness_checkin --> fitness_matricula_checkin
    fitness_full_checkin_sem_reserva_com_pagamento_pendente_whatsapp["⬜ Check-in via WhatsApp sem reserva ativa e com pagamento pendente: orientar, bloquear entrada e oferecer regularização"]
    fitness_checkin --> fitness_full_checkin_sem_reserva_com_pagamento_pendente_whatsapp
    fitness_full_checkin_whatsapp_qr_com_biometria_e_trava_de_acesso["⬜ Check-in completo via WhatsApp com QR dinâmico, validação de biometria na catraca e liberação de acesso (alto risco)"]
    fitness_checkin --> fitness_full_checkin_whatsapp_qr_com_biometria_e_trava_de_acesso
    fitness_renovacao["⬜ renovacao\n0/3 aprovados"]
    v_fitness --> fitness_renovacao
    fitness_matricula_renovacao["⬜ Renovação de Matrícula"]
    fitness_renovacao --> fitness_matricula_renovacao
    fitness_full_renovacao_whatsapp_pagamento_falha_recuperacao["⬜ Renovação de plano via WhatsApp com falha de pagamento no cartão, recuperação com PIX e confirmação de renovação sem duplicidade"]
    fitness_renovacao --> fitness_full_renovacao_whatsapp_pagamento_falha_recuperacao
    fitness_full_renovacao_whatsapp_plano_anual_cartao_expirado_com_recuperacao["⬜ Renovação E2E via WhatsApp de plano anual com cartão expirado, oferta de atualização de pagamento e confirmação de renovação sem duplicidade de cobrança"]
    fitness_renovacao --> fitness_full_renovacao_whatsapp_plano_anual_cartao_expirado_com_recuperacao
    fitness_cancelamento["⬜ cancelamento\n0/3 aprovados"]
    v_fitness --> fitness_cancelamento
    fitness_matricula_cancelamento["⬜ Cancelamento de Matrícula"]
    fitness_cancelamento --> fitness_matricula_cancelamento
    fitness_full_cancelamento_assinatura_whatsapp_retentativa["⬜ Cancelamento E2E via WhatsApp com retenção, confirmação de identidade, efetivação imediata e liberação de acesso (alto risco)"]
    fitness_cancelamento --> fitness_full_cancelamento_assinatura_whatsapp_retentativa
    fitness_full_cancelamento_plano_whatsapp_e2e_reembolso_acesso["⬜ WhatsApp: cancelamento E2E de plano anual com cobrança recente, confirmação de identidade, cálculo de reembolso e bloqueio de acesso"]
    fitness_cancelamento --> fitness_full_cancelamento_plano_whatsapp_e2e_reembolso_acesso
    fitness_fitness_customer_checkin["✅ fitness_customer_checkin\n12/12 aprovados"]
    v_fitness --> fitness_fitness_customer_checkin
    business_e2e_fitness_customer_checkin["✅ Check-in Completo de Aluno Fitness"]
    fitness_fitness_customer_checkin --> business_e2e_fitness_customer_checkin
    cap_customer_identification["✅ Validação: Customer Identification"]
    fitness_fitness_customer_checkin --> cap_customer_identification
    cap_membership_validation["✅ Validação: Membership Validation"]
    fitness_fitness_customer_checkin --> cap_membership_validation
    cap_access_decision["✅ Validação: Access Decision"]
    fitness_fitness_customer_checkin --> cap_access_decision
    cap_turnstile_release["✅ Validação: Turnstile Release"]
    fitness_fitness_customer_checkin --> cap_turnstile_release
    cap_attendance_record["✅ Validação: Attendance Record"]
    fitness_fitness_customer_checkin --> cap_attendance_record
    cap_crm_update["✅ Validação: Crm Update"]
    fitness_fitness_customer_checkin --> cap_crm_update
    precond_fitness_customer_checkin_crm_contact_exists["✅ Precondição: Crm Contact Exists"]
    fitness_fitness_customer_checkin --> precond_fitness_customer_checkin_crm_contact_exists
    precond_fitness_customer_checkin_membership_exists["✅ Precondição: Membership Exists"]
    fitness_fitness_customer_checkin --> precond_fitness_customer_checkin_membership_exists
    precond_fitness_customer_checkin_credential_exists["✅ Precondição: Credential Exists"]
    fitness_fitness_customer_checkin --> precond_fitness_customer_checkin_credential_exists
    precond_fitness_customer_checkin_device_available["✅ Precondição: Device Available"]
    fitness_fitness_customer_checkin --> precond_fitness_customer_checkin_device_available
    precond_fitness_customer_checkin_attendance_database_accessible["✅ Precondição: Attendance Database Accessible"]
    fitness_fitness_customer_checkin --> precond_fitness_customer_checkin_attendance_database_accessible

```