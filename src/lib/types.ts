export type TransitMode = "driving" | "walking" | "transit" | "pickup" | "pickingUp";

export type GraduationLevel = 1 | 2 | 3 | 4;

/** A prep task the user selected for a trip, with their guess-first estimate. */
export interface PlannedTask {
  taskId: string;
  label: string;
  /** The user's blind guess, in minutes — captured before any prior was shown. */
  guessMinutes: number;
  /** What the plan actually allocates (guess, prior, or personal median). */
  plannedMinutes: number;
  /** Where plannedMinutes came from — shown in the debrief and stats. */
  source: "guess" | "prior" | "history";
}

export interface TransitDetails {
  mode: TransitMode;
  /** Driving / picking someone up: estimated drive minutes (guess-first). */
  driveMinutes?: number;
  /** Walking: estimated door-to-door walk minutes (guess-first). */
  walkMinutes?: number;
  /** Public transit: the departure time of the bus/train (HH:mm). */
  transitDepartureTime?: string;
  /** Public transit: walk from door to the stop, minutes. */
  walkToStopMinutes?: number;
  /** Being picked up: when the driver arrives (HH:mm). */
  pickupTime?: string;
}

export type TripPhase = "planning" | "locked" | "executing" | "debrief" | "done";

export interface TimelineStep {
  id: string;
  kind: "prep" | "staging" | "travel" | "anchor";
  label: string;
  /** Implementation-intention phrasing: "When X, then I Y." */
  ifThen: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  plannedMinutes: number;
  /** Runtime state during execution. */
  startedAt?: string;
  finishedAt?: string;
  taskId?: string;
}

export interface Trip {
  id: string;
  destination: string;
  /** Required arrival time (ISO). */
  arrivalTime: string;
  /** "Early is the new on time": minutes before arrivalTime we actually target. */
  earlyBufferMinutes: number;
  transit: TransitDetails;
  tasks: PlannedTask[];
  phase: TripPhase;
  timeline: TimelineStep[];
  currentStepIndex: number;
  lockedAt?: string;
}

/** One silent measurement of how long a task actually took. */
export interface DurationLog {
  taskId: string;
  guessMinutes: number;
  actualMinutes: number;
  at: string; // ISO
}

/** Post-arrival reflection — the input for the LEARN phase. */
export interface Debrief {
  tripId: string;
  destination: string;
  at: string; // ISO
  /** Minutes relative to required arrival. Negative = early. */
  deltaMinutes: number;
  causes: string[];
  note?: string;
}

export interface Settings {
  earlyBufferMinutes: number;
  level: GraduationLevel;
}
