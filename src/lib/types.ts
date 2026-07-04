export interface Note {
  id: string;
  text: string;
  timestamp: string;
}

export interface Dimension {
  id: string;
  name: string;
  scripture: string;
  subheadings: string[];
  notes: Note[];
}
