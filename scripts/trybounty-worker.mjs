import { createBountyClient } from "../lib/trybounty/client.mjs";
import { qualifyBounty } from "../lib/trybounty/qualification.mjs";
import {
  loadState,
  saveState,
  bountyIdentity,
  bountyVersion
} from "../lib/trybounty/store.mjs";

const INTERVAL_MS =
  Math.max(30_000, Number(process.env.TRYBOUNTY_POLL_MS ?? 30_000));

const ONCE = process.argv.includes("--once");

const bounty = createBountyClient();

let stopping = false;

process.on("SIGINT", () => {
  stopping = true;
});

process.on("SIGTERM", () => {
  stopping = true;
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(type, payload = {}) {
  process.stdout.write(
    JSON.stringify({
      time: new Date().toISOString(),
      type,
      ...payload
    }) + "\n"
  );
}

async function scanAvailable(state) {
  let discovered = 0;
  let changed = 0;
  let strong = 0;

  for await (const summary of bounty.bounties.iterate()) {
    discovered++;

    const id = bountyIdentity(summary);
    if (!id) continue;

    const version = bountyVersion(summary);
    const previous = state.bounties[id];

    if (previous?.version === version) continue;

    changed++;

    const qualification = qualifyBounty(summary);

    state.bounties[id] = {
      version,
      seen_at: new Date().toISOString(),
      payout_cents: Number(summary?.payout_cents ?? 0),
      title: summary?.title ?? null
    };

    state.candidates[id] = {
      ...qualification,
      version,
      evaluated_at: new Date().toISOString()
    };

    if (qualification.strong_fit) {
      strong++;

      log("strong_candidate", {
        bounty_id: id,
        title: qualification.title,
        payout_cents: qualification.payout_cents,
        score: qualification.score,
        matched_terms: qualification.matched_terms
      });
    } else {
      log("candidate_seen", {
        bounty_id: id,
        title: qualification.title,
        payout_cents: qualification.payout_cents,
        score: qualification.score
      });
    }
  }

  await saveState(state);

  log("discovery_complete", {
    discovered,
    changed,
    strong
  });
}

async function recoverEvents(state) {
  let pages = 0;
  let admitted = 0;

  while (true) {
    const page = await bounty.events.poll({
      ...(state.cursor ? { cursor: state.cursor } : {})
    });

    pages++;

    for (const event of page.events ?? []) {
      if (state.events[event.id]) continue;

      state.events[event.id] = {
        type: event.type,
        state: "pending",
        occurred_at:
          event.occurredAt ??
          event.occurred_at ??
          null,
        admitted_at: new Date().toISOString(),
        subject: event.subject ?? null,
        data: event.data ?? null
      };

      admitted++;

      log("event_admitted", {
        event_id: event.id,
        event_type: event.type,
        bounty_id:
          event?.data?.bounty_id ??
          event?.subject?.id ??
          null
      });
    }

    /*
     * Advance only after this page's events have been placed in
     * durable state.
     */
    if (page.next_cursor) {
      state.cursor = page.next_cursor;
    }

    await saveState(state);

    if (!page.has_more) break;
  }

  log("recovery_complete", {
    pages,
    admitted
  });
}

async function cycle() {
  const state = await loadState();

  /*
   * Discovery and recovery are intentionally independent.
   * A temporary failure in one must not erase durable state
   * produced by the other.
   */

  try {
    await scanAvailable(state);
  } catch (error) {
    log("discovery_error", {
      message: error?.message ?? String(error),
      code: error?.code ?? null,
      status: error?.status ?? null
    });
  }

  try {
    await recoverEvents(state);
  } catch (error) {
    log("recovery_error", {
      message: error?.message ?? String(error),
      code: error?.code ?? null,
      status: error?.status ?? null
    });
  }
}

log("worker_started", {
  interval_ms: INTERVAL_MS,
  mode: ONCE ? "once" : "continuous",
  claims_enabled: false,
  external_spend_enabled: false
});

do {
  await cycle();

  if (ONCE || stopping) break;

  await sleep(INTERVAL_MS);
} while (!stopping);

log("worker_stopped");
