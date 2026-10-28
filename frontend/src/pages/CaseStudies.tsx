import React, { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { coll, myProjects, projectFloors } from "../shared/rules";
import { nextId } from "../shared/helpers";
import { buildEventOp } from "../shared/eventLog";
import { hasModuleGrant } from "../shared/permissionMatrix";
import NavIcon from "../components/NavIcon";
import SearchDropdown from "../components/SearchDropdown";
import PhotoGroupUploader from "../components/PhotoGroupUploader";
import SidePanel from "../components/SidePanel";
import Card from "../ui/tw/Card";
import Btn from "../ui/tw/Btn";
import { QC_CHECKLISTS } from "./QualityInspection";
import { uploadPhoto } from "../shared/uploadPhoto";
import type { CaseStudy, Photo, Op } from "../types";

const CATEGORY_OPTIONS = Object.keys(QC_CHECKLISTS);

/* A quality issue written up for reference/training — not a day-to-day
 * operational record like Quality Inspection, so this is its own simple
 * list + form rather than another view bolted onto that page. */
export default function CaseStudies() {
  const { data, currentUserId, myRole, apply, toast, me, caseStudyDraft, setCaseStudyDraft } = useApp();
  const isAdmin = currentUserId === "U-ADMIN";
  // Strictly its own Permission Matrix grant — see canAccessTab's "caseStudies" case.
  const canCreate = isAdmin || hasModuleGrant(data, currentUserId, "caseStudies", "create");
  const allProjects = myProjects(data, currentUserId);
  const allowedProjectCodes = new Set(allProjects.map((p) => p.code));
  const caseStudies = coll(data, "caseStudies")
    .filter((c) => !c.projectCode || allowedProjectCodes.has(c.projectCode))
    .sort((a, b) => b.createdAt - a.createdAt);

  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<CaseStudy | null>(null);
  const [openCase, setOpenCase] = useState<CaseStudy | null>(null);

  // A one-shot "Write up as Case Study" request from Fail Register — open
  // straight into the New Case Study form, pre-filled, then clear it so a
  // later unrelated visit to this page doesn't reopen it.
  useEffect(() => {
    if (!caseStudyDraft) return;
    setPanelOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseStudyDraft]);

  async function deleteCase(c: CaseStudy) {
    if (!isAdmin) return;
    if (!window.confirm(`Permanently delete this case study?\n\n${c.title}\n\nThis cannot be undone.`)) return;
    await apply([
      { op: "delete", coll: "caseStudies", id: c.id },
      buildEventOp(currentUserId, "CASE_STUDY_DELETE", c.id, "", `Deleted case study · ${c.title}`)
    ]);
    toast("Case study deleted");
    setOpenCase(null);
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mt-0.5 mb-5">
        <div className="flex gap-3 items-start min-w-0">
          <div className="w-11 h-11 shrink-0 rounded-radius-md bg-primary-light text-primary flex items-center justify-center">
            <NavIcon name="award" size={20} />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight leading-tight">Case Studies</div>
            <div className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-normal">
              Quality issue writeups — root cause, what was done about it, and what to do differently next time.
            </div>
          </div>
        </div>
        {canCreate && (
          <Btn label="＋ New Case Study" color="primary" onClick={() => { setEditing(null); setPanelOpen(true); }} />
        )}
      </div>

      {caseStudies.length === 0 ? (
        <Card className="text-center text-[13px] text-[var(--text-muted)] py-10">No case studies recorded yet.</Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {caseStudies.map((c) => (
            <Card key={c.id} className="cursor-pointer" onClick={() => setOpenCase(c)}>
              {c.photosBefore[0] && (
                <img src={c.photosBefore[0].url} className="w-full h-32 object-cover rounded-radius-sm mb-3" />
              )}
              <div className="text-[13.5px] font-bold leading-snug">{c.title}</div>
              <div className="text-[11px] text-[var(--text-muted)] mt-1">
                {c.projectCode ? `${c.projectCode} · ` : ""}{c.floorName ? `${c.floorName} · ` : ""}{new Date(c.createdAt).toLocaleDateString("en-IN")}
              </div>
              <div className="text-[12px] text-[var(--text-sub)] mt-2 line-clamp-2">{c.description}</div>
              <div className="text-[10.5px] text-[var(--text-muted)] mt-2">By {c.createdByName}</div>
            </Card>
          ))}
        </div>
      )}

      <CaseStudyForm
        open={panelOpen}
        onClose={() => { setPanelOpen(false); setCaseStudyDraft(null); }}
        data={data}
        allProjects={allProjects}
        currentUserId={currentUserId}
        authorName={me()?.name || ""}
        apply={apply}
        toast={toast}
        draft={caseStudyDraft}
      />

      {openCase && (
        <SidePanel
          open={!!openCase}
          icon={<NavIcon name="award" size={18} />}
          title={openCase.title}
          desc={`${openCase.projectName || "—"}${openCase.floorName ? " · " + openCase.floorName : ""} · ${new Date(openCase.createdAt).toLocaleDateString("en-IN")} · by ${openCase.createdByName}`}
          onClose={() => setOpenCase(null)}
          footer={isAdmin ? <button className="btn btn-secondary" onClick={() => deleteCase(openCase)}>Delete</button> : undefined}
        >
          <div className="flex flex-col gap-4">
            {openCase.category && (
              <div><div className="micro-label mb-1">Category</div><div className="text-[13px]">{openCase.category}</div></div>
            )}
            {openCase.linkedInspectionId && (
              <div><div className="micro-label mb-1">Linked Inspection</div><div className="text-[13px]">{openCase.linkedInspectionId}</div></div>
            )}
            <div><div className="micro-label mb-1">What Happened</div><div className="text-[13px] whitespace-pre-wrap">{openCase.description}</div></div>
            <div><div className="micro-label mb-1">Root Cause</div><div className="text-[13px] whitespace-pre-wrap">{openCase.rootCause}</div></div>
            <div><div className="micro-label mb-1">Corrective Action Taken</div><div className="text-[13px] whitespace-pre-wrap">{openCase.correctiveAction}</div></div>
            <div><div className="micro-label mb-1">Lessons Learned</div><div className="text-[13px] whitespace-pre-wrap">{openCase.lessonsLearned}</div></div>
            {openCase.photosBefore.length > 0 && (
              <div>
                <div className="micro-label mb-1">Before</div>
                <div className="photo-strip">{openCase.photosBefore.map((p: Photo, i: number) => (
                  <img key={i} className="photo-thumb" src={p.url} onClick={() => window.open(p.url, "_blank")} />
                ))}</div>
              </div>
            )}
            {openCase.photosAfter.length > 0 && (
              <div>
                <div className="micro-label mb-1">After</div>
                <div className="photo-strip">{openCase.photosAfter.map((p: Photo, i: number) => (
                  <img key={i} className="photo-thumb" src={p.url} onClick={() => window.open(p.url, "_blank")} />
                ))}</div>
              </div>
            )}
            {openCase.attachments && openCase.attachments.length > 0 && (
              <div>
                <div className="micro-label mb-1">Attachments</div>
                <div className="flex flex-col gap-1.5">
                  {openCase.attachments.map((a, i) => (
                    <a key={i} href={a.url} target="_blank" rel="noreferrer" className="text-[12.5px] text-[var(--theme-primary)] truncate">{a.name}</a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SidePanel>
      )}
    </div>
  );
}

/* Any file (PDF/doc/image), unlike PhotoGroupUploader which is
 * specifically for watermarked site-evidence photos. */
function AttachmentsUploader({ attachments, onChange }: { attachments: { name: string; url: string }[]; onChange: (a: { name: string; url: string }[]) => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    const uploaded = await Promise.all(
      Array.from(files).map(async (f) => ({ name: f.name, url: (await uploadPhoto(f, "caseStudies")).url }))
    );
    onChange([...attachments, ...uploaded]);
    setBusy(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label>Attachments</label>
        <span className="text-[10.5px] text-[var(--text-muted)]">optional — any file, e.g. a PDF report</span>
      </div>
      <input ref={inputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? "Uploading…" : "＋ Add file"}
      </button>
      {attachments.length > 0 && (
        <div className="flex flex-col gap-1.5 mt-2">
          {attachments.map((a, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-[12px] border border-[var(--border)] rounded-radius-sm px-2.5 py-1.5">
              <a href={a.url} target="_blank" rel="noreferrer" className="truncate">{a.name}</a>
              <button type="button" className="shrink-0" onClick={() => onChange(attachments.filter((_, ai) => ai !== i))}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CaseStudyForm({
  open, onClose, data, allProjects, currentUserId, authorName, apply, toast, draft
}: {
  open: boolean; onClose: () => void; data: any;
  allProjects: { id: string; code: string; name: string }[];
  currentUserId: string | null; authorName: string;
  apply: (ops: Op[]) => Promise<boolean>;
  toast: (msg: string) => void;
  draft?: { projectId?: string; floorId?: string; category?: string; linkedInspectionId: string } | null;
}) {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [category, setCategory] = useState("");
  const [customCategory, setCustomCategory] = useState(false);
  const [linkedInspectionId, setLinkedInspectionId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [lessonsLearned, setLessonsLearned] = useState("");
  const [photosBefore, setPhotosBefore] = useState<Photo[]>([]);
  const [photosAfter, setPhotosAfter] = useState<Photo[]>([]);
  const [attachments, setAttachments] = useState<{ name: string; url: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const floors = projectFloors(data, projectId || null);
  const project = allProjects.find((p) => p.id === projectId);
  const floor = floors.find((f) => f.id === floorId);

  function reset() {
    setTitle(""); setProjectId(""); setFloorId(""); setCategory(""); setCustomCategory(false);
    setDescription(""); setRootCause(""); setCorrectiveAction(""); setLessonsLearned("");
    setPhotosBefore([]); setPhotosAfter([]); setAttachments([]); setLinkedInspectionId(null);
  }

  // "Write up as Case Study" from Fail Register pre-fills project/floor/
  // category and links back to the exact inspection that prompted this —
  // a one-shot draft (see AppContext's caseStudyDraft), only applied the
  // moment the panel opens.
  useEffect(() => {
    if (!open) return;
    if (draft) {
      setProjectId(draft.projectId || "");
      setFloorId(draft.floorId || "");
      setCategory(draft.category && CATEGORY_OPTIONS.includes(draft.category) ? draft.category : "");
      setCustomCategory(!!draft.category && !CATEGORY_OPTIONS.includes(draft.category));
      setLinkedInspectionId(draft.linkedInspectionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function save() {
    if (!title.trim()) { toast("Title is required"); return; }
    if (!description.trim() || !rootCause.trim() || !correctiveAction.trim() || !lessonsLearned.trim()) {
      toast("Fill in What Happened, Root Cause, Corrective Action, and Lessons Learned"); return;
    }
    setSaving(true);
    const rec: CaseStudy = {
      id: nextId("CS", coll(data, "caseStudies")),
      title: title.trim(),
      projectId: projectId || undefined,
      projectCode: project?.code,
      projectName: project?.name,
      floorId: floorId || undefined,
      floorName: floor?.name,
      category: category.trim() || undefined,
      description: description.trim(),
      rootCause: rootCause.trim(),
      correctiveAction: correctiveAction.trim(),
      lessonsLearned: lessonsLearned.trim(),
      photosBefore,
      photosAfter,
      attachments,
      linkedInspectionId,
      createdByUserId: currentUserId || "",
      createdByName: authorName,
      createdAt: Date.now()
    };
    const synced = await apply([
      { op: "upsert", coll: "caseStudies", rec },
      buildEventOp(currentUserId || "", "CASE_STUDY_CREATE", rec.id, "", `Case study logged · ${rec.title}`)
    ]);
    setSaving(false);
    toast(synced ? "Case study saved" : "Saved on this device — will finish submitting once you're back online");
    reset();
    onClose();
  }

  return (
    <SidePanel
      open={open}
      wide
      icon={<NavIcon name="award" size={18} />}
      title="New Case Study"
      desc="Write up a quality issue for future reference — root cause, what was done, and what to do differently."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Case Study"}</button>
        </>
      }
    >
      <div className="form-grid">
        {linkedInspectionId && (
          <div className="field full">
            <div className="text-[11.5px] text-[var(--theme-primary)] bg-[var(--bg-subtle)] rounded-radius-sm px-2.5 py-1.5">
              Linked to inspection {linkedInspectionId} — project/floor/category pre-filled from it.
            </div>
          </div>
        )}
        <div className="field full">
          <label>Title *</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Honeycombing in RCC column, Zen Garden 6th floor" />
        </div>
        <div className="field">
          <label>Project</label>
          <SearchDropdown
            value={projectId}
            onChange={(v) => { setProjectId(v); setFloorId(""); }}
            options={[{ value: "", label: "Choose" }, ...allProjects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))]}
          />
        </div>
        <div className="field">
          <label>Floor</label>
          <SearchDropdown
            value={floorId}
            disabled={!projectId}
            onChange={setFloorId}
            options={[{ value: "", label: "Choose" }, ...floors.map((f) => ({ value: f.id, label: f.name }))]}
          />
        </div>
        <div className="field full">
          <label>Category</label>
          {!customCategory ? (
            <SearchDropdown
              value={category}
              onChange={(v) => {
                if (v === "__other__") { setCustomCategory(true); setCategory(""); }
                else setCategory(v);
              }}
              options={[{ value: "", label: "Choose" }, ...CATEGORY_OPTIONS.map((c) => ({ value: c, label: c })), { value: "__other__", label: "Other…" }]}
            />
          ) : (
            <div className="flex gap-1.5">
              <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Type category" autoFocus />
              <button type="button" className="btn btn-secondary" style={{ flexShrink: 0 }} onClick={() => { setCustomCategory(false); setCategory(""); }}>List</button>
            </div>
          )}
        </div>
        <div className="field full">
          <label>What Happened *</label>
          <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the issue" />
        </div>
        <div className="field full">
          <label>Root Cause *</label>
          <textarea className="textarea" value={rootCause} onChange={(e) => setRootCause(e.target.value)} placeholder="Why did this happen" />
        </div>
        <div className="field full">
          <label>Corrective Action Taken *</label>
          <textarea className="textarea" value={correctiveAction} onChange={(e) => setCorrectiveAction(e.target.value)} placeholder="What was done to fix it" />
        </div>
        <div className="field full">
          <label>Lessons Learned *</label>
          <textarea className="textarea" value={lessonsLearned} onChange={(e) => setLessonsLearned(e.target.value)} placeholder="What to do differently next time" />
        </div>
        <div className="field full">
          <PhotoGroupUploader label="Before photos" photos={photosBefore} onChange={setPhotosBefore} optional />
        </div>
        <div className="field full">
          <PhotoGroupUploader label="After photos" photos={photosAfter} onChange={setPhotosAfter} optional />
        </div>
        <div className="field full">
          <AttachmentsUploader attachments={attachments} onChange={setAttachments} />
        </div>
      </div>
    </SidePanel>
  );
}
