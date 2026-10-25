#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="${1:?sandbox or mainnet}"
archive="${2:?current-run image archive}"
case "$target" in
  sandbox) branch=dev ;;
  mainnet) branch=main ;;
  *) echo 'Unknown App image target.' >&2; exit 2 ;;
esac
if [[ "${RELEASE_APP_BRANCH:?RELEASE_APP_BRANCH is required}" != "$branch" ]]; then
  echo 'The App release branch does not match the publication target.' >&2; exit 1
fi
package="cybergold-app-b2b-$target-indexed"
repository="ghcr.io/cybergold-io/$package"
profile_id="$(jq -r .id "$root/deploy/public-build/$target.json")"
image_id="${CONFIG_IMAGE_ID:?CONFIG_IMAGE_ID is required}"
docker image load --input "$archive"
image="$(docker image inspect "$image_id")"
require_image() {
  if ! jq -e --arg id "$image_id" --arg commit "$RELEASE_APP_COMMIT" \
    --arg profile "$profile_id" "$1" <<<"$image" >/dev/null; then
    echo "$2" >&2; exit 1
  fi
}
require_image 'length == 1' 'The archive must identify one App image.'
require_image '.[0].Id == $id' 'The archive has the wrong config image ID.'
require_image '.[0].Os == "linux"' 'The App image must target Linux.'
require_image '.[0].Architecture == "amd64"' 'The App image must target amd64.'
require_image '.[0].Config.Labels["io.cybergold.app.commit"] == $commit' 'The App image has the wrong source commit.'
require_image '.[0].Config.Labels["io.cybergold.app.dirty"] == "false"' 'The App image was built from a dirty checkout.'
require_image '.[0].Config.Labels["io.cybergold.profile.id"] == $profile' 'The App image has the wrong target profile.'
bash "$root/scripts/require-image-release-authority.sh"
package_info="$(gh api "/orgs/CyberGold-io/packages/container/$package")"
require_package() {
  if ! jq -e --arg package "$package" "$1" <<<"$package_info" >/dev/null; then
    echo "$2" >&2; exit 1
  fi
}
require_package '.name == $package' 'The registry returned the wrong App package.'
require_package '.package_type == "container"' 'The App package must be a container package.'
require_package '.owner.login == "CyberGold-io"' 'The App package has the wrong owner.'
require_package '.visibility == "private"' 'The App package must retain private visibility.'
cleanup() {
  docker logout ghcr.io >/dev/null 2>&1 || true
  rm -f -- "${DOCKER_CONFIG:?DOCKER_CONFIG is required}/config.json"
}
trap cleanup EXIT
printf '%s' "${GHCR_TOKEN:?GHCR_TOKEN is required}" | docker login ghcr.io \
  --username "${GITHUB_ACTOR:?GITHUB_ACTOR is required}" --password-stdin
unset GHCR_TOKEN
tag="app-${RELEASE_APP_COMMIT}-${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}-${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"
docker tag "$image_id" "$repository:$tag"
push="$(docker push "$repository:$tag")"
digest="$(awk -v expected="$tag" -f "$root/scripts/parse-docker-push-digest.awk" <<<"$push")"
reference="$repository@$digest"
docker pull "$reference" >/dev/null
actual_id="$(docker image inspect --format '{{.Id}}' "$reference")"
if [[ "$actual_id" != "$image_id" ]]; then
  echo 'The published digest differs from the admitted config image ID.' >&2; exit 1
fi
docker tag "$image_id" "$repository:desired"
push="$(docker push "$repository:desired")"
desired_digest="$(awk -v expected=desired -f "$root/scripts/parse-docker-push-digest.awk" <<<"$push")"
if [[ "$desired_digest" != "$digest" ]]; then
  echo 'The desired tag differs from the published immutable digest.' >&2; exit 1
fi
printf 'Published %s\n' "$reference"
