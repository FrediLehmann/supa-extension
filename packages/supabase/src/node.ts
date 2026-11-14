import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { status as detect, type SupabaseConfig } from "./index"

declare const Bun: {
  readonly TOML: {
    parse(input: string): unknown
  }
}

const run = promisify(execFile)

/** Reads and parses a project's `supabase/config.toml`. */
const config = async (directory: string) => {
  const text = await readFile(join(directory, "supabase", "config.toml"), "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  try {
    return Bun.TOML.parse(text) as SupabaseConfig
  } catch {
    return undefined
  }
}

/**
 * Whether the first directory with a `supabase/config.toml` has its local stack running. Pass a session directory and
 * its project root, so a session in a subdirectory still finds the project.
 */
export function status(...directories: Array<string | undefined>) {
  return detect(
    {
      config,
      containers: async (project) => {
        try {
          const { stdout } = await run(
            "docker",
            ["ps", "--quiet", "--filter", `label=com.supabase.cli.project=${project}`],
            { timeout: 3000 },
          )
          return stdout.trim().length > 0
        } catch {
          return false
        }
      },
    },
    ...directories,
  )
}
