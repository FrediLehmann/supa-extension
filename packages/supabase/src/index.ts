/** The parts of `supabase/config.toml` the local stack status needs. */
export type SupabaseConfig = {
  readonly project_id?: string
  readonly studio?: { readonly port?: number }
  readonly local_smtp?: { readonly port?: number }
  readonly inbucket?: { readonly port?: number }
}

/** The `project_id` the Supabase CLI labels the stack's containers with. */
const projectId = (directory: string, config: SupabaseConfig) => {
  if (typeof config.project_id === "string") return config.project_id
  const name = directory.replace(/[\\/]+$/, "").split(/[\\/]/).pop()
  return name || directory
}

/** A configured port, or the fallback when it is absent or not a number. */
const port = (configured: unknown, fallback: number) => (typeof configured === "number" ? configured : fallback)

/** Where `supabase start` serves Studio and Mailpit. */
const endpoints = (config?: SupabaseConfig) => ({
  studio: `http://127.0.0.1:${port(config?.studio?.port, 54323)}`,
  mailpit: `http://127.0.0.1:${port(config?.local_smtp?.port ?? config?.inbucket?.port, 54324)}`,
})

/**
 * Whether the first directory with a `supabase/config.toml` has its local stack running. Pass a session directory and
 * its project root, so a session in a subdirectory still finds the project.
 */
export async function status(
  host: {
    /** Reads and parses `<directory>/supabase/config.toml`, or returns undefined when it is absent or invalid. */
    config(directory: string): Promise<SupabaseConfig | undefined>
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
