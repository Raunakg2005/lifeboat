// Plans one Arkiv batch so that a re-check updates the publisher's record in place instead of adding a new one.
//   * Exposure (address, chainId) and NameCheck (name, chainId): one live record each. If the publisher already
//     owns a live one, it is patched with the full new attribute set (optional columns the new check doesn't carry
//     are unset) and its expiry is set to the schema's lifetime from now, in the same executeBatch. Keys stay stable.
//   * Leaf (root, leaf, digest) and Aboard (txHash, evidenceHash): readonly audit trail, written once.
//   * Anything else (Watch, Alert): created.
// SDK 1.0.1 semantics this relies on: a patch writes only the columns it names (`set`) and removes optional ones
// (`unset`); it never moves the key, owner, creation flags or expiry. An extension sets a new expiry
// (now + lifetime, not added to the old one) and reverts if that would be earlier than the current expiry.
import type { Expiry } from "@arkiv-network/sdk/entity";
import { asc } from "@arkiv-network/sdk/query";
import type { Schema } from "@arkiv-network/sdk/schema";
import type { ExecuteBatchReturnType } from "@arkiv-network/sdk/types";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { Aboard, Exposure, Leaf, NameCheck, arkivPublic, type arkivWallet } from "./arkiv.js";

export type Write = {
  schema: Schema<any>;
  values: Record<string, any>;
  expiration: Expiry;
  flags?: { readonly?: boolean; permissionlessExtension?: boolean };
};

export type PlanRow = {
  op: "create" | "update" | "skip";
  schema: string;
  id: string;
  key?: Hex; // existing key (update, skip) or predicted key (create)
  predicted?: boolean;
  expiresAt?: bigint; // current expiry of the existing record
  until?: bigint; // planned expiry (approximate: counted from the block the plan was read at)
  unset?: string[];
  note?: string;
  write: Write;
};

export type Plan = { owner: Address; block: bigint; rows: PlanRow[]; creates: any[]; patches: any[]; extensions: any[] };

const ARKIV_BLOCK_SECONDS = 2;
/** A record this close to expiry is treated as gone: patching it could revert with EntityExpired before the tx lands. */
const MARGIN_BLOCKS = 300n; // 10 min

const val = (x: unknown) => String(x !== null && typeof x === "object" && "value" in (x as any) ? (x as any).value : x ?? "").toLowerCase();

type Rule = { mode: "upsert" | "once"; columns: string[]; id: (v: Record<string, any>) => string; ids?: (v: Record<string, any>) => string[] };
const RULES = new Map<Schema<any>, Rule>([
  [Exposure, { mode: "upsert", columns: ["address", "chainId"], id: (v) => `${val(v.address)}:${val(v.chainId)}` }],
  [NameCheck, { mode: "upsert", columns: ["name", "chainId"], id: (v) => `${val(v.name)}:${val(v.chainId)}` }],
  [Leaf, { mode: "once", columns: ["root", "leaf", "digest"], id: (v) => `${val(v.root)}:${val(v.leaf)}:${val(v.digest)}` }],
  [
    Aboard,
    {
      // A write without evidence is satisfied by any record of the tx; one with evidence only by a record of the same bytes.
      mode: "once",
      columns: ["txHash", "evidenceHash"],
      id: (v) => `${val(v.txHash)}:${v.evidenceHash ? val(v.evidenceHash) : "*"}`,
      ids: (v) => [`${val(v.txHash)}:*`, ...(v.evidenceHash ? [`${val(v.txHash)}:${val(v.evidenceHash)}`] : [])],
    },
  ],
]);

type Live = { $key: Hex; $expiresAt: bigint; [column: string]: any };

/** Every live entity of `schema` owned by `owner` (paged by key; expired entities are gone from the index). */
export async function liveEntities(reader: ReturnType<typeof arkivPublic>, schema: Schema<any>, owner: Address, columns: string[]): Promise<Live[]> {
  const selection = Object.fromEntries([["$key", true], ["$expiresAt", true], ...columns.map((c) => [c, true])]);
  const out: Live[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await (reader.select(selection as any).from(schema) as any).ownedBy(owner).orderBy(asc("$key")).limit(100).offset(offset).fetch();
    out.push(...(page.entities as Live[]));
    if (page.entities.length + page.skipped < 100) return out;
  }
}

