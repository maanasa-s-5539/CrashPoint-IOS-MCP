/**
 * Validates a user-provided date string and returns the parsed Date object.
 * Throws an Error with a helpful message if the date string is invalid.
 *
 * @param dateString - The date string to validate
 * @param paramName  - The parameter name used in the error message (e.g. "--before-date")
 * @returns The parsed Date object
 */
export declare function validateDateInput(dateString: string, paramName: string): Date;
/**
 * Computes the startDate and endDate ISO strings from a numDays window.
 *
 * @param numDays    - Number of days in the window (1-180). Values outside this range are clamped.
 * @param dateOffset - Days to subtract from today to get the end date (default: 4).
 * @returns An object with startDateISO and endDateISO strings in YYYY-MM-DD format.
 */
export declare function computeDateRange(numDays: number, dateOffset: number): {
    startDateISO: string;
    endDateISO: string;
};
//# sourceMappingURL=dateValidation.d.ts.map