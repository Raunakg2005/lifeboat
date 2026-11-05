// ENSv2 on Sepolia: addresses, ABIs (Sourcify, abi/ens), role bits (verified RegistryRolesLib /
// PermissionedResolverLib sources). Browser-safe: no fs, no env.
import type { Abi, Address, Hex } from "viem";
import addresses from "../abi/ens/addresses.json" with { type: "json" };
import ETHRegistry from "../abi/ens/ETHRegistry.json" with { type: "json" };
import ETHRegistrar from "../abi/ens/ETHRegistrar.json" with { type: "json" };
import PermissionedResolverImpl from "../abi/ens/PermissionedResolverImpl.json" with { type: "json" };
import VerifiableFactory from "../abi/ens/VerifiableFactory.json" with { type: "json" };
import UniversalHelper from "../abi/ens/UniversalHelper.json" with { type: "json" };
import MockUSDC from "../abi/ens/MockUSDC.json" with { type: "json" };

export const ENS = addresses as Record<
  "UniversalResolver" | "RootRegistry" | "ETHRegistry" | "ETHRegistrar" | "PermissionedResolverImpl" | "VerifiableFactory" | "UniversalHelper" | "MockUSDC",
  Address
>;
export const ENS_V2_FROM_BLOCK = 11_820_399n; // first ENSv2 block on Sepolia

export const registryAbi = ETHRegistry as Abi; // PermissionedRegistry (root and .eth share it)
export const registrarAbi = ETHRegistrar as Abi;
export const resolverAbi = PermissionedResolverImpl as Abi;
export const factoryAbi = VerifiableFactory as Abi;
export const helperAbi = UniversalHelper as Abi;
export const usdcAbi = MockUSDC as Abi;

/** Registry roles: RegistryRolesLib.sol. One nybble per role; admin = role << 128. */
export const REGISTRY_ROLES: Record<string, bigint> = {
  REGISTRAR: 1n << 0n,
  REGISTER_RESERVED: 1n << 4n,
  SET_PARENT: 1n << 8n,
  UNREGISTER: 1n << 12n,
  RENEW: 1n << 16n,
  SET_SUBREGISTRY: 1n << 20n,
  SET_RESOLVER: 1n << 24n,
  CAN_TRANSFER: 1n << 28n, // only the admin form is used
  WAS_RESERVED: 1n << 32n,
  SET_URI: 1n << 36n,
  CAN_NAME: 1n << 120n,
  UPGRADE: 1n << 124n,
};

/** Resolver roles: PermissionedResolverLib.sol. */
export const RESOLVER_ROLES: Record<string, bigint> = {
  SET_ADDRESS: 1n << 0n,
  SET_TEXT: 1n << 4n,
  SET_CONTENTHASH: 1n << 8n,
  SET_ABI: 1n << 12n,
  SET_INTERFACE: 1n << 16n,
  SET_NAME: 1n << 20n,
  SET_DATA: 1n << 24n,
  LINK: 1n << 28n,
  CAN_NAME: 1n << 120n,
  UPGRADE: 1n << 124n,
};

/** EACBaseRolesLib.ALL_ROLES: bit 0 of every nybble. */
export const ALL_ROLES = BigInt("0x" + "1".repeat(64));

export function roleNames(bitmap: bigint, table: Record<string, bigint>): string[] {
  const out: string[] = [];
  for (const [name, bit] of Object.entries(table)) {
    if (bitmap & bit) out.push(name);
    if (bitmap & (bit << 128n)) out.push(`${name}_ADMIN`);
  }
  return out;
}

/** DNS wire format: "lifeboat.eth" -> 0x086c696665626f617403657468 00 */
export function dnsEncode(name: string): Hex {
  const bytes: number[] = [];
  for (const p of name.split(".").filter(Boolean)) {
    const b = new TextEncoder().encode(p);
    if (b.length > 63) throw new Error(`label too long: ${p}`);
    bytes.push(b.length, ...b);
  }
  bytes.push(0);
  return `0x${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

/** Public RPCs (CORS-enabled). Tenderly keeps full Sepolia log history (20k results per query). */
export const PUBLIC_RPC = {
  sepolia: "https://ethereum-sepolia-rpc.publicnode.com",
  sepoliaLogs: "https://sepolia.gateway.tenderly.co",
  mainnet: "https://ethereum-rpc.publicnode.com",
};
