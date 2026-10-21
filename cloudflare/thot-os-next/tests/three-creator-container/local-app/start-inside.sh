#!/usr/bin/env bash
set -euo pipefail

case "${THOT_FIXTURE_CREATOR:-}" in
  amber|birch|coral) ;;
  *) echo 'THOT_FIXTURE_CREATOR must be amber, birch or coral' >&2; exit 2 ;;
esac

cd /app/cloudflare/thot-os-next
node /fixture/prepare-config.mjs "$THOT_FIXTURE_CREATOR"
if ! ./node_modules/.bin/wrangler d1 migrations apply DB --local > /tmp/fixture-migrations.log 2>&1; then
  tail -n 25 /tmp/fixture-migrations.log >&2
  exit 1
fi
echo 'Local D1 migrations applied.'
node /fixture/seed.mjs
if ! ./node_modules/.bin/wrangler d1 execute DB --local --file=/tmp/fixture-seed.sql > /tmp/fixture-seed.log 2>&1; then
  tail -n 25 /tmp/fixture-seed.log >&2
  exit 1
fi
echo 'Three synthetic creator records seeded.'
for creator in amber birch coral; do
  key=$(cat "/tmp/fixture-$creator-id")
  ./node_modules/.bin/wrangler r2 object put "thot-os-fixture-library/creators/synthetic-$creator/assets/$key/original.jpg" --local --file="/tmp/fixture-$creator.jpg" --content-type=image/jpeg > /tmp/fixture-r2.log 2>&1
  ./node_modules/.bin/wrangler r2 object put "thot-os-fixture-previews/creators/synthetic-$creator/assets/$key/previews/$key.jpg" --local --file="/tmp/fixture-$creator.jpg" --content-type=image/jpeg >> /tmp/fixture-r2.log 2>&1
done
echo 'Synthetic images stored in local R2.'
exec ./node_modules/.bin/next dev --webpack --hostname 0.0.0.0 --port 3000
