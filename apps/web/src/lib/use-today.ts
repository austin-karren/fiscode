import { useState } from "react";

/**
 * Today's date, read once when the component mounts. A form's default date
 * stays the same across re-renders instead of reading the clock on each one.
 */
export function useToday(): Date {
  const [today] = useState(() => new Date());
  return today;
}
