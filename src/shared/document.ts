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

export interface DocumentModel {
  title: string;
  reference: string;
  panels: DocumentPanel[];
  facts: DocumentPair[];
  columns: DocumentColumn[];
  rows: DocumentCell[][];
  totals: DocumentPair[];
  notes: string | null;
  landscape?: boolean;
}
