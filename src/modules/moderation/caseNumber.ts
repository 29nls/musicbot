/** Format kasus yang ditampilkan ke user, mis. `#CASE-0142`. */
export function formatCaseId(caseNumber: number): string {
  const safe = Number.isFinite(caseNumber) ? Math.max(Math.trunc(caseNumber), 0) : 0;
  return `#CASE-${safe.toString().padStart(4, '0')}`;
}

// Menerima "#CASE-0142", "CASE 142", atau angka polos "142".
const CASE_ID_PATTERN = /^#?\s*case\s*-?\s*(\d{1,9})$/i;

/** Baca nomor kasus dari input user. null kalau formatnya tidak dikenal. */
export function parseCaseNumber(input: string): number | null {
  const trimmed = input.trim();
  const match = CASE_ID_PATTERN.exec(trimmed);
  const digits = match?.[1] ?? (/^\d{1,9}$/.test(trimmed) ? trimmed : null);
  if (!digits) return null;

  const value = Number(digits);
  return value >= 1 ? value : null;
}
