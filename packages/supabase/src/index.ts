/** The `project_id` the Supabase CLI labels the stack's containers with. */
const projectId = (directory: string, config: string) => {
  const configured = /^[ \t]*project_id[ \t]*=[ \t]*"([^"]+)"/m.exec(config)?.[1]
  if (configured) return configured
  const name = directory.replace(/[\\/]+$/, "").split(/[\\/]/).pop()
  return name || directory
}

/**
 * Whether the first directory with a `supabase/config.toml` has its local stack running. Pass a session directory and
 * its project root, so a session in a subdirectory still finds the project.
 */
export async function status(
  host: {
    /** Reads `<directory>/supabase/config.toml`, or returns undefined when it does not exist. */
    config(directory: string): Promise<string | undefined>
    /** Whether the Supabase project's containers are running. */
    containers(project: string): Promise<boolean>
  },
  ...directories: Array<string | undefined>
) {
  for (const directory of directories) {
    if (!directory) continue
    const config = await host.config(directory)
    if (!config) continue
    return { configured: true, running: await host.containers(projectId(directory, config)) }
  }
  return { configured: false, running: false }
}

/** Whether a project has a local Supabase config, and whether its stack is running. */
export type SupabaseStatus = Awaited<ReturnType<typeof status>>
