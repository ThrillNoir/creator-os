#!/usr/bin/env bash
set -euo pipefail

fixture_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$fixture_dir/../../../../.." && pwd)
image_name=thot-os-three-creator-app:local
network_name=thot-os-three-creator-internal

stop_all() {
  for creator in amber birch coral; do
    docker rm --force "thot-os-fixture-$creator" 2>/dev/null || true
  done
  docker network rm "$network_name" 2>/dev/null || true
}

case "${1:-start}" in
  start)
    for creator in amber birch coral; do
      if docker ps -a --format '{{.Names}}' | grep -qx "thot-os-fixture-$creator"; then
        echo "Fixture is already present. Run stop before starting again." >&2
        exit 2
      fi
    done
    context_dir=$(mktemp -d)
    trap 'rm -rf -- "$context_dir"' EXIT
    mkdir -p "$context_dir/cloudflare/thot-os-next" "$context_dir/cloudflare/thot-os-app" "$context_dir/local-app"
    cp "$fixture_dir/../Dockerfile.app" "$context_dir/Dockerfile.app"
    cp "$fixture_dir/start-inside.sh" "$fixture_dir/prepare-config.mjs" "$fixture_dir/prepare-layout.mjs" "$fixture_dir/seed.mjs" "$context_dir/local-app/"
    for file in package.json package-lock.json next.config.ts next-env.d.ts open-next.config.ts postcss.config.mjs tsconfig.json wrangler.jsonc; do
      cp "$repo_root/cloudflare/thot-os-next/$file" "$context_dir/cloudflare/thot-os-next/"
    done
    cp -a "$repo_root/cloudflare/thot-os-next/src" "$repo_root/cloudflare/thot-os-next/public" "$context_dir/cloudflare/thot-os-next/"
    cp -a "$repo_root/cloudflare/shared" "$context_dir/cloudflare/"
    cp -a "$repo_root/cloudflare/thot-os-app/migrations" "$context_dir/cloudflare/thot-os-app/"
    docker build --tag "$image_name" --file "$context_dir/Dockerfile.app" "$context_dir"
    # Keep localhost port publishing available while disabling Docker's outbound NAT.
    docker network create --driver bridge --opt com.docker.network.bridge.enable_ip_masquerade=false "$network_name" >/dev/null
    for creator in amber birch coral; do
      case "$creator" in amber) port=8793 ;; birch) port=8794 ;; coral) port=8795 ;; esac
      docker run --detach --name "thot-os-fixture-$creator" \
        --network "$network_name" --publish "127.0.0.1:$port:3000" \
        --env "THOT_FIXTURE_CREATOR=$creator" \
        --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --memory 3g --cpus 2 \
        "$image_name" >/dev/null
    done
    for creator in amber birch coral; do
      case "$creator" in amber) port=8793 ;; birch) port=8794 ;; coral) port=8795 ;; esac
      ready=0
      for attempt in $(seq 1 100); do
        if [[ $(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 3 "http://127.0.0.1:$port/health" || true) == 200 ]]; then
          ready=1
          break
        fi
        if [[ $(docker inspect --format '{{.State.Running}}' "thot-os-fixture-$creator") != true ]]; then break; fi
        sleep 1
      done
      if [[ $ready != 1 ]]; then
        echo "Synthetic $creator failed to serve /health; inspect its Docker logs." >&2
        docker logs --tail 25 "thot-os-fixture-$creator" >&2
        exit 1
      fi
      echo "Synthetic $creator ready: http://127.0.0.1:$port/portfolio"
    done
    ;;
  status)
    docker ps -a --format '{{.Names}} {{.Status}} {{.Ports}}' --filter 'name=thot-os-fixture-'
    ;;
  stop) stop_all ;;
  reset) stop_all; docker image rm "$image_name" 2>/dev/null || true ;;
  *) echo 'Usage: run.sh {start|status|stop|reset}' >&2; exit 2 ;;
esac
