# PBX / IVR

PBX and IVR cover extensions, trunks, routes, operator panel, ACLs, DIDs, queues, dialplan, media, recordings, CDR, governance and contact-center campaign subdomains.

## Canonical sources

- `docs/PBX_V1_INVENTORY.md`
- `docs/PBX_LEGACY_PORTING.md`
- `docs/PBX_PROVISIONING_GRANDSTREAM_AVAYA.md`
- `docs/ARCHITECTURE_CHANNEL_HEALTH_PHASE6.md`
- `api/modules/pbx/routes.js`
- `frontend/src/pages/PbxPage.impl.jsx`
- `frontend/src/pages/PbxRoutesPage.jsx`
- `pbx/asterisk/etc/asterisk/*`
- `scripts/test-pbx-call-events-runtime-smoke.js`
- `scripts/test-pbx-voice-tts-asr-smoke.js`

## Current governance warning

`docs/governance/PLATFORM_STATUS.md` identifies `pbx` as the blocking domain in canonical mesh. Any PBX change requires targeted smoke and mesh revalidation before release claims.

