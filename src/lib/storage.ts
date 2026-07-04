import { Dimension } from "./types";

const STORAGE_KEY = "personal-growth-dimensions";

export const DEFAULT_DIMENSIONS: Dimension[] = [
  {
    id: "spiritual",
    name: "Spiritual",
    scripture: "",
    subheadings: [],
    notes: [],
  },
  {
    id: "mental",
    name: "Mental",
    scripture: "",
    subheadings: [],
    notes: [],
  },
  {
    id: "physical",
    name: "Physical",
    scripture: "",
    subheadings: [],
    notes: [],
  },
  {
    id: "relational",
    name: "Relational",
    scripture: "",
    subheadings: [],
    notes: [],
  },
];

export function loadDimensions(): Dimension[] {
  if (typeof window === "undefined") return DEFAULT_DIMENSIONS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DIMENSIONS;
    return JSON.parse(raw) as Dimension[];
  } catch {
    return DEFAULT_DIMENSIONS;
  }
}

export function saveDimensions(dimensions: Dimension[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dimensions));
}
