// Drafts are form snapshots only. This module never calls a save API or mutates artistStore.
const ARTIST_DRAFT_PREFIX = "mikes-list-artist-form-draft-v1:";
const ARTIST_VIEW_KEY = "mikes-list-artist-review-view-v1";
let activeDraftArtist = "";
let draftBase = "";
let cleanDraftForm = "";
let restoringArtistDraft = false;
const draftFieldNames = ["confidence", "displayName", "locality", "genres", "imageUrl", "imageSource", "spotifyLookupDisabled", "summary", "note"];

function readArtistDraft(id) {
  try { return JSON.parse(localStorage.getItem(ARTIST_DRAFT_PREFIX + id) || "null"); }
  catch { return null; }
}

function snapshotArtistForm() {
  const values = Object.fromEntries(draftFieldNames.map(name => [name, fields[name].type === "checkbox" ? fields[name].checked : fields[name].value]));
  const links = [...form.querySelectorAll(".link-row")].map(row => ({
    type: row.querySelector(".link-type").value,
    label: row.querySelector(".link-label").value,
    url: row.querySelector(".link-url").value,
    confidence: row.querySelector(".link-confidence").value,
    display: row.querySelector(".link-display").checked,
    displayPriority: row.querySelector(".link-priority").value,
    source: row.dataset.linkSource,
    displayOverride: row.dataset.displayOverride,
    priorityOverride: row.dataset.priorityOverride
  }));
  return { values, links };
}

function captureArtistDraft() {
  if (!activeDraftArtist || restoringArtistDraft) return;
  const snapshot = snapshotArtistForm();
  try {
    if (JSON.stringify(snapshot) === cleanDraftForm) {
      localStorage.removeItem(ARTIST_DRAFT_PREFIX + activeDraftArtist);
      document.querySelector("#draftStatus").textContent = "";
      return;
    }
    localStorage.setItem(ARTIST_DRAFT_PREFIX + activeDraftArtist, JSON.stringify({ base: draftBase, snapshot, updatedAt: new Date().toISOString() }));
    document.querySelector("#draftStatus").textContent = "Unsaved draft protected in this browser.";
  } catch {
    document.querySelector("#draftStatus").textContent = "Draft backup failed: browser storage is unavailable or full. Keep this page open and Save your work.";
  }
}

function restoreArtistDraft(artist) {
  restoringArtistDraft = true;
  activeDraftArtist = artist.id;
  draftBase = JSON.stringify(artist);
  cleanDraftForm = JSON.stringify(snapshotArtistForm());
  const draft = readArtistDraft(artist.id);
  const status = document.querySelector("#draftStatus");
  status.textContent = "";
  if (draft?.snapshot?.values && Array.isArray(draft.snapshot.links)) {
    for (const name of draftFieldNames) {
      if (!(name in draft.snapshot.values)) continue;
      if (fields[name].type === "checkbox") fields[name].checked = Boolean(draft.snapshot.values[name]);
      else fields[name].value = draft.snapshot.values[name];
    }
    fields.links.replaceChildren();
    fields.rejectedLinks.replaceChildren();
    for (const link of draft.snapshot.links) {
      const row = createLinkRow(link);
      // Preserve empty URLs/labels and explicit choices exactly as typed.
      row.querySelector(".link-label").value = link.label;
      if (link.displayOverride) row.dataset.displayOverride = link.displayOverride;
      if (link.priorityOverride) row.dataset.priorityOverride = link.priorityOverride;
      (link.confidence === "rejected" ? fields.rejectedLinks : fields.links).append(row);
    }
    fields.rejectedCount.textContent = fields.rejectedLinks.children.length;
    fields.rejectedSection.hidden = !fields.rejectedLinks.children.length;
    status.textContent = draft.base !== draftBase
      ? "Unsaved draft restored. The saved artist has changed; Save will ask before replacing it."
      : "Unsaved draft restored from this browser.";
    draftBase = draft.base;
  }
  restoringArtistDraft = false;
  saveArtistReviewView();
}

function saveArtistReviewView() {
  try { localStorage.setItem(ARTIST_VIEW_KEY, JSON.stringify(state)); } catch { /* Draft status reports storage failures. */ }
}

function restoreArtistReviewView() {
  try {
    const saved = JSON.parse(localStorage.getItem(ARTIST_VIEW_KEY) || "null");
    if (!saved) return false;
    for (const key of Object.keys(state)) if (typeof saved[key] === typeof state[key]) state[key] = saved[key];
    return true;
  } catch { return false; }
}

function requireSavedArtistDraft() {
  captureArtistDraft();
  if (activeDraftArtist && JSON.stringify(snapshotArtistForm()) !== cleanDraftForm) {
    fields.saveStatus.textContent = "Save or Discard Draft before using this action. Your draft stays in this browser.";
    return false;
  }
  return true;
}

function discardArtistDraft() {
  if (!activeDraftArtist || !window.confirm("Discard this artist’s unsaved draft and return to the saved record?")) return;
  localStorage.removeItem(ARTIST_DRAFT_PREFIX + activeDraftArtist);
  activeDraftArtist = "";
  selectArtist(state.selectedId);
}
