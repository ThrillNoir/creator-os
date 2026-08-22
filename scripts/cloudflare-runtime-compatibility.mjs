import { readFileSync } from "node:fs";
import path from "node:path";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const workerdVersionPattern = /^1\.(\d{4})(\d{2})(\d{2})\.\d+(?:[-+].*)?$/;

function isCalendarDate(value) {
  if (!datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function workerdCompatibilityDate(workerdVersion) {
  const match = workerdVersionPattern.exec(workerdVersion ?? "");
  if (!match) throw new Error(`Unable to derive a compatibility date from pinned workerd version ${JSON.stringify(workerdVersion)}.`);
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (!isCalendarDate(date)) throw new Error(`Pinned workerd version ${JSON.stringify(workerdVersion)} contains an invalid compatibility date.`);
  return date;
}

export function readPinnedWorkerRuntime(packageDirectory) {
  const wrangler = JSON.parse(readFileSync(path.join(packageDirectory, "node_modules/wrangler/package.json"), "utf8"));
  const workerd = JSON.parse(readFileSync(path.join(packageDirectory, "node_modules/workerd/package.json"), "utf8"));
  if (typeof wrangler.version !== "string" || typeof workerd.version !== "string") throw new Error("Pinned Wrangler or workerd package metadata is invalid.");
  return {
    wranglerVersion: wrangler.version,
    workerdVersion: workerd.version,
    maximumCompatibilityDate: workerdCompatibilityDate(workerd.version),
  };
}

export function validateWorkerCompatibility({ components, runtime }) {
  const errors = [];
  const results = [];
  if (!runtime?.maximumCompatibilityDate || !isCalendarDate(runtime.maximumCompatibilityDate)) {
    return { ok: false, errors: ["Pinned workerd maximum compatibility date is missing or invalid."], results };
  }

  for (const component of components) {
    const date = component.config?.compatibility_date;
    const label = component.label ?? component.configPath ?? "Worker configuration";
    if (typeof date !== "string" || !isCalendarDate(date)) {
      errors.push(`${label} has no valid compatibility_date.`);
      results.push({ ...component, compatibilityDate: date ?? null, ok: false });
      continue;
    }
    const ok = date <= runtime.maximumCompatibilityDate;
    if (!ok) errors.push(`${label} requires compatibility date ${date}, newer than pinned workerd ${runtime.workerdVersion} (${runtime.maximumCompatibilityDate}).`);
    results.push({ ...component, compatibilityDate: date, ok });
  }

  return { ok: errors.length === 0, errors, results, runtime };
}
