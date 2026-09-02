# Replay Operational Status

- Prod-like journeys with replay evidence: support_ticket_flow, fitness_customer_checkin, booking_flow, payment_charge_flow, food_order_status_flow, bakery_encomenda_flow, market_node_publish_flow, clinic_calendar_block_flow, agendamento
- Replay coverage percent: 100%
- Required operational proof: WhatsApp -> AI -> ticket/handoff -> human -> backend mutation -> chronological replay

## Current state
- Support and fitness prod-like replays are valid and signed.
- No prod-like proof exists for a full WhatsApp -> AI -> handoff -> human -> backend mutation chronology.
- Replay evidence is still uneven across required verticals.
