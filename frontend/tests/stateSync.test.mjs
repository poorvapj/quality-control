// Tests for src/shared/stateSync.ts — what the client does with a full vs. public-snapshot response.
//   cd frontend && node --test tests/stateSync.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { judgeStateResponse, needsFullBoardAfterLogin } from "../src/shared/stateSync.ts";

const ctx = (o = {}) => ({ publicRoute: false, hasToken: false, haveBoard: false, ...o });

test("a normal full response is always used", () => {
  for (const c of [ctx(), ctx({ hasToken: true, haveBoard: true }), ctx({ publicRoute: true })]) {
    assert.deepEqual(judgeStateResponse({ rev: 1 }, c), { use: true, sessionExpired: false });
  }
});

test("a public snapshot on a public page (DPR / drawing request / form) is used, even if a token is stored", () => {
  assert.deepEqual(judgeStateResponse({ public: true }, ctx({ publicRoute: true })), { use: true, sessionExpired: false });
  assert.deepEqual(judgeStateResponse({ public: true }, ctx({ publicRoute: true, hasToken: true, haveBoard: true })), { use: true, sessionExpired: false });
});

test("signed out, normal page: the snapshot is used (it is what the sign-in screen renders from)", () => {
  assert.deepEqual(judgeStateResponse({ public: true }, ctx()), { use: true, sessionExpired: false });
});

test("signed in (token stored) but the server answered with a public snapshot = session expired: the board on screen is NOT replaced", () => {
  assert.deepEqual(judgeStateResponse({ public: true }, ctx({ hasToken: true, haveBoard: true })), { use: false, sessionExpired: true });
});

test("expired token on first load: the snapshot is used for the sign-in screen, and the stale token is flagged for removal", () => {
  assert.deepEqual(judgeStateResponse({ public: true }, ctx({ hasToken: true, haveBoard: false })), { use: true, sessionExpired: true });
});

test("no response: nothing is used", () => {
  assert.deepEqual(judgeStateResponse(null, ctx()), { use: false, sessionExpired: false });
});

test("after sign-in: no extra board fetch when the last state response was the full board (flags OFF = the normal case)", () => {
  assert.equal(needsFullBoardAfterLogin(false), false);
});

test("after sign-in: fetch the full board when the last response was a public snapshot, or when none has been seen yet", () => {
  assert.equal(needsFullBoardAfterLogin(true), true);
  assert.equal(needsFullBoardAfterLogin(null), true);
});
