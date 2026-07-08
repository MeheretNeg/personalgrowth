import { BUFFERS } from "./priors";
import { PlannedTask, TimelineStep, TransitDetails, Trip } from "./types";

/**
 * The backward-planning engine (Park et al. 2017: planning in reverse from
 * the goal outperforms forward planning). Pure functions, no UI, no storage —
 * so a live traffic/transit API can be injected later without touching screens.
 *
 * All math anchors on the TARGET arrival: required arrival minus the early
 * buffer. Early is the new on time.
 */

export interface TimelineInput {
  /** Required arrival, as a Date. */
  arrival: Date;
  earlyBufferMinutes: number;
  transit: TransitDetails;
  tasks: PlannedTask[];
}

export interface TimelineResult {
  steps: TimelineStep[];
  /** When the very first prep task must start. */
  startAt: Date;
  /** When the user must be out the door (or ready at it). */
  leaveDoorAt: Date;
  targetArrival: Date;
}

const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

export function formatTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Parse "HH:mm" onto the same calendar day as `reference`. */
export function timeOnSameDay(hhmm: string, reference: Date): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(reference);
  d.setHours(h, m, 0, 0);
  return d;
}

interface BackwardBlock {
  kind: TimelineStep["kind"];
  label: string;
  minutes: number;
  ifThenVerb: string;
  taskId?: string;
}

/**
 * Mode-specific chain between "out the door" and the anchor, in forward
 * chronological order. The anchor is the moment the user stops controlling
 * time: target arrival (driving), transit departure, or pickup time.
 */
function travelChain(transit: TransitDetails): BackwardBlock[] {
  switch (transit.mode) {
    case "driving":
      return [
        { kind: "staging", label: "Staged at the door", minutes: BUFFERS.doorstepStaging, ifThenVerb: "stand at the door with everything in hand" },
        { kind: "travel", label: "Walk to car", minutes: BUFFERS.walkToCar, ifThenVerb: "walk out and get in the car" },
        { kind: "travel", label: "Drive", minutes: transit.driveMinutes ?? 0, ifThenVerb: "start driving", taskId: "drive" },
        { kind: "travel", label: "Park + walk in", minutes: BUFFERS.parking, ifThenVerb: "start looking for parking" },
      ];
    case "walking":
      return [
        { kind: "staging", label: "Staged at the door", minutes: BUFFERS.doorstepStaging, ifThenVerb: "stand at the door with everything in hand" },
        { kind: "travel", label: "Walk", minutes: transit.walkMinutes ?? 0, ifThenVerb: "walk out and keep moving", taskId: "walk" },
        { kind: "travel", label: "Cross + find the door", minutes: BUFFERS.walkArrival, ifThenVerb: "look for the entrance" },
      ];
    case "pickingUp":
      return [
        { kind: "staging", label: "Staged at the door", minutes: BUFFERS.doorstepStaging, ifThenVerb: "stand at the door with everything in hand" },
        { kind: "travel", label: "Walk to car", minutes: BUFFERS.walkToCar, ifThenVerb: "walk out and get in the car" },
        { kind: "travel", label: "Drive", minutes: transit.driveMinutes ?? 0, ifThenVerb: "start driving", taskId: "drive" },
        { kind: "travel", label: "Pull up curbside", minutes: BUFFERS.curbside, ifThenVerb: "pull up where they can see me" },
      ];
    case "transit":
      return [
        { kind: "staging", label: "Staged at the door", minutes: BUFFERS.doorstepStaging, ifThenVerb: "stand at the door with everything in hand" },
        { kind: "travel", label: "Walk to stop", minutes: transit.walkToStopMinutes ?? 10, ifThenVerb: "start walking to the stop" },
        { kind: "travel", label: "Wait at stop", minutes: BUFFERS.platform, ifThenVerb: "be standing at the stop" },
      ];
    case "pickup":
      // Never make the driver wait: fully ready at the door 10 min early.
      return [
        { kind: "staging", label: "Wait at the door, ready", minutes: BUFFERS.pickupStaging, ifThenVerb: "be completely ready and waiting at the door" },
      ];
  }
}

/**
 * A departure/pickup clock-time must land BEFORE the arrival it serves.
 * Without this, planning at 23:00 for a 00:30 arrival puts the 23:45 bus a
 * full day late — timeline, wake-up and every cue silently wrong.
 */
function rollBeforeArrival(anchor: Date, arrival: Date): Date {
  const a = new Date(anchor);
  while (a.getTime() > arrival.getTime()) a.setDate(a.getDate() - 1);
  while (a.getTime() <= arrival.getTime() - 24 * 3600_000) a.setDate(a.getDate() + 1);
  return a;
}

/** The moment the travel chain must END at, per mode. */
function anchorTime(input: TimelineInput, targetArrival: Date): Date {
  const { transit } = input;
  if (transit.mode === "transit" && transit.transitDepartureTime) {
    // Anchored to the vehicle's departure — arrival math is the schedule's job.
    return rollBeforeArrival(timeOnSameDay(transit.transitDepartureTime, input.arrival), input.arrival);
  }
  if (transit.mode === "pickup" && transit.pickupTime) {
    return rollBeforeArrival(timeOnSameDay(transit.pickupTime, input.arrival), input.arrival);
  }
  return targetArrival;
}