/** Deterministic per-record salt, so a dry run and the real run predict the same create keys (the nonce still makes each key unique). */
const saltFor = (schema: string, id: string, owner: Address) => BigInt(keccak256(toHex(`${schema}|${id}|${owner.toLowerCase()}`)).slice(0, 34));

export async function planWrites(writes: Write[], owner: Address, reader = arkivPublic()): Promise<Plan> {
  const block = await reader.getBlockNumber();
  const live = new Map<Schema<any>, Live[]>();
  for (const schema of new Set(writes.map((w) => w.schema))) {
    const rule = RULES.get(schema);
    if (rule) live.set(schema, await liveEntities(reader, schema, owner, rule.columns));
  }

  // one write per identity: a later upsert replaces an earlier one, a repeated audit-trail write is dropped
  const chosen = new Map<string, Write>();
  writes.forEach((w, i) => {
    const rule = RULES.get(w.schema);
    const k = rule ? `${w.schema.name}|${rule.id(w.values)}` : `${w.schema.name}|#${i}`;
    if (rule?.mode === "once" && chosen.has(k)) return;
    if (chosen.has(k)) console.log(`   note: ${k} appears twice in this run; the last check wins`);
    chosen.delete(k);
    chosen.set(k, w);
  });

  const rows: PlanRow[] = [];
  const patches: any[] = [];
  const extensions: any[] = [];
  const pending: { row: PlanRow; create: any }[] = [];
  for (const w of chosen.values()) {
    const rule = RULES.get(w.schema);
    const schemaName = w.schema.name ?? "(unnamed)";
    const id = rule ? rule.id(w.values) : Object.values(w.values).map(val).join(":").slice(0, 60);
    const lifetime = w.expiration.minLifetime;
    const until = block + lifetime;
    const rowsOf = live.get(w.schema) ?? [];

    if (rule?.mode === "once") {
      const have = rowsOf.find((e) => (rule.ids ?? ((v) => [rule.id(v)]))(e).includes(id));
      if (have) {
        rows.push({ op: "skip", schema: schemaName, id, key: have.$key, expiresAt: have.$expiresAt, note: "already on Arkiv (readonly audit trail)", write: w });
        continue;
      }
    }
    if (rule?.mode === "upsert") {
      const match = rowsOf.filter((e) => rule.id(e) === id && e.$expiresAt > block + MARGIN_BLOCKS).sort((a, b) => (a.$expiresAt > b.$expiresAt ? -1 : 1))[0];
      if (match) {
        const set = Object.fromEntries(Object.entries(w.values).filter(([, v]) => v !== undefined));
        const unset = Object.entries(w.schema.columns as Record<string, { isOptional: boolean }>)
          .filter(([name, c]) => c.isOptional && !(name in set))
          .map(([name]) => name);
        patches.push({ schema: w.schema, entityKey: match.$key, set, ...(unset.length ? { unset } : {}) });
        const extend = until > match.$expiresAt;
        if (extend) extensions.push({ entityKey: match.$key, expiration: w.expiration });
        const others = rowsOf.filter((e) => rule.id(e) === id && e.$key !== match.$key).length;
        rows.push({
          op: "update",
          schema: schemaName,
          id,
          key: match.$key,
          expiresAt: match.$expiresAt,
          ...(extend ? { until } : {}),
          ...(unset.length ? { unset } : {}),
          ...(others ? { note: `${others} older duplicate(s) left to expire` } : {}),
          write: w,
        });
        continue;
      }
    }
    const row: PlanRow = { op: "create", schema: schemaName, id, until, write: w };
    rows.push(row);
    pending.push({ row, create: { schema: w.schema, values: w.values, expiration: w.expiration, ...(w.flags ? { flags: w.flags } : {}) } });
  }

  // predicted create keys (valid while the owner sends nothing else in between)
  const salts = pending.map(({ row }) => saltFor(row.schema, row.id, owner));
  try {
    const keys = pending.length ? await reader.predictEntityKeys({ owner, salts }) : [];
    pending.forEach((p, i) => {
      p.row.key = keys[i]!.key;
      p.row.predicted = true;
    });
  } catch (e) {
    console.log(`   (could not predict create keys: ${String((e as Error).message).split("\n")[0]})`);
  }
  const creates = pending.map((p, i) => ({ ...p.create, salt: salts[i] }));
  return { owner, block, rows, creates, patches, extensions };
}

