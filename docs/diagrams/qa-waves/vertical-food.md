---
title: FOOD — Mapa de Jornadas QA Waves
---

```mermaid
flowchart TD
    v_food["FOOD"]
    food_food_order_flow["✅ food_order_flow\n1/1 aprovados"]
    v_food --> food_food_order_flow
    food_pedido_whatsapp["✅ Food pedido via WhatsApp até confirmação"]
    food_food_order_flow --> food_pedido_whatsapp

```