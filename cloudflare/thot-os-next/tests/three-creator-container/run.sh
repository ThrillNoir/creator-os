#!/usr/bin/env bash
set -euo pipefail

fixture_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$fixture_dir/../../../.." && pwd)
image_name=thot-os-three-creator-fixture:local
container_name=thot-os-three-creator-fixture

case "${1:-start}" in
  start)
    context_dir=$(mktemp -d)
    trap 'rm -rf -- "$context_dir"' EXIT
    mkdir -p "$context_dir/cloudflare/thot-os-next/tests/helpers" "$context_dir/cloudflare/thot-os-app/migrations"
    cp "$fixture_dir/Dockerfile" "$context_dir/Dockerfile"
    cp "$fixture_dir/package.json" "$fixture_dir/package-lock.json" "$context_dir/"
    cp -a "$repo_root/cloudflare/thot-os-next/src" "$context_dir/cloudflare/thot-os-next/"
    cp "$repo_root"/cloudflare/thot-os-app/migrations/*.sql "$context_dir/cloudflare/thot-os-app/migrations/"
    cp "$repo_root"/cloudflare/thot-os-next/tests/helpers/*.mjs "$context_dir/cloudflare/thot-os-next/tests/helpers/"
    for test_name in access-otp-boundary library-catalog local-onboarding-journey native-image-upload-recovery native-preview-local-binding portfolio-drafts portfolio-releases three-creator-portfolio-journey three-creator-upload-journey; do
      cp "$repo_root/cloudflare/thot-os-next/tests/$test_name.test.mjs" "$context_dir/cloudflare/thot-os-next/tests/"
    done
    docker build --tag "$image_name" "$context_dir"
    docker run --rm --name "$container_name" --network none --read-only \
      --tmpfs /tmp:rw,noexec,nosuid,size=128m --cap-drop ALL --security-opt no-new-privileges \
      --pids-limit 256 --memory 1g --cpus 1 "$image_name"
    ;;
  stop)
    docker rm --force "$container_name" 2>/dev/null || true
    ;;
  reset)
    docker rm --force "$container_name" 2>/dev/null || true
    docker image rm "$image_name" 2>/dev/null || true
    ;;
  *)
    printf 'Usage: %s {start|stop|reset}\n' "$0" >&2
    exit 2
    ;;
esac
