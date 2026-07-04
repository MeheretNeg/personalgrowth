import { calibrationScore } from "./calibration";
import { Debrief, DurationLog, GraduationLevel } from "./types";

/**
 * FADE: graduation-level automation. The level is not a badge — it is how
 * much scaffolding Anchor still gives you, and it is EARNED from measured
 * reality (clock score + on-time streak), never self-selected. Levels move
 * one step per debrief in either direction: slow to climb, gentle to fall.
 */

export interface LevelSpec {
  name: string;
  /** What Anchor still does for you at this level. */
  means: string;
  /** Requirements to EARN this level (level 1 is the floor — none). */
  minScore: number;
  minLogs: number;
  /** Consecutive most-recent arrivals that were on time or early. */
  minStreak: number;
}

export const LEVELS: Record<GraduationLevel, LevelSpec> = {
  1: {
    name: "Scaffold",
    means: "Anchor computes everything. You guess first, every time — that's the rep.",
    minScore: 0,
    minLogs: 0,
    minStreak: 0,
  },
  2: {
    name: "Coach",
    means: "Your guess is the plan. Anchor only steps in when a guess is far off your record.",
    minScore: 65,
    minLogs: 10,
    minStreak: 3,
  },
  3: {
    name: "Solo",
    means: "You plan on your own numbers. Anchor measures silently and only guards the door.",
    minScore: 80,
    minLogs: 25,
    minStreak: 5,
  },
  4: {
    name: "Graduated",
    means: "Anchor is a scoreboard. You are the clock.",
    minScore: 90,
    minLogs: 50,
    minStreak: 10,
  },
};

/** Consecutive most-recent debriefs at or before the required time. */
export function onTimeStreak(debriefs: Debrief[]): number {
  let streak = 0;
  for (let i = debriefs.length - 1; i >= 0; i--) {
    if (debriefs[i].deltaMinutes > 0) break;
    streak++;
  }
  return streak;
}

/** The highest level the measured record currently supports. */
export function earnedLevel(logs: DurationLog[], debriefs: Debrief[]): GraduationLevel {
  const score = calibrationScore(logs) ?? 0;
  const streak = onTimeStreak(debriefs);
  let earned: GraduationLevel = 1;
  for (const lvl of [2, 3, 4] as const) {
    const req = LEVELS[lvl];
    if (score >= req.minScore && logs.length >= req.minLogs && streak >= req.minStreak) {
      earned = lvl;
    }
  }
  return earned;
}

/**
 * One step per debrief toward the earned level. A single late day after a
 * long climb costs one level, not four — the streak reset already stings.
 */
export function stepToward(current: GraduationLevel, earned: GraduationLevel): GraduationLevel {
  if (earned > current) return (current + 1) as GraduationLevel;
  if (earned < current) return (current - 1) as GraduationLevel;
  return current;
}

export interface ProgressItem {
  label: string;
  have: number;
  need: number;
  met: boolean;
}

/** What still stands between the user and the next level (null at 4). */
export function levelProgress(
  logs: DurationLog[],
  debriefs: Debrief[],
  current: GraduationLevel,
): { target: GraduationLevel; items: ProgressItem[] } | null {
  if (current >= 4) return null;
  const target = (current + 1) as GraduationLevel;
  const req = LEVELS[target];
  const score = calibrationScore(logs) ?? 0;
  const streak = onTimeStreak(debriefs);
  return {
    target,
    items: [
      { label: "Clock score", have: score, need: req.minScore, met: score >= req.minScore },
      { label: "Tasks measured", have: logs.length, need: req.minLogs, met: logs.length >= req.minLogs },
      { label: "On-time streak", have: streak, need: req.minStreak, met: streak >= req.minStreak },
    ],
  };
}
