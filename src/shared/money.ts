export function formatRupees(paisa: number): string {
  if (!Number.isInteger(paisa)) throw new Error("Amount must be whole paisa");
  const rupees = Math.trunc(paisa / 100);
  const remainder = Math.abs(paisa % 100);
  const grouped = String(rupees).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return remainder === 0 ? `Rs ${grouped}` : `Rs ${grouped}.${String(remainder).padStart(2, "0")}`;
}

const MINUS = "−";

export const negativeRupees = (paisa: number): string => `${MINUS}${formatRupees(paisa)}`;

export const signedRupees = (paisa: number): string =>
  paisa < 0 ? negativeRupees(-paisa) : formatRupees(paisa);
