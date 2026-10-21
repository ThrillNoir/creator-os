FROM node:22.22.1-bookworm-slim

WORKDIR /app/cloudflare/thot-os-next
COPY cloudflare/thot-os-next/package.json cloudflare/thot-os-next/package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force

COPY cloudflare/thot-os-next/next.config.ts cloudflare/thot-os-next/next-env.d.ts cloudflare/thot-os-next/open-next.config.ts ./
COPY cloudflare/thot-os-next/postcss.config.mjs cloudflare/thot-os-next/tsconfig.json cloudflare/thot-os-next/wrangler.jsonc ./
COPY cloudflare/thot-os-next/src/ ./src/
COPY cloudflare/thot-os-next/public/ ./public/
COPY cloudflare/shared/ ../shared/
COPY cloudflare/thot-os-app/migrations/ ../thot-os-app/migrations/
COPY local-app/ /fixture/
RUN node /fixture/prepare-layout.mjs

RUN mkdir -p /app/cloudflare/thot-os-next/.wrangler && chown -R node:node /app /fixture
USER node
ENV CI=1 LOCAL_ACCESS_BYPASS=1 NEXTJS_ENV=development NEXT_TELEMETRY_DISABLED=1 PORTFOLIO_SYNTHETIC_PREVIEW=1
RUN node /fixture/prepare-config.mjs amber && ./node_modules/.bin/wrangler d1 migrations apply DB --local > /tmp/fixture-build-migrations.log 2>&1
EXPOSE 3000
CMD ["bash", "/fixture/start-inside.sh"]
