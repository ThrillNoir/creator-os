# THOT OS

THOT OS is a Cloudflare-native, human-approved creator operations system.

## Canonical runtime

- `cloudflare/thot-os-next` is the web application deployed as the `thot-os-staging` Worker.
- D1 is authoritative for creator, asset, approval, scheduling, publishing, and operational state.
- Private source media is uploaded from the browser directly into creator-scoped R2 objects. Verified D1 assets reference those objects through `media_r2_key`.
- Private previews are generated with Cloudflare Images, stored in R2, and shown through creator-scoped authenticated routes.
- Reddit Scheduler, Instagram Scheduler, Telegram Bridge, the preview queues, and the Fansly browser bridge remain independent publishing/delivery services. Task completion never implies provider publication.

The legacy root SQLite application and its local gateway, schedulers, indexers, and publishing implementations are retired. Historical D1 migrations remain in `cloudflare/thot-os-app/migrations`.

## Development

```bash
npm ci
npm --prefix cloudflare/thot-os-next ci
npm run dev
```

## Verification

```bash
npm run lint
npm test
npm run build
npm run verify:cloudflare
```

Deployment is separate and requires explicit human approval. Inspect `config/deployments.json` and run `npm run deployment:preflight` before any approved deployment.
