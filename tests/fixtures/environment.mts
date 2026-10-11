import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export const appEnvironment = parseEnv(readFileSync(new URL("./app.env", import.meta.url), "utf8"));

/** Configure only the requested operation, then restore the caller's environment. */
export async function withEnvironment<T>(
  values: Record<string, string | undefined>,
  run: () => T | Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    return await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
