import { BUFFERS } from "./priors";
import { PlannedTask, TimelineStep, TransitDetails } from "./types";

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

/** The moment the travel chain must END at, per mode. */
function anchorTime(input: TimelineInput, targetArrival: Date): Date {
  const { transit } = input;
  if (transit.mode === "transit" && transit.transitDepartureTime) {
    // Anchored to the vehicle's departure — arrival math is the schedule's job.
    return timeOnSameDay(transit.transitDepartureTime, input.arrival);
  }
  if (transit.mode === "pickup" && transit.pickupTime) {
    return timeOnSameDay(transit.pickupTime, input.arrival);
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
