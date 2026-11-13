import { Plugin, Slot, type MountedSession, type SessionScreen, type Ui } from "@opencode/plugin/gui"
import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import supabaseIcon from "../../../packages/assets/supabase-icon-green-transparent.svg?raw"
import { Supabase, type Status } from "./rpc"

const iconURL = `data:image/svg+xml,${encodeURIComponent(supabaseIcon)}`

const configFile = "supabase/config.toml"
const refreshInterval = 10_000

interface State {
  configured: boolean
  running: boolean
}

function Badge(props: {
  session: MountedSession
  active: boolean
  compact: boolean
  screen: SessionScreen
  ui: Ui
  load(directory: string): Promise<Status>
  open(): void
}) {
  // A plain signal, not `createResource`: refetching a resource increments the
  // nearest Suspense counter, and OpenCode Desktop wraps the whole window in a
  // Suspense boundary, so every poll would swap the window for its fallback.
  const [state, setState] = createSignal<State>()
  // A failed refresh keeps the last answer for the same directory, and an older
  // response must never win over one for a directory the user already left.
  let last: { directory: string; state: State } | undefined
  let seq = 0

  const apply = (directory: string, next: State) => {
    if (directory !== props.session.directory) return
    if (last?.directory === directory && last.state.configured === next.configured && last.state.running === next.running) return
    last = { directory, state: next }
    setState(next)
  }

  const clear = () => {
    // `last` has to go with the value: keeping it would dedupe the next
    // identical answer and leave the badge hidden.
    last = undefined
    setState(undefined)
  }

  const refresh = async () => {
    const id = ++seq
    const directory = props.session.directory
    try {
      const roots = [directory]
      const project = props.session.project?.worktree
      if (project && project !== directory) roots.push(project)
      let root: string | undefined
      let unverified = false
      for (const candidate of roots) {
        try {
          if (await props.screen.file.exists(`${candidate}/${configFile}`)) {
            root = candidate
            break
          }
        } catch {
          // The server cannot be reached, so this says nothing about whether the
          // project is configured: try the next root, then keep the last answer.
          unverified = true
        }
      }
      if (id !== seq) return
      if (!root) {
        if (unverified) {
          if (last?.directory !== directory) clear()
          return
        }
        apply(directory, { configured: false, running: false })
        return
      }
      const { running } = await props.load(root)
      if (id !== seq) return
      apply(directory, { configured: true, running })
    } catch {
      if (id !== seq) return
      if (last?.directory !== directory) clear()
    }
  }

  // Cached timelines stay mounted while hidden, so only the visible one polls.
  // Refreshing from this effect means a timeline that becomes visible, or a
  // session that moves, updates right away instead of waiting for the timer.
  createEffect(() => {
    if (!props.active) return
    void refresh()
    const timer = setInterval(() => void refresh(), refreshInterval)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <Show when={state()?.configured}>
      <props.ui.Tooltip value={state()?.running ? "Supabase · running" : "Supabase · stopped"} placement='right'>
        <props.ui.Button variant='ghost-muted' size="small" onClick={() => props.open()}>
          <img
            alt={props.compact ? "Supabase" : ""}
            src={iconURL}
            style={{
              width: "12px",
              height: "12px",
              display: "block",
              filter: state()?.running ? undefined : "grayscale(1)",
              opacity: state()?.running ? 1 : 0.55,
            }}
          />
          {!props.compact && "Supabase"}
        </props.ui.Button>
      </props.ui.Tooltip>
    </Show>
  )
}

export default Plugin.define({
  setup(ctx) {
    const load = async (directory: string) => (await ctx.client.rpc(Supabase).status({ directory })) as Status

    ctx.add(Slot, {
      at: "session.header",
      order: 10,
      render: (input) => (
        <Badge
          session={input.session}
          active={input.active}
          compact={input.compact}
          screen={input.screen}
          ui={ctx.ui}
          load={load}
          open={() => {
            ctx.toast.show({
              title: "Supabase",
              description: "Not implemented yet",
            })
          }}
        />
      ),
    })
  },
})
