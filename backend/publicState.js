/* Allow-listed board snapshot for callers WITHOUT a valid session (see
   docs/security-public-flows.md). It has the same shape as the full state
   ({rev, data}) so the existing client code keeps working, plus `public: true`,
   but carries ONLY what the public pages (/dpr/new, /drawing-requests/new,
   /forms/:id) and the login screen actually read:

     projects         id, name, code, active            (active projects only)
     users            id, name, role, active            (DRI / SUPERVISOR only — the DPR form's name dropdown;
                                                         never email, phone, slackId, teamId, projectIds…)
     workTargets      id, projectId, category, unit, plannedQty, active
     vendors          id, vendorCode, vendorName
     dpr              id, vendorCode, vendorName        (to number the next DPR and list known contractors —
                                                         never work entries, photos or labour counts)
     drawingRequests  id, ticketNo                      (only to number the next ticket)
     forms            id, name, description, active, isPublic, fields   (public + active forms only)
     formSubmissions  id                                (only to number the next submission — never answers)

   Every other collection is an empty array, progress is {}, events is [].
   This is an ALLOW-list built with projections: a field that is not listed here
   can never reach an anonymous caller, whatever is later added to the records. */

const PUBLIC_FIELDS = {
  projects: ["id", "name", "code", "active"],
  users: ["id", "name", "role", "active"],
  workTargets: ["id", "projectId", "category", "unit", "plannedQty", "active"],
  vendors: ["id", "vendorCode", "vendorName"],
  dpr: ["id", "vendorCode", "vendorName"],
  drawingRequests: ["id", "ticketNo"],
  forms: ["id", "name", "description", "active", "isPublic", "fields"],
  formSubmissions: ["id"]
};
const PUBLIC_FILTERS = {
  projects: { active: { $ne: false } },
  users: { active: { $ne: false }, role: { $in: ["DRI", "SUPERVISOR"] } },
  forms: { isPublic: true, active: { $ne: false } }
};

const projection = (fields) => Object.fromEntries([["_id", 0], ...fields.map((f) => [f, 1])]);

async function buildPublicState(db, collectionNames, rev) {
  const data = {};
  for (const c of collectionNames) data[c] = [];
  await Promise.all(Object.keys(PUBLIC_FIELDS).map(async (c) => {
    data[c] = await db.collection(c).find(PUBLIC_FILTERS[c] || {}, { projection: projection(PUBLIC_FIELDS[c]) }).toArray();
  }));
  data.progress = {};
  data.events = [];
  return { rev, data, public: true };
}

module.exports = { buildPublicState, PUBLIC_FIELDS };
