import { leaveByInfo } from "./engine";
import { Trip } from "./types";

/**
 * Calendar bridge, backend-free. Two directions:
 *  IMPORT — parse an .ics file the user exports from Google/Apple/Outlook,
 *    surface upcoming events, and prefill the plan wizard from one (no
 *    OAuth, no accounts, works offline; the user stays in control of what
 *    Anchor sees).
 *  EXPORT — after a plan is locked, hand back an .ics whose event sits at
 *    the LEAVE-BY time, so the phone's own calendar becomes a backup alarm
 *    for departure even when Anchor is closed.
 */

export interface CalEvent {
  title: string;
  location?: string;
  /** Start as a Date in local time. */
  start: Date;
}

/** Unfold RFC-5545 line folding (continuation lines start with space/tab). */
function unfold(ics: string): string[] {
  return ics
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}

/** Parse an ICS DTSTART value into a local-time Date. */
function parseDt(value: string, params: string): Date | null {
  // VALUE=DATE → all-day; treat as local midnight.
  const dateOnly = /^\d{8}$/.exec(value);
  if (dateOnly || /VALUE=DATE(?!-)/.test(params)) {
    const y = +value.slice(0, 4);
    const mo = +value.slice(4, 6);
    const d = +value.slice(6, 8);
    if (!y || !mo || !d) return null;
    return new Date(y, mo - 1, d, 9, 0, 0, 0); // 9am default for all-day
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z === "Z") {
    // UTC → local
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  }
  // Floating or TZID wall-clock: treat as local time (the common intent for
  // personal appointments — imperfect across zones, correct in the usual case).
  return new Date(+y, +mo - 1, +d, +h, +mi, +s);
}

export function parseIcs(ics: string, now = new Date(), maxEvents = 25): CalEvent[] {
  const lines = unfold(ics);
  const events: CalEvent[] = [];
  let cur: Partial<CalEvent> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur?.start && cur.title) events.push(cur as CalEvent);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name, ...paramParts] = left.split(";");
    const params = paramParts.join(";");
    if (name === "SUMMARY") cur.title = unescapeText(value);
    else if (name === "LOCATION") cur.location = unescapeText(value);
    else if (name === "DTSTART") {
      const dt = parseDt(value, params);
      if (dt) cur.start = dt;
    }
  }
  const horizon = now.getTime() - 60 * 60_000; // include events up to an hour ago
  return events
    .filter((e) => e.start.getTime() >= horizon)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, maxEvents);
}

function unescapeText(s: string): string {
  return s.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

/** A destination guess from an event, preferring a short location name. */
export function destinationFrom(e: CalEvent): string {
  const loc = e.location?.split(",")[0]?.trim();
  return loc && loc.length <= 40 ? loc : e.title;
}

/** Wall-clock as UTC-stamped ICS (portable; the reminder fires at that instant). */
function toIcsUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/**
 * An .ics for the LEAVE-BY moment of a locked trip — the phone calendar as
 * a departure backup. Returns null for pickup/transit trips with no
 * self-powered door (the vehicle owns the time there).
 */
export function tripToLeaveByIcs(trip: Trip, now = new Date()): string | null {
  const info = leaveByInfo(trip, now);
  if (!info) return null;
  const start = new Date(info.doorAt);
  const end = new Date(start.getTime() + 5 * 60_000);
  const uid = `anchor-${trip.id}@anchor.app`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Anchor//Leave-by//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtc(now)}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeText(`Leave for ${trip.destination}`)}`,
    `DESCRIPTION:${escapeText(
      `Out the door now to arrive on time. Anchor plan for ${trip.destination}.`,
    )}`,
    "BEGIN:VALARM",
    "TRIGGER:PT0M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(`Leave for ${trip.destination}`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/** Trigger a client-side download of an .ics string. */
export function downloadIcs(filename: string, ics: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
