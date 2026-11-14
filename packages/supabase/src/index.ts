/** The `project_id` the Supabase CLI labels the stack's containers with. */
const projectId = (directory: string, config: string) => {
  const configured = /^[ \t]*project_id[ \t]*=[ \t]*"([^"]+)"/m.exec(config)?.[1]
  if (configured) return configured
  const name = directory.replace(/[\\/]+$/, "").split(/[\\/]/).pop()
  return name || directory
}

/** A config section's body, up to the next section heading. */
const section = (config: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^[ \\t]*\\[${escaped}\\][ \\t]*\\r?\\n([\\s\\S]*?)(?=^[ \\t]*\\[|$)`, "m").exec(config)?.[1]
}

/** A section's `port`, or the fallback when the section or the setting is absent. */
const port = (config: string, sectionName: string, fallback: number) => {
  const configured = section(config, sectionName)?.match(/^[ \t]*port[ \t]*=[ \t]*([0-9]+)/m)?.[1]
  return configured ? Number.parseInt(configured, 10) : fallback
}

/** Where `supabase start` serves Studio and Mailpit. */
const endpoints = (config?: string) => ({
  studio: `http://127.0.0.1:${config ? port(config, "studio", 54323) : 54323}`,
  mailpit: `http://127.0.0.1:${config ? port(config, "local_smtp", port(config, "inbucket", 54324)) : 54324}`,
})

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
    return { configured: true, running: await host.containers(projectId(directory, config)), ...endpoints(config) }
  }
  return { configured: false, running: false, ...endpoints() }
}

/** Whether a project has a local Supabase config, whether its stack is running, and where Studio and Mailpit are. */
export type SupabaseStatus = Awaited<ReturnType<typeof status>>
