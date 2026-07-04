/**
 * Research-based duration priors for common prep tasks.
 *
 * These are population medians (p50) and generous 75th percentiles (p75)
 * drawn from time-use surveys — shown to the user only AFTER they make
 * their own blind guess, per the guess-first training design (planning
 * fallacy research: people can't self-correct from gut feel; they need a
 * reference class).
 *
 * Sources: Nielsen global grooming survey (~4h/week personal grooming),
 * UnitedHealthcare/hygiene surveys (shower ~9-10 min, teeth ~2 min/session),
 * BLS American Time Use Survey (grooming ~30-50 min/day).
 */
export interface TaskPrior {
  id: string;
  label: string;
  p50: number;
  p75: number;
}

export const TASK_PRIORS: TaskPrior[] = [
  { id: "shower", label: "Shower", p50: 9, p75: 15 },
  { id: "wash-hair", label: "Wash + dry hair", p50: 12, p75: 25 },
  { id: "brush-teeth", label: "Brush teeth", p50: 2, p75: 4 },
  { id: "get-dressed", label: "Get dressed", p50: 8, p75: 15 },
  { id: "hair", label: "Style hair", p50: 5, p75: 15 },
  { id: "makeup", label: "Makeup", p50: 11, p75: 20 },
  { id: "shave", label: "Shave", p50: 5, p75: 10 },
  { id: "breakfast", label: "Eat something", p50: 15, p75: 25 },
  { id: "pack-bag", label: "Pack bag", p50: 5, p75: 10 },
  { id: "gather", label: "Keys, wallet, phone", p50: 3, p75: 6 },
  { id: "kids-ready", label: "Get kids ready", p50: 20, p75: 35 },
  { id: "other", label: "Something else", p50: 10, p75: 20 },
];

export function getPrior(taskId: string): TaskPrior | undefined {
  return TASK_PRIORS.find((t) => t.id === taskId);
}

/** Fixed transition buffers (minutes), from the backward-planning spec. */
export const BUFFERS = {
  /** Find parking + walk in, after the drive. */
  parking: 10,
  /** Door of home to sitting in the car. */
  walkToCar: 3,
  /** Fully-ready pause at the door before leaving under your own power. */
  doorstepStaging: 5,
  /** Waiting at the door BEFORE a driver arrives — never make them wait. */
  pickupStaging: 10,
  /** Be at the stop before the bus/train, not as it arrives. */
  platform: 3,
  /** Walking arrival: lights, crossings, finding the entrance. */
  walkArrival: 3,
  /** Curbside drop-off buffer when picking someone up (no parking hunt). */
  curbside: 3,
} as const;
