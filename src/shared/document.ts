export interface DocumentCell {
  text: string;
  urdu?: string;
}

export interface DocumentColumn {
  label: string;
  align: "left" | "right";
  width?: string;
}

export interface DocumentPanel {
  label?: string;
  lines: string[];
}

export interface DocumentPair {
  label: string;
  value: string;
}

export interface DocumentSection {
  heading: string;
  columns: DocumentColumn[];
  rows: DocumentCell[][];
  totals: DocumentPair[];
  note: string | null;
}

export interface DocumentModel {
  title: string;
  reference: string;
  panels: DocumentPanel[];
  facts: DocumentPair[];
  columns: DocumentColumn[];
  rows: DocumentCell[][];
  totals: DocumentPair[];
  sections?: DocumentSection[];
  notes: string | null;
  landscape?: boolean;
}
