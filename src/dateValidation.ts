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
