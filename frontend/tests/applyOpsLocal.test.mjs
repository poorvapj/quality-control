// Regression tests for src/shared/applyOpsLocal.ts (the optimistic local update) — in particular that a
// plaintext password never stays in the writer's local board, while every other behaviour is unchanged.
//   cd frontend && node --test tests/applyOpsLocal.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { applyOpsLocal, localRecord, scrubLocalBoard } from "../src/shared/applyOpsLocal.ts";

const SECRET = "S3cret-PLAINTEXT-pw!";
const board = () => ({ users: [{ id: "USR-0001", name: "Old Name", email: "a@x.test", role: "CIVIL", active: true }], snags: [], progress: {}, events: [], forms: [] });

/* The ORIGINAL implementation, verbatim from before this change — used as the oracle for parity. */
function applyOpsLocalOriginal(d, ops) {
  for (const op of ops) {
    if (op.op === "upsert") {
      const list = (d[op.coll] = d[op.coll] || []);
      const i = list.findIndex((r) => r.id === op.rec.id);
      const merged = i === -1 ? op.rec : Object.assign({}, list[i], op.rec);
      for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
      if (i === -1) list.push(merged);
      else list[i] = merged;
    } else if (op.op === "delete") {
      d[op.coll] = (d[op.coll] || []).filter((r) => r.id !== op.id);
    } else if (op.op === "progress") {
      const next = Object.assign({}, d.progress[op.key] || {}, op.patch);
      for (const k of Object.keys(next)) if (next[k] === null) delete next[k];
      d.progress[op.key] = next;
    } else if (op.op === "event") {
      d.events.unshift(op.ev);
      if (d.events.length > 5000) d.events.length = 5000;
    }
  }
}

test("creating a user: the password is NOT in the local board, in its JSON snapshot, or anywhere in state", () => {
  const d = board();
  const ops = [{ op: "upsert", coll: "users", rec: { id: "USR-0002", name: "New", email: "n@x.test", role: "CIVIL", password: SECRET, active: true } }];
  applyOpsLocal(d, ops);
  const u = d.users.find((x) => x.id === "USR-0002");
  assert.ok(u, "the user still appears locally (optimistic update intact)");
  assert.equal("password" in u, false);
  assert.equal(JSON.stringify(d).includes(SECRET), false, "not in the serialized snapshot that persistLocal writes to localStorage");
  assert.deepEqual({ ...u }, { id: "USR-0002", name: "New", email: "n@x.test", role: "CIVIL", active: true }, "every other field is kept");
});

test("the OPS themselves still carry the password, so the server request and an offline-queued batch can still deliver it", () => {
  const d = board();
  const ops = [{ op: "upsert", coll: "users", rec: { id: "USR-0002", name: "New", password: SECRET } }];
  applyOpsLocal(d, ops);
  assert.equal(ops[0].rec.password, SECRET, "op.rec is not modified");
  assert.ok(JSON.stringify({ ops }).includes(SECRET), "what is sent / queued still has it");
});

test("editing an existing user (reset password): merged without the password, other fields preserved", () => {
  const d = board();
  applyOpsLocal(d, [{ op: "upsert", coll: "users", rec: { id: "USR-0001", name: "Renamed", password: SECRET } }]);
  assert.deepEqual({ ...d.users[0] }, { id: "USR-0001", name: "Renamed", email: "a@x.test", role: "CIVIL", active: true });
  assert.equal(JSON.stringify(d).includes(SECRET), false);
});

test("an empty password field (Masters: 'leave blank to keep the current one') is stripped too and changes nothing else", () => {
  const d = board();
  applyOpsLocal(d, [{ op: "upsert", coll: "users", rec: { id: "USR-0001", name: "X", password: "" } }]);
  assert.equal("password" in d.users[0], false);
  assert.equal(d.users[0].name, "X");
});

test("ONLY the users collection is special-cased: a 'password' key in any other record is untouched", () => {
  const d = board();
  applyOpsLocal(d, [{ op: "upsert", coll: "forms", rec: { id: "F1", name: "f", password: "kept-because-not-a-user" } }]);
  assert.equal(d.forms[0].password, "kept-because-not-a-user");
  assert.equal(localRecord("snags", { id: "s", password: "x" }).password, "x");
});

test("PARITY: for every other kind of operation the result is identical to the original implementation (randomized, 500 batches)", () => {
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  for (let n = 0; n < 500; n++) {
    const ops = [];
    for (let k = 0; k < 1 + Math.floor(rnd() * 5); k++) {
      const kind = pick(["upsert", "upsert", "delete", "progress", "event"]);
      const id = "R" + Math.floor(rnd() * 6);
      if (kind === "upsert") ops.push({ op: "upsert", coll: pick(["snags", "forms", "assignments", "users"]), rec: { id, title: "t" + Math.floor(rnd() * 3), note: rnd() < 0.3 ? null : "n", ...(rnd() < 0.3 ? { password: SECRET } : {}) } });
      else if (kind === "delete") ops.push({ op: "delete", coll: pick(["snags", "forms", "users"]), id });
      else if (kind === "progress") ops.push({ op: "progress", key: "U" + Math.floor(rnd() * 4) + "::S1", patch: { done: rnd() < 0.5, at: rnd() < 0.3 ? null : 1 } });
      else ops.push({ op: "event", ev: { ts: n * 10 + k, action: "A", userId: "U", targetId: id, stageId: "", detail: "" } });
    }
    const a = board(), b = board();
    applyOpsLocal(a, structuredClone(ops));
    applyOpsLocalOriginal(b, structuredClone(ops));
    // the only permitted difference: no `password` key on user records in the new implementation
    for (const u of b.users) delete u.password;
    assert.deepEqual(a, b, "batch " + n);
  }
});

test("event cap (5000), null-unset, delete and progress behave exactly as before", () => {
  const d = board(); d.events = Array.from({ length: 5000 }, (_, i) => ({ ts: i }));
  applyOpsLocal(d, [{ op: "event", ev: { ts: 99999 } }, { op: "upsert", coll: "snags", rec: { id: "s1", a: 1, b: null } }, { op: "progress", key: "k", patch: { x: 1, y: null } }]);
  assert.equal(d.events.length, 5000); assert.equal(d.events[0].ts, 99999);
  assert.deepEqual(d.snags[0], { id: "s1", a: 1 }); assert.deepEqual(d.progress.k, { x: 1 });
  applyOpsLocal(d, [{ op: "delete", coll: "snags", id: "s1" }]); assert.equal(d.snags.length, 0);
});

test("scrubLocalBoard removes a password an older version may have cached, and tolerates anything else", () => {
  const cached = { users: [{ id: "U1", name: "A", password: SECRET }, { id: "U2", name: "B" }], snags: [] };
  scrubLocalBoard(cached);
  assert.equal(JSON.stringify(cached).includes(SECRET), false);
  assert.equal(cached.users[1].name, "B");
  assert.equal(scrubLocalBoard(null), null);
  assert.deepEqual(scrubLocalBoard({ snags: [] }), { snags: [] });
  assert.deepEqual(scrubLocalBoard({ users: [null, 5, "x"] }), { users: [null, 5, "x"] });
});
