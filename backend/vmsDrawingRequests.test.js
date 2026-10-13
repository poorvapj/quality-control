const assert = require("assert");
const { getVmsDrawingRequests, shapeRequests } = require("./vmsDrawingRequests.js");

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log("  ok -", name); })
    .catch((e) => { console.error("  FAIL -", name, "\n   ", e.message); process.exitCode = 1; });
}
const arr = (rows) => ({ find: () => ({ toArray: async () => rows }) });

// Fixtures shaped like VMS's drawingrequests documents.
const docs = [
  { ticketNo: "DR-0009", projectId: "p1", projectName: "Nature park tower", description: "Elec", driName: "Ayush", reviewStatus: "l2-architect", status: "pending", createdAt: new Date("2026-10-01T08:00:00Z") },
  { ticketNo: "DR-0011", projectId: "p2", projectName: "Zen Garden", description: "Slab", driName: "Rishabh", reviewStatus: "l2-architect", status: "pending", createdAt: new Date("2026-10-12T09:00:00Z") },
  { ticketNo: "DR-0002", projectId: "p9", projectName: "Old", description: "x", driName: "N", reviewStatus: "approved", status: "completed", createdAt: new Date("2026-08-07T00:00:00Z") }
];
const projects = [{ _id: "p1", code: "PRJ-003" }, { _id: "p2", code: "PRJ-013" }];

(async () => {
  await test("shapes VMS tickets: newest first, createdAt in ms, project code joined from VMS projects", () => {
    const r = shapeRequests(docs, projects);
    assert.deepStrictEqual(r.map((x) => x.ticketNo), ["DR-0011", "DR-0009", "DR-0002"]);
    assert.strictEqual(r[0].projectCode, "PRJ-013");
    assert.strictEqual(r[0].createdAt, new Date("2026-10-12T09:00:00Z").getTime());
    assert.strictEqual(r[0].reviewStatus, "l2-architect"); // VMS's own stage, untouched
  });
  await test("a ticket whose VMS project can't be resolved keeps its name but gets an empty code (never a guess)", () => {
    const r = shapeRequests(docs, projects).find((x) => x.ticketNo === "DR-0002");
    assert.strictEqual(r.projectCode, "");
    assert.strictEqual(r.projectName, "Old");
  });
  await test("getVmsDrawingRequests reads through an injected VMS db and only reads", async () => {
    const db = { collection: (n) => (n === "drawingrequests" ? arr(docs) : n === "projects" ? arr(projects) : (() => { throw new Error("unexpected " + n); })()) };
    const out = await getVmsDrawingRequests(db);
    assert.strictEqual(out.available, true);
    assert.strictEqual(out.requests.length, 3);
  });
  await test("no VMS connection -> available:false with a reason, not a crash", async () => {
    const saved = process.env.SOURCE_MONGO_URI; delete process.env.SOURCE_MONGO_URI;
    const out = await getVmsDrawingRequests();
    if (saved) process.env.SOURCE_MONGO_URI = saved;
    assert.strictEqual(out.available, false);
    assert.deepStrictEqual(out.requests, []);
  });
  console.log(`\n${passed} passed`);
})();
