import fs from "node:fs/promises";
import path from "node:path";

const DIR = path.resolve("data/trybounty");
const FILE = path.join(DIR, "state.json");

const EMPTY = {
  version: 1,
  cursor: null,
  bounties: {},
  events: {},
  candidates: {},
  updated_at: null
};

export async function loadState() {
  await fs.mkdir(DIR, { recursive: true });

  try {
    const parsed = JSON.parse(await fs.readFile(FILE, "utf8"));

    return {
      ...structuredClone(EMPTY),
      ...parsed,
      bounties: parsed.bounties ?? {},
      events: parsed.events ?? {},
      candidates: parsed.candidates ?? {}
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return structuredClone(EMPTY);
  }
}

export async function saveState(state) {
  await fs.mkdir(DIR, { recursive: true });

  state.updated_at = new Date().toISOString();

  const tmp = `${FILE}.${process.pid}.tmp`;

  await fs.writeFile(
    tmp,
    JSON.stringify(state, null, 2) + "\n",
    { mode: 0o600 }
  );

  await fs.rename(tmp, FILE);
}

export function bountyIdentity(summary) {
  return summary?._id ?? summary?.id ?? null;
}

export function bountyVersion(summary) {
  return (
    summary?.version ??
    summary?.bounty_version ??
    summary?.updated_at ??
    summary?.updatedAt ??
    "unknown"
  );
}
