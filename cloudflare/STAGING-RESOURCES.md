# Thot OS staging resources

Run these commands from a Terminal where `CLOUDFLARE_API_TOKEN` is set.

```bash
npm_config_cache="$(mktemp -d)" npx --yes wrangler@4.119.0 r2 bucket create thot-os-creator-intake-staging
npm_config_cache="$(mktemp -d)" npx --yes wrangler@4.119.0 r2 bucket create thot-os-creator-packages-staging
npm_config_cache="$(mktemp -d)" npx --yes wrangler@4.119.0 queues create thot-os-intake-staging
npm_config_cache="$(mktemp -d)" npx --yes wrangler@4.119.0 queues create thot-os-ai-jobs-staging
npm_config_cache="$(mktemp -d)" npx --yes wrangler@4.119.0 queues create thot-os-failures-staging
```

These are staging-only resources. Do not enable public R2 access.

Configure both secrets before enabling callbacks:

```bash
npm_config_cache="$(mktemp -d)" npx --yes wrangler@4.119.0 secret put STAGING_GATEWAY_TOKEN
npm_config_cache="$(mktemp -d)" npx --yes wrangler@4.119.0 secret put CREATOR_OS_CALLBACK_TOKEN
```

Set `CREATOR_OS_CALLBACK_URL` to the private HTTPS CreatorOS callback route only after a protected Tunnel is available. The callback token must match `CREATOR_OS_AUTOMATION_CALLBACK_TOKEN` in CreatorOS.
