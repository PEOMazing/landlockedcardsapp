import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { canManageStream, deactivationRefusal, deriveRoles, ownsStream, Me } from "../auth";

// da-v1. Deactivating somebody has to switch off everything, not most things.
// The app has around 80 places that call getMe and they all gate on the same
// four role booleans, so the rule lives in deriveRoles and these tests are the
// check that it actually closes every door.

const ACTIVE = { deactivatedAt: null };
const GONE = { deactivatedAt: "2026-10-06T18:00:00.000Z" };

describe("what a role grants while someone is active", () => {
  it("gives an admin everything", () => {
    const r = deriveRoles({ role: "admin", ...ACTIVE });
    assert.deepEqual([r.isAdmin, r.isManager, r.isTeam, r.isCollector, r.isDeactivated],
      [true, true, true, false, false]);
  });

  it("gives a manager manager and team, not admin", () => {
    const r = deriveRoles({ role: "manager", ...ACTIVE });
    assert.deepEqual([r.isAdmin, r.isManager, r.isTeam], [false, true, true]);
  });

  it("gives a streamer team only", () => {
    const r = deriveRoles({ role: "streamer", ...ACTIVE });
    assert.deepEqual([r.isAdmin, r.isManager, r.isTeam], [false, false, true]);
  });

  it("gives an approved collector their workspace and nothing else", () => {
    const r = deriveRoles({ role: "collector", signupStatus: "approved", ...ACTIVE });
    assert.deepEqual([r.isTeam, r.isCollector], [false, true]);
  });

  it("gives a pending collector nothing yet", () => {
    assert.equal(deriveRoles({ role: "collector", signupStatus: "pending", ...ACTIVE }).isCollector, false);
  });

  it("honours admin granted by Clerk metadata rather than the record", () => {
    assert.equal(deriveRoles({ role: "streamer", clerkAdmin: true, ...ACTIVE }).isAdmin, true);
  });

  it("treats a record with no Deactivated At as active", () => {
    // every record predates this field, so blank has to mean active
    assert.equal(deriveRoles({ role: "manager" }).isManager, true);
    assert.equal(deriveRoles({ role: "manager", deactivatedAt: "" }).isManager, true);
  });
});

describe("what deactivation takes away", () => {
  it("strips an admin of everything", () => {
    const r = deriveRoles({ role: "admin", ...GONE });
    assert.deepEqual([r.isAdmin, r.isManager, r.isTeam, r.isCollector], [false, false, false, false]);
    assert.equal(r.isDeactivated, true);
  });

  it("strips a manager, a streamer and a collector", () => {
    for (const role of ["manager", "streamer"]) {
      const r = deriveRoles({ role, ...GONE });
      assert.deepEqual([r.isAdmin, r.isManager, r.isTeam], [false, false, false], role);
    }
    assert.equal(deriveRoles({ role: "collector", signupStatus: "approved", ...GONE }).isCollector, false);
  });

  it("beats admin granted by Clerk metadata", () => {
    // the subtle one: admin can come from outside the record, and deactivation
    // has to win anyway or the switch does nothing for the people who matter
    const r = deriveRoles({ role: "streamer", clerkAdmin: true, ...GONE });
    assert.equal(r.isAdmin, false);
    assert.equal(r.isManager, false);
  });

  it("keeps the timestamp, so the UI can say when", () => {
    assert.equal(deriveRoles({ role: "manager", ...GONE }).deactivatedAt, GONE.deactivatedAt);
  });
});

describe("stream access for a deactivated person", () => {
  const me = (over: Partial<Me> = {}): Me => ({
    clerkId: "user_1", email: "x@y.com",
    isAdmin: false, isManager: false, isTeam: false, isCollector: false,
    isDeactivated: false, deactivatedAt: "",
    role: "manager", signupStatus: "",
    streamer: { id: "recDaniel", fields: {} },
    ...over,
  });
  const show = { id: "recShow", fields: { "Manager Rec Id": "recDaniel" } };

  it("lets an active manager of record in", () => {
    assert.equal(ownsStream(me({ isManager: true }), show), true);
    assert.equal(canManageStream(me({ isManager: true }), show), true);
  });

  it("shuts a deactivated manager of record out", () => {
    // the hole the role booleans alone do not close: ownsStream matches rec
    // ids, and Daniel is still manager of record on 81 shows
    const gone = me({ isDeactivated: true, deactivatedAt: GONE.deactivatedAt });
    assert.equal(ownsStream(gone, show), false);
    assert.equal(canManageStream(gone, show), false);
  });

  it("shuts out a deactivated streamer of record too", () => {
    const gone = me({ isDeactivated: true, streamer: { id: "recAlyssa", fields: {} } });
    assert.equal(ownsStream(gone, { id: "recShow", fields: { "Streamer Rec Id": "recAlyssa" } }), false);
  });
});

describe("refusing to lock the app with the key inside", () => {
  const base = { targetId: "recB", actorId: "recA", targetName: "Daniel", targetRole: "manager", otherLiveAdmins: 2 };

  it("allows the ordinary case", () => {
    assert.equal(deactivationRefusal(base), null);
  });

  it("refuses to let an admin deactivate themselves", () => {
    assert.match(String(deactivationRefusal({ ...base, targetId: "recA" })), /your own account/);
  });

  it("refuses to deactivate the last active admin", () => {
    assert.match(String(deactivationRefusal({ ...base, targetRole: "admin", otherLiveAdmins: 0 })), /only active admin/);
  });

  it("allows deactivating an admin when another one is left", () => {
    assert.equal(deactivationRefusal({ ...base, targetRole: "admin", otherLiveAdmins: 1 }), null);
  });

  it("does not count a non-admin against the admin floor", () => {
    assert.equal(deactivationRefusal({ ...base, targetRole: "manager", otherLiveAdmins: 0 }), null);
  });
});
