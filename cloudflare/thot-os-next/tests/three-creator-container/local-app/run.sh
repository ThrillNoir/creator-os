#!/usr/bin/env bash
set -euo pipefail

fixture_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$fixture_dir/../../../../.." && pwd)
image_name=${THOT_FIXTURE_IMAGE:-thot-os-three-creator-app:local}
network_name=${THOT_FIXTURE_NETWORK:-thot-os-three-creator-internal}
container_prefix=${THOT_FIXTURE_CONTAINER_PREFIX:-thot-os-fixture}
port_base=${THOT_FIXTURE_PORT_BASE:-8793}
owner_label=thot.os.synthetic_fixture
instance_label=thot.os.fixture.instance
owner_value=three-creator-local-app
if [[ ! $container_prefix =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] ||
   [[ ! $network_name =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
  echo "Fixture container prefix and network name must be simple Docker names." >&2
  exit 2
fi
if [[ ! $port_base =~ ^[0-9]+$ ]] || (( port_base < 1024 || port_base > 65533 )); then
  echo "THOT_FIXTURE_PORT_BASE must leave three available local ports." >&2
  exit 2
fi

port_for() {
  case "$1" in amber) echo "$port_base" ;; birch) echo "$((port_base + 1))" ;; coral) echo "$((port_base + 2))" ;; esac
}

stop_all() {
  # Check every resource before removing anything; names alone do not prove ownership.
  for creator in amber birch coral; do
    local name="$container_prefix-$creator"
    if docker container inspect "$name" >/dev/null 2>&1 &&
       [[ $(docker container inspect --format "{{index .Config.Labels \"$owner_label\"}}:{{index .Config.Labels \"$instance_label\"}}" "$name") != "$owner_value:$container_prefix" ]]; then
      echo "Refusing to remove unowned container: $name" >&2
      return 2
    fi
  done
  if docker network inspect "$network_name" >/dev/null 2>&1 &&
     [[ $(docker network inspect --format "{{index .Labels \"$owner_label\"}}:{{index .Labels \"$instance_label\"}}" "$network_name") != "$owner_value:$container_prefix" ]]; then
    echo "Refusing to remove unowned network: $network_name" >&2
    return 2
  fi
  for creator in amber birch coral; do
    local name="$container_prefix-$creator"
    if docker container inspect "$name" >/dev/null 2>&1; then docker rm --force "$name" >/dev/null; fi
  done
  if docker network inspect "$network_name" >/dev/null 2>&1; then docker network rm "$network_name" >/dev/null; fi
}

case "${1:-start}" in
  start)
    for creator in amber birch coral; do
      if docker ps -a --format '{{.Names}}' | grep -qx "$container_prefix-$creator"; then
        echo "Fixture is already present. Run stop before starting again." >&2
        exit 2
      fi
    done
    if docker network inspect "$network_name" >/dev/null 2>&1; then
      echo "Fixture network already exists; choose a new THOT_FIXTURE_NETWORK." >&2
      exit 2
    fi
    if docker image inspect "$image_name" >/dev/null 2>&1 &&
       [[ $(docker image inspect --format "{{index .Config.Labels \"$owner_label\"}}:{{index .Config.Labels \"$instance_label\"}}" "$image_name") != "$owner_value:$container_prefix" ]]; then
      echo "Refusing to overwrite unowned image: $image_name" >&2
      exit 2
    fi
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
    docker build --label "$owner_label=$owner_value" --label "$instance_label=$container_prefix" \
      --tag "$image_name" --file "$context_dir/Dockerfile.app" "$context_dir"
    # Keep localhost port publishing available while disabling Docker's outbound NAT.
    docker network create --driver bridge --opt com.docker.network.bridge.enable_ip_masquerade=false \
      --label "$owner_label=$owner_value" --label "$instance_label=$container_prefix" "$network_name" >/dev/null
    for creator in amber birch coral; do
      port=$(port_for "$creator")
      docker run --detach --name "$container_prefix-$creator" \
        --network "$network_name" --publish "127.0.0.1:$port:3000" \
        --label "$owner_label=$owner_value" --label "$instance_label=$container_prefix" \
        --env "THOT_FIXTURE_CREATOR=$creator" \
        --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --memory 3g --cpus 2 \
        "$image_name" >/dev/null
    done
    for creator in amber birch coral; do
      port=$(port_for "$creator")
      ready=0
      for attempt in $(seq 1 100); do
        if [[ $(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 3 "http://127.0.0.1:$port/health" || true) == 200 ]]; then
          ready=1
          break
        fi
        if [[ $(docker inspect --format '{{.State.Running}}' "$container_prefix-$creator") != true ]]; then break; fi
        sleep 1
      done
      if [[ $ready != 1 ]]; then
        echo "Synthetic $creator failed to serve /health; inspect its Docker logs." >&2
        docker logs --tail 25 "$container_prefix-$creator" >&2
        exit 1
      fi
      echo "Synthetic $creator ready: http://127.0.0.1:$port/portfolio"
    done
    ;;
  status)
    docker ps -a --format '{{.Names}} {{.Status}} {{.Ports}}' --filter "name=$container_prefix-"
    ;;
  stop) stop_all ;;
  reset)
    if docker image inspect "$image_name" >/dev/null 2>&1; then
      if [[ $(docker image inspect --format "{{index .Config.Labels \"$owner_label\"}}:{{index .Config.Labels \"$instance_label\"}}" "$image_name") != "$owner_value:$container_prefix" ]]; then
        echo "Refusing to remove unowned image: $image_name" >&2
        exit 2
      fi
    fi
    stop_all
    if docker image inspect "$image_name" >/dev/null 2>&1; then docker image rm "$image_name" >/dev/null; fi
    ;;
  *) echo 'Usage: run.sh {start|status|stop|reset}' >&2; exit 2 ;;
esac
