const APP_COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const APP_COMMIT_URL_PREFIX = "https://github.com/CyberGold-io/cybergold-app/commit/";

export type BuildIdentity = {
  commit: string;
  shortCommit: string;
  url: string;
};

export function resolveBuildIdentity(rawCommit: string | undefined): BuildIdentity | null {
  if (!rawCommit || !APP_COMMIT_PATTERN.test(rawCommit)) {
    return null;
  }

  return {
    commit: rawCommit,
    shortCommit: rawCommit.slice(0, 8),
    url: `${APP_COMMIT_URL_PREFIX}${rawCommit}`,
  };
}
