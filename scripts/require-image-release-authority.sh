#!/usr/bin/env bash
# Reuse the exact green protected-branch authority formerly checked by Ops.
set -Eeuo pipefail

case "${RELEASE_APP_BRANCH:?RELEASE_APP_BRANCH is required}" in
  dev) target=sandbox ;;
  main) target=mainnet ;;
  *) echo 'Image releases require App dev or main.' >&2; exit 1 ;;
esac
: "${RELEASE_APP_COMMIT:?RELEASE_APP_COMMIT is required}"
: "${RELEASE_CI_RUN_ID:?RELEASE_CI_RUN_ID is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"
repository=CyberGold-io/cybergold-app
if [[ "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}" != "$repository" ]]; then
  echo 'Image releases require the canonical CyberGold App repository.' >&2; exit 1
fi

run="$(gh api "/repos/$repository/actions/runs/$RELEASE_CI_RUN_ID")"
require_run() {
  if ! jq -e "$1" <<<"$run" >/dev/null; then
    echo "$2" >&2; exit 1
  fi
}
require_run '.event == "push"' 'The App CI run must be a push run.'
require_run '.path == ".github/workflows/ci.yml"' 'The App CI run must use ci.yml.'
require_run '.status == "completed"' 'The App CI run has not completed.'
require_run '.conclusion == "success"' 'The App CI run did not succeed.'
require_run ".head_repository.full_name == \"$repository\"" 'The App CI run has the wrong source repository.'
require_run ".head_branch == \"$RELEASE_APP_BRANCH\"" 'The App CI run has the wrong source branch.'
require_run ".head_sha == \"$RELEASE_APP_COMMIT\"" 'The App CI run has the wrong source commit.'
current="$(gh api "/repos/$repository/git/ref/heads/$RELEASE_APP_BRANCH" --jq .object.sha)"
if [[ "$current" != "$RELEASE_APP_COMMIT" ]]; then
  echo 'The requested App commit is no longer the current mapped branch head.' >&2; exit 1
fi
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'target=%s\n' "$target" >>"$GITHUB_OUTPUT"
fi
