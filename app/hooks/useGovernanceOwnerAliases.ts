"use client";

import { useQuery } from "@tanstack/react-query";
import { getAddress, isAddress, type Address } from "viem";

export type GovernanceOwnerAliasEntry = {
  editorAddress: Address;
  ownerAddress: Address;
  alias: string;
  updatedAt: string;
};

type OwnerAliasesApiResponse = {
  entries?: unknown[];
  entry?: unknown;
  error?: string;
};

type OwnerAliasesApiAction = "list" | "upsert" | "delete";

type OwnerAliasesApiPayload = {
  action: OwnerAliasesApiAction;
  editorAddress: Address;
  ownerAddress?: Address;
  ownerAddresses?: Address[];
  alias?: string;
  auth?: {
    nonce: string;
    issuedAt: string;
    signature: `0x${string}`;
  };
};

function normalizeAddress(value: unknown): Address | undefined {
  if (typeof value !== "string" || !isAddress(value)) {
    return undefined;
  }
  return getAddress(value);
}

function normalizeAliasEntry(value: unknown): GovernanceOwnerAliasEntry | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  const editorAddress = normalizeAddress(row.editorAddress);
  const ownerAddress = normalizeAddress(row.ownerAddress);
  const alias = typeof row.alias === "string" ? row.alias : undefined;
  const updatedAt = typeof row.updatedAt === "string" ? row.updatedAt : undefined;
  if (!editorAddress || !ownerAddress || !alias || !updatedAt) {
    return undefined;
  }

  return {
    editorAddress,
    ownerAddress,
    alias,
    updatedAt,
  };
}

async function callOwnerAliasesApi(
  payload: OwnerAliasesApiPayload
): Promise<OwnerAliasesApiResponse> {
  const response = await fetch("/api/governance/owner-aliases", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  let data: OwnerAliasesApiResponse | null = null;
  try {
    data = (await response.json()) as OwnerAliasesApiResponse;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.error ?? `Governance owner aliases API failed with status ${response.status}`);
  }

  return data ?? {};
}

export function useGovernanceOwnerAliases(
  editorAddress?: Address,
  ownerAddresses: Address[] = [],
  enabled = true
) {
  const normalizedOwners = Array.from(new Set(ownerAddresses.map((owner) => owner.toLowerCase()))).sort();

  return useQuery({
    queryKey: ["governance-owner-aliases", editorAddress, normalizedOwners],
    enabled: enabled && !!editorAddress && normalizedOwners.length > 0,
    staleTime: 10_000,
    retry: 1,
    queryFn: async () => {
      const response = await callOwnerAliasesApi({
        action: "list",
        editorAddress: editorAddress!,
        ownerAddresses: normalizedOwners.map((owner) => getAddress(owner)),
      });
      const rows = Array.isArray(response.entries) ? response.entries : [];
      return rows
        .map((row) => normalizeAliasEntry(row))
        .filter((row): row is GovernanceOwnerAliasEntry => !!row);
    },
  });
}

export async function upsertGovernanceOwnerAlias(params: {
  editorAddress: Address;
  ownerAddress: Address;
  alias: string;
  auth: {
    nonce: string;
    issuedAt: string;
    signature: `0x${string}`;
  };
}) {
  const response = await callOwnerAliasesApi({
    action: "upsert",
    editorAddress: params.editorAddress,
    ownerAddress: params.ownerAddress,
    alias: params.alias,
    auth: params.auth,
  });
  const entry = normalizeAliasEntry(response.entry);
  if (!entry) {
    throw new Error("Governance owner alias upsert returned an invalid response.");
  }
  return entry;
}

export async function deleteGovernanceOwnerAlias(params: {
  editorAddress: Address;
  ownerAddress: Address;
  auth: {
    nonce: string;
    issuedAt: string;
    signature: `0x${string}`;
  };
}) {
  await callOwnerAliasesApi({
    action: "delete",
    editorAddress: params.editorAddress,
    ownerAddress: params.ownerAddress,
    auth: params.auth,
  });
}
