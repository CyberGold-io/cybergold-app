import { keccak256, stringToHex, type Hex } from "viem";

export const EMPTY_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

export function governanceRoleHash(roleId: string): Hex {
  if (roleId === "DEFAULT_ADMIN_ROLE") {
    return EMPTY_BYTES32;
  }

  return keccak256(stringToHex(roleId));
}