const hours = (blocks: bigint) => `${((Number(blocks) * ARKIV_BLOCK_SECONDS) / 3600).toFixed(1)} h`;
const short = (h?: string) => (h ? `${h.slice(0, 10)}…${h.slice(-4)}` : "");

export function printPlan(plan: Plan, title = "Arkiv plan") {
  const n = (op: PlanRow["op"]) => plan.rows.filter((r) => r.op === op).length;
  console.log(
    `\n${title} at Rabdi block ${plan.block}, owner ${plan.owner}: ${plan.creates.length} create(s), ${plan.patches.length} update(s), ${plan.extensions.length} extension(s), ${n("skip")} unchanged`,
  );
  for (const r of plan.rows) {
    const v = r.write.values;
    const ref = String(v.swarmRef ?? "");
    const extra = [ref ? `swarmRef ${ref.length > 16 ? `${ref.slice(0, 12)}…` : ref}` : "", v.evidenceHash ? `evidenceHash ${short(String(v.evidenceHash))}` : ""].filter(Boolean).join(", ");
    const life =
      r.op === "update"
        ? r.until
          ? `expiry ${r.expiresAt} -> ~${r.until} (${hours(r.until - plan.block)} from now)`
          : `expiry ${r.expiresAt} kept (already later)`
        : r.op === "create"
          ? `expires ~${r.until} (${hours(r.until! - plan.block)})`
          : `expires ${r.expiresAt}`;
    console.log(
      `  ${r.op.padEnd(6)} ${r.schema.padEnd(20)} ${r.id.length > 60 ? `${r.id.slice(0, 57)}…` : r.id}\n` +
        `         key ${r.key ?? "(minted on send)"}${r.predicted ? " (predicted)" : ""}  ${life}` +
        (r.unset?.length ? `  unset ${r.unset.join(",")}` : "") +
        (extra ? `\n         ${extra}` : "") +
        (r.note ? `\n         ${r.note}` : ""),
    );
  }
}

export type SentPlan = {
  txHash: Hex | null;
  created: { schema: string; id: string; key: Hex }[];
  updated: { schema: string; id: string; key: Hex }[];
  extended: Hex[];
  unchanged: { schema: string; id: string; key: Hex }[];
};

/** Sends the plan as one executeBatch (creates, patches, extensions). Nothing is sent when the plan is empty. */
export async function sendPlan(plan: Plan, writer: ReturnType<typeof arkivWallet>): Promise<SentPlan> {
  if (writer.account.address.toLowerCase() !== plan.owner.toLowerCase()) throw new Error(`plan was made for ${plan.owner}, writer is ${writer.account.address}`);
  const pick = (op: PlanRow["op"]) => plan.rows.filter((r) => r.op === op);
  const unchanged = pick("skip").map((r) => ({ schema: r.schema, id: r.id, key: r.key! }));
  if (!plan.creates.length && !plan.patches.length && !plan.extensions.length) return { txHash: null, created: [], updated: [], extended: [], unchanged };
  const res: ExecuteBatchReturnType = await writer.client.executeBatch({ creates: plan.creates, patches: plan.patches, extensions: plan.extensions } as any);
  const created = pick("create").map((r, i) => ({ schema: r.schema, id: r.id, key: res.createdEntities[i]! }));
  created.forEach((c, i) => {
    const want = pick("create")[i]?.key;
    if (want && want.toLowerCase() !== c.key.toLowerCase()) console.log(`   note: ${c.id} got key ${c.key}, not the predicted ${want} (the owner's nonce moved)`);
  });
  return { txHash: res.txHash, created, updated: pick("update").map((r) => ({ schema: r.schema, id: r.id, key: r.key! })), extended: res.extendedEntities, unchanged };
}

export function printSent(s: SentPlan) {
  if (!s.txHash) return console.log("nothing to write: every record is already current");
  console.log(`Arkiv batch ${s.txHash}: ${s.created.length} created, ${s.updated.length} updated in place, ${s.extended.length} extended, ${s.unchanged.length} unchanged`);
  for (const r of s.created) console.log(`  created ${r.schema} ${r.id} ${r.key}`);
  for (const r of s.updated) console.log(`  updated ${r.schema} ${r.id} ${r.key}`);
}
