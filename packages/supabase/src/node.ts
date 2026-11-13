import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { status as detect } from "./index"

const run = promisify(execFile)

/**
 * Whether the first directory with a `supabase/config.toml` has its local stack running. Pass a session directory and
 * its project root, so a session in a subdirectory still finds the project.
 */
export function status(...directories: Array<string | undefined>) {
  return detect(
    {
      config: (directory) => readFile(join(directory, "supabase", "config.toml"), "utf8").catch(() => undefined),
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
