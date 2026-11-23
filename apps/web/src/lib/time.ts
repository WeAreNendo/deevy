import { formatDistanceToNowStrict } from "date-fns";

/**
 * How long ago, for a row or a stream: "just now" under a minute, then
 * date-fns's strict distance — "3 hours ago", or with `short`, "3h", the
 * form a narrow column has room for.
 */
export function ago(value: Date | string, options: { short?: boolean } = {}): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Date.now() - date.getTime() < 60_000) return "just now";
  if (!options.short) return formatDistanceToNowStrict(date, { addSuffix: true });
  return formatDistanceToNowStrict(date, { addSuffix: false })
    .replace(/ minutes?/, "m")
    .replace(/ hours?/, "h")
    .replace(/ days?/, "d")
    .replace(/ months?/, "mo")
    .replace(/ years?/, "y");
}

/** How long until, the other way: "in a minute" under one, then "in 3 hours". */
export function until(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (date.getTime() - Date.now() < 60_000) return "in a minute";
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

/** A length of time in the largest units that say it: "10 s", "25 min", "1 h 20 min". */
export function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${String(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}
