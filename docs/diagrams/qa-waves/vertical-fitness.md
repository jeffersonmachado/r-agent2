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
    fitness_agendamento["⬜ agendamento\n0/1 aprovados"]
    v_fitness --> fitness_agendamento
    fitness_matricula_agendamento["⬜ Agendamento de Aula Experimental"]
    fitness_agendamento --> fitness_matricula_agendamento
    fitness_checkout["⬜ checkout\n0/1 aprovados"]
    v_fitness --> fitness_checkout
    fitness_matricula_checkout["⬜ Checkout e Pagamento de Matrícula"]
    fitness_checkout --> fitness_matricula_checkout
    fitness_onboarding["⬜ onboarding\n0/1 aprovados"]
    v_fitness --> fitness_onboarding
    fitness_matricula_onboarding["⬜ Onboarding do Novo Aluno"]
    fitness_onboarding --> fitness_matricula_onboarding
    fitness_checkin["⬜ checkin\n0/1 aprovados"]
    v_fitness --> fitness_checkin
    fitness_matricula_checkin["⬜ Check-in Diário na Academia"]
    fitness_checkin --> fitness_matricula_checkin
    fitness_renovacao["⬜ renovacao\n0/1 aprovados"]
    v_fitness --> fitness_renovacao
    fitness_matricula_renovacao["⬜ Renovação de Matrícula"]
    fitness_renovacao --> fitness_matricula_renovacao
    fitness_cancelamento["⬜ cancelamento\n0/1 aprovados"]
    v_fitness --> fitness_cancelamento
    fitness_matricula_cancelamento["⬜ Cancelamento de Matrícula"]
    fitness_cancelamento --> fitness_matricula_cancelamento
    fitness_fitness_customer_checkin["⬜ fitness_customer_checkin\n0/12 aprovados"]
    v_fitness --> fitness_fitness_customer_checkin
    business_e2e_fitness_customer_checkin["⬜ Check-in Completo de Aluno Fitness"]
    fitness_fitness_customer_checkin --> business_e2e_fitness_customer_checkin
    cap_customer_identification["⬜ Validação: Customer Identification"]
    fitness_fitness_customer_checkin --> cap_customer_identification
    cap_membership_validation["⬜ Validação: Membership Validation"]
    fitness_fitness_customer_checkin --> cap_membership_validation
    cap_access_decision["⬜ Validação: Access Decision"]
    fitness_fitness_customer_checkin --> cap_access_decision
    cap_turnstile_release["⬜ Validação: Turnstile Release"]
    fitness_fitness_customer_checkin --> cap_turnstile_release
    cap_attendance_record["⬜ Validação: Attendance Record"]
    fitness_fitness_customer_checkin --> cap_attendance_record
    cap_crm_update["⬜ Validação: Crm Update"]
    fitness_fitness_customer_checkin --> cap_crm_update
    precond_fitness_customer_checkin_crm_contact_exists["⬜ Precondição: Crm Contact Exists"]
    fitness_fitness_customer_checkin --> precond_fitness_customer_checkin_crm_contact_exists
    precond_fitness_customer_checkin_membership_exists["⬜ Precondição: Membership Exists"]
    fitness_fitness_customer_checkin --> precond_fitness_customer_checkin_membership_exists
    precond_fitness_customer_checkin_credential_exists["⬜ Precondição: Credential Exists"]
    fitness_fitness_customer_checkin --> precond_fitness_customer_checkin_credential_exists
    precond_fitness_customer_checkin_device_available["⬜ Precondição: Device Available"]
    fitness_fitness_customer_checkin --> precond_fitness_customer_checkin_device_available
    precond_fitness_customer_checkin_attendance_database_accessible["⬜ Precondição: Attendance Database Accessible"]
    fitness_fitness_customer_checkin --> precond_fitness_customer_checkin_attendance_database_accessible

```