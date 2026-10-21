FROM node:22.22.1-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /fixture/cloudflare/thot-os-next
COPY package.json package-lock.json /fixture/
WORKDIR /fixture
RUN npm ci --no-audit --no-fund && npm cache clean --force

COPY cloudflare/thot-os-app/migrations/ cloudflare/thot-os-app/migrations/
COPY cloudflare/thot-os-next/src/ cloudflare/thot-os-next/src/
COPY cloudflare/thot-os-next/tests/ cloudflare/thot-os-next/tests/

USER node
WORKDIR /fixture/cloudflare/thot-os-next
CMD ["node", "--experimental-strip-types", "--test", "tests/access-otp-boundary.test.mjs", "tests/library-catalog.test.mjs", "tests/local-onboarding-journey.test.mjs", "tests/native-image-upload-recovery.test.mjs", "tests/native-preview-local-binding.test.mjs", "tests/portfolio-drafts.test.mjs", "tests/portfolio-releases.test.mjs", "tests/three-creator-portfolio-journey.test.mjs", "tests/three-creator-upload-journey.test.mjs"]
