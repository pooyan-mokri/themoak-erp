/**
 * Helper function to safely serialize dates for client components
 */
export function serializeDate(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  try {
    if (date instanceof Date) {
      return date.toISOString();
    }
    if (typeof date === 'string') {
      // Validate it's a valid date string
      const parsed = new Date(date);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
    return null;
  } catch {
    return null;
  }
}



