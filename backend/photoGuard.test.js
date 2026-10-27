/* Plain-Node tests for photoGuard.js. Run with: node photoGuard.test.js */
const assert = require("assert");
const { createPhotoGuard, clientIp, decodedBytes } = require("./photoGuard.js");

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log("  ok -", name); })
    .catch((e) => { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; });
}
const small = "data:image/jpeg;base64," + Buffer.alloc(300 * 1024, 1).toString("base64");
const huge = "data:image/jpeg;base64," + Buffer.alloc(8 * 1024 * 1024 + 10, 1).toString("base64");
const anon = (over = {}) => ({ session: null, type: "dpr", dataUrl: small, ip: "1.1.1.1", ...over });

async function main() {
  await test("decodedBytes", () => {
    assert.strictEqual(decodedBytes("data:image/png;base64," + Buffer.alloc(10).toString("base64")), 10);
    assert.strictEqual(decodedBytes("data:image/png;base64," + Buffer.alloc(1000).toString("base64")), 1000);
  });
  await test("signed-in callers are never limited or restricted (any type, any size, any rate)", () => {
    const g = createPhotoGuard();
    for (let i = 0; i < 500; i++) assert.ok(g.check({ session: { userId: "U" }, type: "qc", dataUrl: huge, ip: "1.1.1.1" }).ok);
    assert.ok(g.check({ session: { userId: "U" }, type: "caseStudies", dataUrl: "data:application/pdf;base64,AAAA", ip: "x" }).ok);
  });
  await test("anonymous DPR photo within limits is allowed", () => assert.ok(createPhotoGuard().check(anon()).ok));
  await test("anonymous upload of any other type is refused with 401", () => {
    for (const type of ["qc", "snags", "progress", "drawings", "caseStudies", undefined]) {
      const r = createPhotoGuard().check(anon({ type }));
      assert.deepStrictEqual([r.ok, r.status], [false, 401], String(type));
    }
  });
  await test("anonymous PDF / non-image refused (400); oversize refused (413)", () => {
    assert.strictEqual(createPhotoGuard().check(anon({ dataUrl: "data:application/pdf;base64,AAAA" })).status, 400);
    assert.strictEqual(createPhotoGuard().check(anon({ dataUrl: huge })).status, 413);
  });
  await test("per-IP limit: 20 allowed, the 21st is 429 with Retry-After; another IP is unaffected; window expiry frees it", () => {
    let t = 1_000_000; const g = createPhotoGuard({}, () => t);
    for (let i = 0; i < 20; i++) { assert.ok(g.check(anon()).ok); t += 1000; }
    const r = g.check(anon());
    assert.deepStrictEqual([r.ok, r.status], [false, 429]);
    assert.ok(r.retryAfterSec > 0 && r.retryAfterSec <= 600);
    assert.ok(g.check(anon({ ip: "2.2.2.2" })).ok);
    t += 10 * 60 * 1000;
    assert.ok(g.check(anon()).ok, "allowed again after the 10-minute window");
  });
  await test("global limit: 300 per hour across different IPs, then 429 for everyone anonymous (spoofed IPs don't help)", () => {
    let t = 5_000_000; const g = createPhotoGuard({}, () => t);
    for (let i = 0; i < 300; i++) assert.ok(g.check(anon({ ip: "10.0." + (i >> 8) + "." + (i & 255) })).ok, "i=" + i);
    const r = g.check(anon({ ip: "9.9.9.9" }));
    assert.deepStrictEqual([r.ok, r.status], [false, 429]);
    assert.ok(g.check({ session: { userId: "U" }, type: "qc", dataUrl: small, ip: "9.9.9.9" }).ok, "signed-in users unaffected");
    t += 3600 * 1000;
    assert.ok(g.check(anon({ ip: "9.9.9.9" })).ok);
  });
  await test("only allowed uploads are counted, so refused requests cannot grow memory", () => {
    const g = createPhotoGuard();
    for (let i = 0; i < 1000; i++) g.check(anon({ ip: "ip" + i, type: "qc" }));
    for (let i = 0; i < 1000; i++) g.check(anon({ ip: "ip" + i, dataUrl: huge }));
    assert.deepStrictEqual(g._size(), { ips: 0, global: 0 });
  });
  await test("clientIp: leftmost by default, Nth-from-right when configured, socket fallback", () => {
    const req = { headers: { "x-forwarded-for": "203.0.113.5, 10.1.1.1, 10.2.2.2" }, socket: { remoteAddress: "10.9.9.9" } };
    assert.strictEqual(clientIp(req, 0), "203.0.113.5");
    assert.strictEqual(clientIp(req, 1), "10.2.2.2");
    assert.strictEqual(clientIp(req, 3), "203.0.113.5");
    assert.strictEqual(clientIp({ headers: {}, socket: { remoteAddress: "10.9.9.9" } }, 0), "10.9.9.9");
  });
  console.log(`\n${passed} passed`);
  if (process.exitCode) { console.error("SOME TESTS FAILED"); process.exit(1); }
}
main();
