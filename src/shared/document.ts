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

export interface DocumentText {
  text: string;
  lang: "en" | "ur";
}

export interface DocumentTable {
  label: string;
  columns: DocumentColumn[];
  rows: DocumentCell[][];
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
  header: DocumentText[];
  panels: DocumentPanel[];
  facts: DocumentPair[];
  columns: DocumentColumn[];
  rows: DocumentCell[][];
  totals: DocumentPair[];
  summaries: DocumentTable[];
  sections?: DocumentSection[];
  notes: string | null;
  footer: DocumentText[];
  landscape?: boolean;
}
