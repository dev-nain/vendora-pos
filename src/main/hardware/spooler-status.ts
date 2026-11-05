export const printerStatusBits = {
  paused: 0x1,
  error: 0x2,
  pendingDeletion: 0x4,
  paperJam: 0x8,
  paperOut: 0x10,
  paperProblem: 0x40,
  offline: 0x80,
  notAvailable: 0x1000,
  noToner: 0x40000,
  userIntervention: 0x100000,
  outOfMemory: 0x200000,
  doorOpen: 0x400000,
} as const;

export const printerAttributeWorkOffline = 0x400;

export const jobStatusBits = {
  paused: 0x1,
  error: 0x2,
  deleting: 0x4,
  offline: 0x20,
  paperOut: 0x40,
  printed: 0x80,
  deleted: 0x100,
  blockedDevq: 0x200,
  userIntervention: 0x400,
  complete: 0x1000,
} as const;

const printerBlocking = Object.values(printerStatusBits).reduce((mask, bit) => mask | bit, 0);
const jobBlocking =
  jobStatusBits.paused |
  jobStatusBits.error |
  jobStatusBits.deleting |
  jobStatusBits.offline |
  jobStatusBits.paperOut |
  jobStatusBits.deleted |
  jobStatusBits.blockedDevq |
  jobStatusBits.userIntervention;
const jobDone = jobStatusBits.printed | jobStatusBits.complete;

export type SpoolerState = { state: "ready" } | { state: "failed" };

export function interpretSpoolerStatus(
  printerStatus: number,
  attributes: number,
  jobStatus: number | null,
): SpoolerState {
  if ((printerStatus & printerBlocking) !== 0) return { state: "failed" };
  if ((attributes & printerAttributeWorkOffline) !== 0) return { state: "failed" };
  if (jobStatus !== null && (jobStatus & jobBlocking) !== 0) return { state: "failed" };
  return { state: "ready" };
}

export function isJobDone(jobStatus: number): boolean {
  return (jobStatus & jobDone) !== 0;
}
