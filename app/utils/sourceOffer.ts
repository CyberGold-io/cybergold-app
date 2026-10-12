// SPDX-License-Identifier: AGPL-3.0-only
import { retainedSourceOffers } from "../source-offers.ts";

type Repository = "cybergold-app" | "cybergold-backend";
export function sourceOffer(repository: Repository, version: string | null | undefined) {
  const base = `https://github.com/CyberGold-io/${repository}`;
  const retained = retainedSourceOffers.find((item) => item.repository === repository && item.version === version);
  return { repository: base, version: version ?? null,
    downloadUrl: retained?.downloadUrl ?? (version ? `${base}/archive/${encodeURIComponent(version)}.tar.gz` : null) };
}

function escape(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
function row(repository: Repository, version: string | null | undefined) {
  const offer = sourceOffer(repository, version);
  return `<tr><td>${repository}</td><td>${offer.version ? `<code>${escape(offer.version)}</code>` : "Local build"}</td><td><a href="${escape(offer.downloadUrl ?? offer.repository)}">${offer.downloadUrl ? "Download source" : "Source repository"}</a></td></tr>`;
}

export async function sourcePage(appVersion: string | undefined, readBackend: () => Promise<{ version?: unknown }>) {
  let backendVersion: string | undefined;
  try { const backend = await readBackend(); if (typeof backend.version === "string") backendVersion = backend.version; }
  catch { /* Source information for this App remains available independently. */ }
  return '<!doctype html><html lang="en"><meta charset="utf-8"><title>CyberGold source code</title><body>'
    + '<h1>CyberGold source code (AGPL-3.0)</h1><p>Source packages include build/install/run instructions and preserved upstream licenses.</p>'
    + '<h2>Current versions</h2><table><thead><tr><th>Project</th><th>Version</th><th>Source</th></tr></thead><tbody>'
    + row("cybergold-app", appVersion) + row("cybergold-backend", backendVersion) + '</tbody></table>'
    + '<h2>Retained versions</h2><table><thead><tr><th>Project</th><th>Version</th><th>Source</th></tr></thead><tbody>'
    + retainedSourceOffers.map((offer) => row(offer.repository, offer.version)).join("") + '</tbody></table></body></html>';
}
