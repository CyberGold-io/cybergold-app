import { createClient, custom, encodeAbiParameters, type Client, type Transport, type Chain, type GetEnsNameParameters, type GetEnsTextParameters, type GetEnsAvatarParameters } from "viem";
import { getEnsName, getEnsText, getEnsAvatar } from "viem/actions";
import { parseAvatarRecord } from "viem/ens";
import type { components } from "../contracts/backend/http";

/** Fixed Ethereum records; Viem continues to parse/render standard avatar URIs. */
export function withEnsRecords<T extends Transport, C extends Chain | undefined>(client: Client<T, C>, fetchImpl: typeof fetch = fetch) {
  async function read<Schema extends "EnsName" | "EnsAvatarRecord">(path: string) {
    const response = await fetchImpl(path, { cache: "no-store", signal: AbortSignal.timeout(client.transport.timeout ?? 20_000) });
    if (!response.ok) throw new Error("ENS observations are temporarily unavailable.");
    return response.json() as Promise<components["schemas"][Schema]>;
  }
  function current(parameters: GetEnsNameParameters | GetEnsTextParameters | GetEnsAvatarParameters) {
    return parameters.blockNumber === undefined && (parameters.blockTag === undefined || parameters.blockTag === "latest")
      && parameters.universalResolverAddress === undefined && parameters.gatewayUrls === undefined && parameters.strict !== true;
  }
  const records = client.extend(() => ({
    getEnsName: async (parameters: GetEnsNameParameters) => {
      if (!current(parameters) || (parameters.coinType !== undefined && parameters.coinType !== 60n)) return getEnsName(client, parameters);
      return (await read<"EnsName">(`/api/account/ens-name?${new URLSearchParams({ holder: parameters.address })}`)).name;
    },
    getEnsText: async (parameters: GetEnsTextParameters) => {
      if (!current(parameters) || parameters.key !== "avatar") return getEnsText(client, parameters);
      return (await read<"EnsAvatarRecord">(`/api/account/ens-avatar-record?${new URLSearchParams({ name: parameters.name })}`)).avatarRecord;
    },
  }));
  return records.extend(() => ({ getEnsAvatar: async (parameters: GetEnsAvatarParameters) => {
    if (!current(parameters)) return getEnsAvatar(client, parameters);
    const value = await read<"EnsAvatarRecord">(`/api/account/ens-avatar-record?${new URLSearchParams({ name: parameters.name })}`);
    if (!value.avatarRecord) return null;
    // Viem's maintained parser makes the standard tokenURI/uri call. Its
    // per-observation client supplies the URI already read at the ENS block;
    // URI/metadata parsing and image validation remain in the browser.
    const avatar = createClient({ chain: client.chain, transport: custom({ request: async () => {
      if (value.nftTokenUri?.status !== "success") throw new Error("NFT avatar URI is unavailable.");
      return encodeAbiParameters([{ type: "string" }], [value.nftTokenUri.value]);
    } }, { retryCount: 0 }) });
    try {
      return await parseAvatarRecord(avatar, { record: value.avatarRecord, gatewayUrls: parameters.assetGatewayUrls });
    } catch {
      return null; // Standard getEnsAvatar behavior for invalid/unavailable avatars.
    }
  } }));
}
