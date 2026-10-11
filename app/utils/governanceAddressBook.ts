import type { ProtocolAddresses } from "./protocolConfiguration.ts";
import { getAddress, isAddress, type Address } from "viem";

export type GovernanceAddressAlias = {
  address: Address;
  label: string;
};

function normalizeAddress(value: string | undefined): Address | undefined {
  if (!value || !isAddress(value)) return undefined;
  return getAddress(value);
}

function aliasEntry(label: string, rawAddress: string | undefined): GovernanceAddressAlias | undefined {
  const address = normalizeAddress(rawAddress);
  if (!address) return undefined;
  return { address, label };
}

export function buildGovernanceDeploymentAddressBook(addresses: ProtocolAddresses = {}) {
  return [
    aliasEntry("Governance Safe", addresses.safe),
    aliasEntry("Core Diamond", addresses.core),
    aliasEntry("Staking Diamond", addresses.staking),
    aliasEntry("Governance Diamond", addresses.governance),
    aliasEntry("Helpers Diamond", addresses.helpers),
    aliasEntry("Uniswap Adapter", addresses.adapter),
  ].filter((entry): entry is GovernanceAddressAlias => !!entry);
}

export function extendGovernanceAddressBook(
  baseEntries: readonly GovernanceAddressAlias[],
  extraEntries: readonly (GovernanceAddressAlias | undefined)[]
) {
  const next = new Map<string, string>();

  for (const entry of [...baseEntries, ...extraEntries]) {
    if (!entry) continue;
    next.set(entry.address.toLowerCase(), entry.label);
  }

  return next;
}

export function getGovernanceAddressLabel(addressBook: ReadonlyMap<string, string>, address?: string) {
  if (!address || !isAddress(address)) return undefined;
  return addressBook.get(address.toLowerCase());
}
