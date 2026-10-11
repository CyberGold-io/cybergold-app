import { HELPERS_DIAMOND_ABI } from "../generated/helpersDiamond";


export const HELPERS_ABI_ADMIN_ROUTER = HELPERS_DIAMOND_ABI;

// Mirrors the immutable validation policy enforced by RouterAdminFacet.
export const HELPERS_MAX_FEE_PPM = 5_000n;
