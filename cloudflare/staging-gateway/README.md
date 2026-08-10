# CreatorOS staging gateway

Cloudflare staging control-plane gateway for creator-scoped automation events.

It accepts authenticated jobs, consumes the intake and AI queues, stores an audit artifact in private R2, routes library events to asset-intelligence work, retries individual failures, and can report lifecycle receipts to CreatorOS through an authenticated callback.

Deploy from this directory:

```bash
npm_config_cache="$(mktemp -d)" npx --yes wrangler@4.119.0 deploy
```

After deployment, verify:

```bash
curl https://creator-os-staging-gateway.<your-subdomain>.workers.dev/health
```

This gateway does not receive creator credentials, source media, or publishing authority. It carries metadata-only event payloads. The local worker and platform-specific approval system remain separate.
