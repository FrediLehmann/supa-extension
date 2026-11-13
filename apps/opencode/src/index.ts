import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { connect } from "node:net"
import { basename, join } from "node:path"
import { promisify } from "node:util"
import { Plugin } from "@opencode/plugin"
import { Supabase } from "./rpc"

const run = promisify(execFile)

const defaultHost = "127.0.0.1"
const defaultPort = 54321

/** Resolves true when something accepts a TCP connection on the address before the timeout. */
const connectable = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ host, port })
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(750)
    socket.once("connect", () => finish(true))
    socket.once("timeout", () => finish(false))
    socket.once("error", () => finish(false))
  })

/** The local API gateway from `supabase/config.toml`, with the CLI's defaults. */
function api(config: string) {
  let section = ""
  let host = defaultHost
  let port = defaultPort
  for (const line of config.split("\n")) {
    const text = line.trim()
    if (!text || text.startsWith("#")) continue
    const header = /^\[([^\]]+)\]$/.exec(text)
    if (header) {
      section = header[1]!.trim()
      continue
    }
    if (section !== "api") continue
    const entry = /^(\w+)\s*=\s*(.+?)\s*(?:#.*)?$/.exec(text)
    if (!entry) continue
    const value = entry[2]!.replace(/^"(.*)"$/, "$1")
    if (entry[1] === "host") host = value === "0.0.0.0" || value === "::" ? defaultHost : value
    if (entry[1] === "port") {
      const parsed = Number.parseInt(value, 10)
      if (Number.isFinite(parsed)) port = parsed
    }
  }
  return { host, port }
}

/** The `project_id` the CLI labels the stack's containers with, defaulting to the directory's name. */
function projectId(directory: string, config: string) {
  const match = /^[ \t]*project_id[ \t]*=[ \t]*"([^"]+)"/m.exec(config)
  return match?.[1] ?? basename(directory)
}

/**
 * Whether this project's containers run, by the label the Supabase CLI puts on them. Undefined when Docker cannot
 * be asked, e.g. when the CLI is missing from the server's PATH.
 */
async function containers(project: string) {
  try {
    const { stdout } = await run(
      "docker",
      ["ps", "--filter", `label=com.supabase.cli.project=${project}`, "--format", "{{.Names}}"],
      { timeout: 3000 },
    )
    return stdout.split("\n").some((name) => name.trim().length > 0)
  } catch {
    return undefined
  }
}

/** Whether the project's local Supabase stack is running. */
async function running(directory: string) {
  const config = await readFile(join(directory, "supabase", "config.toml"), "utf8").catch(() => undefined)
  if (!config) return false
  const containersRunning = await containers(projectId(directory, config))
  if (containersRunning !== undefined) return containersRunning
  const { host, port } = api(config)
  return connectable(host, port)
}

export default Plugin.define({
  id: "supabase",
  async setup(ctx) {
    await ctx.rpc.register(Supabase, {
      status: async (input) => {
        const { directory } = input as { directory: string }
        return { running: await running(directory) }
      },
    })
  },
})
