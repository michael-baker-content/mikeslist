const suggestionStore = window.SHOW_EXPLORER_REVIEW_SUGGESTIONS || {
  summary: {},
  artists: {},
  events: {},
  venues: {}
};

const state = { group: "all" };
const list = document.querySelector("#suggestionList");
const groupButtons = [...document.querySelectorAll("[data-suggestion-group]")];

function rowsForGroup(group) {
  const groups = group === "all" ? ["artists", "events", "venues"] : [group];
  return groups.flatMap((name) => {
    return Object.entries(suggestionStore[name] || {}).flatMap(([id, suggestions]) => {
      return suggestions.map((suggestion) => ({ group: name, id, suggestion }));
    });
  });
}

function reviewHref(row) {
  if (row.group === "artists") return `review.html?artist=${encodeURIComponent(row.id)}`;
  if (row.group === "venues") return `venue-review.html?venue=${encodeURIComponent(row.id)}`;
  return `event-review.html?event=${encodeURIComponent(row.id)}`;
}

function groupLabel(group) {
  return { artists: "Artist", events: "Show", venues: "Venue" }[group] || group;
}

function valueText(value) {
  if (Array.isArray(value)) return `${value.length} source${value.length === 1 ? "" : "s"}`;
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

function renderTotals() {
  document.querySelector("#suggestionTotal").textContent = suggestionStore.summary?.totalSuggestions || 0;
  document.querySelector("#artistSuggestionTotal").textContent = suggestionStore.summary?.artistRecords || 0;
  document.querySelector("#eventSuggestionTotal").textContent = suggestionStore.summary?.eventRecords || 0;
  document.querySelector("#venueSuggestionTotal").textContent = suggestionStore.summary?.venueRecords || 0;
}

function renderButtons() {
  groupButtons.forEach((button) => {
    setPressed(button, button.dataset.suggestionGroup === state.group);
  });
}

function setPressed(button, active) {
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", active ? "true" : "false");
}

function render() {
  renderTotals();
  renderButtons();
  const rows = rowsForGroup(state.group);
  list.replaceChildren();

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No suggestions in this group.";
    list.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  rows.forEach((row) => {
    const item = document.createElement("article");
    item.className = "suggestion-card";

    const heading = document.createElement("div");
    heading.className = "suggestion-heading";
    const title = document.createElement("h2");
    title.textContent = `${groupLabel(row.group)}: ${row.id}`;
    const badge = document.createElement("span");
    badge.className = "confidence likely";
    badge.textContent = row.suggestion.confidence || "review";
    heading.append(title, badge);

    const proposed = document.createElement("p");
    proposed.className = "suggestion-value";
    proposed.textContent = `${row.suggestion.field}: ${valueText(row.suggestion.suggestedValue)}`;

    const contextNotes = document.createElement("p");
    contextNotes.className = "suggestion-note";
    contextNotes.textContent = (row.suggestion.contextNotes || []).length
      ? `Keep context note: ${(row.suggestion.contextNotes || []).join("; ")}`
      : "";
    contextNotes.hidden = !contextNotes.textContent;

    const artistRecord = document.createElement("p");
    artistRecord.className = "suggestion-note";
    artistRecord.hidden = row.suggestion.kind !== "artist-display-name" || !row.suggestion.artistRecordId;
    if (!artistRecord.hidden) {
      if (row.suggestion.artistRecordStatus === "exists") {
        const link = document.createElement("a");
        link.href = `review.html?artist=${encodeURIComponent(row.suggestion.artistRecordId)}`;
        link.textContent = row.suggestion.artistRecordId;
        artistRecord.append("Extracted artist record exists: ", link);
      } else {
        artistRecord.textContent = `Extracted artist record needed: ${row.suggestion.artistRecordId}`;
      }
    }

    const reasons = document.createElement("ul");
    reasons.className = "suggestion-reasons";
    (row.suggestion.reasons || []).forEach((reason) => {
      const item = document.createElement("li");
      item.textContent = reason;
      reasons.append(item);
    });

    const actions = document.createElement("div");
    actions.className = "admin-source-links";
    const review = document.createElement("a");
    review.href = reviewHref(row);
    review.textContent = `Open ${groupLabel(row.group)} Review`;
    actions.append(review);

    item.append(heading, proposed, contextNotes, artistRecord, reasons, actions);
    fragment.append(item);
  });
  list.append(fragment);
}

groupButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.group = button.dataset.suggestionGroup;
    render();
  });
});

render();
