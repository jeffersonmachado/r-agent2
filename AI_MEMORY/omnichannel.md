# Omnichannel

Omnichannel covers support, inbox, WhatsApp/channel accounts, channel health, handoff, tickets and outbound/inbound message flows.

## Canonical sources

- `docs/ARCHITECTURE_OMNICHANNEL_GATEWAY.md`
- `docs/ARCHITECTURE_HANDOVER_BOT_HUMAN.md`
- `docs/BLIP_GAP_ANALYSIS.md`
- `docs/OPERACAO_PRODUCAO.md`
- `api/modules/channel-webhook/*`
- `api/modules/platform-admin/handleChannelAccountRoutes.js`
- `api/modules/inbox/routes.js`
- `api/modules/ticket/routes.js`
- `frontend/src/pages/SupportPage.jsx`
- `frontend/src/pages/ChannelHealthPage.jsx`
- `frontend/src/pages/ChannelAccountsPage.jsx`

## Runtime notes

Browser validation confirmed `/support` and `/channel-health` render authenticated. Direct navigation to `/channel-accounts` returned a backend 401 JSON response in the observed environment, despite being listed as a frontend route/menu item. Treat this as a runtime routing/proxy gap until revalidated.

