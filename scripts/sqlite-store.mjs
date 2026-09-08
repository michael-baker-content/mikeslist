import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

export const DEFAULT_DB_PATH = "data/mikeslist.sqlite";
const require = createRequire(import.meta.url);

export function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

export async function readWindowData(path, globalName, fallback) {
  try {
    const text = await readFile(path, "utf8");
    const match = text.match(new RegExp(`window\\.${globalName}\\s*=\\s*([\\s\\S]*);\\s*$`));
    return match ? JSON.parse(match[1]) : fallback;
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export function openDatabase(path = DEFAULT_DB_PATH) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export async function applySchema(db) {
  const schema = await readFile(new URL("../data/sqlite/schema.sql", import.meta.url), "utf8");
  db.exec(schema);
}

export function json(value) {
  return JSON.stringify(value ?? null);
}

export function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function fingerprint(value) {
  return createHash("sha256").update(json(value)).digest("hex");
}

export function slugify(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function showTypeForEvent(event) {
  if (event.showType === "event" || event.showType === "artist") return event.showType;
  return (event.artists || []).length ? "artist" : "event";
}

export function sourceNameForEvent(event) {
  const source = event.source || (event.sources || [])[0] || {};
  return sourceNameForSource(source, event.sourceUrl || "");
}

export function sourceNameForSource(source = {}, fallbackUrl = "") {
  const name = String(source.name || "").trim();
  if (name && name.toLowerCase() !== "source") return name;
  const url = String(source.url || fallbackUrl || "").toLowerCase();
  if (url.includes("kalx.berkeley.edu")) return "KALX";
  if (url.includes("jon.luini.com")) return "The List";
  return "Imported";
}

export function eventTitle(event) {
  return event.displayName
    || event.title
    || (event.artists || []).map((artist) => artist.displayName || artist.name).filter(Boolean).join(", ")
    || event.details
    || event.id;
}

export function primaryArtistName(event) {
  return (event.artists || [])
    .map((artist) => artist.displayName || artist.name)
    .find(Boolean) || "";
}

export function suppressionFieldsForEvent(event) {
  return {
    sourceName: sourceNameForEvent(event),
    sourceUrl: event.sourceUrl || event.source?.url || (event.sources || [])[0]?.url || "",
    sourceEventId: event.id || "",
    eventDate: event.date || "",
    venueKey: slugify(event.venueId || event.venue || ""),
    artistKey: slugify(primaryArtistName(event) || event.title || event.displayName || event.details || "")
  };
}