export function buildTimeline(input: TimelineInput): TimelineResult {
  const targetArrival = addMinutes(input.arrival, -input.earlyBufferMinutes);
  const anchor = anchorTime(input, targetArrival);

  const prepBlocks: BackwardBlock[] = input.tasks.map((t) => ({
    kind: "prep",
    label: t.label,
    minutes: t.plannedMinutes,
    ifThenVerb: `start "${t.label.toLowerCase()}" — nothing else first`,
    taskId: t.taskId,
  }));

  const blocks = [...prepBlocks, ...travelChain(input.transit)];

  // Walk backward from the anchor assigning times, then flip forward.
  let end = anchor;
  const reversed: TimelineStep[] = [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    const start = addMinutes(end, -b.minutes);
    reversed.push({
      id: `step-${i}`,
      kind: b.kind,
      label: b.label,
      ifThen: `When the ${formatTime(start)} alert fires, then I ${b.ifThenVerb}.`,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      plannedMinutes: b.minutes,
      taskId: b.taskId,
    });
    end = start;
  }
  const steps = reversed.reverse();

  const firstTravel = steps.find((s) => s.kind !== "prep");
  return {
    steps,
    startAt: new Date(steps[0].startsAt),
    leaveDoorAt: firstTravel ? new Date(firstTravel.startsAt) : anchor,
    targetArrival,
  };
}

/** Signed minutes between now and a step boundary (negative = behind). */
export function minutesUntil(iso: string, now: Date): number {
  return (new Date(iso).getTime() - now.getTime()) / 60_000;
}

export interface LeaveByInfo {
  /** When you must be walking out the door (ISO). */
  doorAt: string;
  /** Signed minutes until the door deadline (negative = already past it). */
  minsUntilDoor: number;
  /** Required arrival time (Date). */
  requiredArrival: Date;
  /** Leaving right now, when you'd arrive. */
  arriveIfLeaveNow: Date;
  /** Minutes you'd be LATE if you left now (0 if still early). */
  lateIfLeaveNow: number;
  /** Minutes of early-cushion still intact before you tip into late. */
  cushionLeftMin: number;
}

/**
 * The single most important number for a time-blind user: leave-by. Every
 * block before the door can be rushed or cut; once travel starts, the
 * arrival time is fixed. This computes the door deadline and the concrete
 * consequence of missing it — arrival math, not vibes.
 *
 * Anchored on the first self-powered travel step. Pickup/transit modes
 * where the vehicle is the anchor return null (the schedule owns the time,
 * and the app already warns if the departure is after arrival).
 */
export function leaveByInfo(trip: Trip, now: Date): LeaveByInfo | null {
  // Transit and pickup are anchored to a vehicle, not a self-powered door —
  // a "leave-by / cushion" frame is meaningless (and misleading) once the
  // bus has left. The app already warns if the departure is after arrival.
  if (trip.transit.mode === "transit" || trip.transit.mode === "pickup") return null;
  const doorStep = trip.timeline.find((s) => s.kind === "travel");
  if (!doorStep) return null;
  const doorAt = new Date(doorStep.startsAt);
  const last = trip.timeline[trip.timeline.length - 1];
  // Fixed travel duration from the door to the arrival anchor.
  const travelMs = new Date(last.endsAt).getTime() - doorAt.getTime();
  const requiredArrival = new Date(trip.arrivalTime);
  const arriveIfLeaveNow = new Date(Math.max(now.getTime(), doorAt.getTime()) + travelMs);
  const lateMs = arriveIfLeaveNow.getTime() - requiredArrival.getTime();
  return {
    doorAt: doorStep.startsAt,
    minsUntilDoor: minutesUntil(doorStep.startsAt, now),
    requiredArrival,
    arriveIfLeaveNow,
    lateIfLeaveNow: Math.max(0, Math.round(lateMs / 60_000)),
    cushionLeftMin: Math.round(-lateMs / 60_000),
  };
}

/**
 * Recovery move: when the plan has collapsed mid-execution, rebuild the
 * remaining timeline against the SAME anchor, optionally dropping prep
 * tasks. Failure routes back into the loop instead of out of it — a
 * winnable schedule beats a dead one being nagged about.
 */
export function rebuildRemaining(
  timeline: TimelineStep[],
  fromIndex: number,
  keepStepIds: Set<string>,
): { timeline: TimelineStep[]; startAt: Date } {
  const remaining = timeline.slice(fromIndex);
  // Keyed by step id, not taskId — freeform tasks can share a taskId, so
  // cutting one must not cut its sibling.
  const kept = remaining.filter((s) => s.kind !== "prep" || keepStepIds.has(s.id));
  // The anchor is immovable: walk backward from the original chain end.
  let end = new Date(remaining[remaining.length - 1].endsAt);
  const rebuilt: TimelineStep[] = [];
  for (let i = kept.length - 1; i >= 0; i--) {
    const s = kept[i];
    const start = addMinutes(end, -s.plannedMinutes);
    rebuilt.push({
      ...s,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      ifThen: `When the ${formatTime(start)} alert fires, then I start "${s.label.toLowerCase()}" — nothing else first.`,
      // A block already in flight keeps its real start — resetting it would
      // re-log a 15-minute shower as 2 minutes and bias the medians short.
      startedAt: kept[i] === remaining[0] ? s.startedAt : undefined,
      finishedAt: undefined,
    });
    end = start;
  }
  rebuilt.reverse();
  return {
    timeline: [...timeline.slice(0, fromIndex), ...rebuilt],
    startAt: new Date(rebuilt[0].startsAt),
  };
}
