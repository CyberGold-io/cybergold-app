#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="${1:?sandbox or mainnet}"
case "$target" in
  sandbox|mainnet) ;;
  *) echo 'Unknown App image target.' >&2; exit 2 ;;
esac
profile="$root/deploy/public-build/$target.json"
app_commit="${RELEASE_APP_COMMIT:?RELEASE_APP_COMMIT is required}"
if [[ "$(git -C "$root" rev-parse HEAD)" != "$app_commit" ]]; then
  echo 'The App checkout differs from the admitted release commit.' >&2; exit 1
fi
if [[ -n "$(git -C "$root" status --porcelain --untracked-files=normal)" ]]; then
  echo 'The App release checkout is dirty.' >&2; exit 1
fi
public_env="$(mktemp)"
trap 'rm -f -- "$public_env"' EXIT
jq -r --arg walletconnect "${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:-}" '
  .environment + {NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:$walletconnect}
  | to_entries[] | "\(.key)=\(.value | @json)"
' "$profile" >"$public_env"
sha256_file() {
  python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1"
}
profile_id="$(jq -r .id "$profile")"
profile_sha="$(sha256_file "$profile")"
public_sha="$(sha256_file "$public_env")"
lock_sha="$(sha256_file "$root/package-lock.json")"
contract_sha="$(sha256_file "$root/app/contracts/backend/openapi.json")"
image_tag="cybergold-app-release:$target"
CYBERGOLD_SOURCE_COMMIT="$app_commit" bash "$root/scripts/build-public-image.sh" \
  "$root" "$image_tag" "$(jq -r .buildTarget "$profile")" "$public_env" \
  --label "io.cybergold.app.commit=$app_commit" \
  --label 'io.cybergold.app.dirty=false' \
  --label "io.cybergold.app.lockfile-sha256=$lock_sha" \
  --label 'io.cybergold.app.runtime=split-v1' \
  --label "io.cybergold.app.backend-contract-sha256=$contract_sha" \
  --label "io.cybergold.profile.id=$profile_id" \
  --label "io.cybergold.profile.sha256=$profile_sha" \
  --label "io.cybergold.public-env.sha256=$public_sha" \
  --label 'org.opencontainers.image.source=https://github.com/CyberGold-io/cybergold-app' \
  --label "org.opencontainers.image.revision=$app_commit"
image_id="$(docker image inspect --format '{{.Id}}' "$image_tag")"
archive_path="${RUNNER_TEMP:?RUNNER_TEMP is required}/app-image-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.docker.tar"
docker image save --output "$archive_path" "$image_id"
printf 'archive_path=%s\nconfig_image_id=%s\n' "$archive_path" "$image_id" >>"${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
