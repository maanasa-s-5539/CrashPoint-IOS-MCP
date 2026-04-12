/**
 * Validates a user-provided date string and returns the parsed Date object.
 * Throws an Error with a helpful message if the date string is invalid.
 *
 * @param dateString - The date string to validate
 * @param paramName  - The parameter name used in the error message (e.g. "--before-date")
 * @returns The parsed Date object
 */
export function validateDateInput(dateString: string, paramName: string): Date {
  const parsed = new Date(dateString);
  if (isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid date for ${paramName}: "${dateString}". Please use ISO format (YYYY-MM-DD), e.g. 2026-03-01`
    );
  }
  return parsed;
}

/**
 * Computes the startDate and endDate ISO strings from a numDays window.
 *
 * @param numDays    - Number of days in the window (1-180). Values outside this range are clamped.
 * @param dateOffset - Days to subtract from today to get the end date (default: 4).
 * @returns An object with startDateISO and endDateISO strings in YYYY-MM-DD format.
 */
export function computeDateRange(
  numDays: number,
  dateOffset: number
): { startDateISO: string; endDateISO: string } {
  const n = Math.max(1, Math.min(numDays, 180));
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - dateOffset);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - n + 1);
  return {
    startDateISO: startDate.toISOString().slice(0, 10),
    endDateISO: endDate.toISOString().slice(0, 10),
  };
}
