import { Plugin, Slot, usePlugin, type MountedSession } from "@opencode/plugin/gui"
import { Browser } from "@opencode/plugin/gui/browser"
import type { SupabaseStatus } from "@supa-extension/supabase"
import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import supabaseIcon from "../../../packages/assets/supabase-icon-green-transparent.svg?raw"
import { Supabase } from "./rpc"

const iconURL = `data:image/svg+xml,${encodeURIComponent(supabaseIcon)}`
const refreshInterval = 10_000
const offline: SupabaseStatus = { configured: false, running: false, studio: "", mailpit: "" }

function Badge(props: { session: MountedSession; active: boolean; compact: boolean }) {
  const ctx = usePlugin()
  const browser = ctx.use(Browser)
  // A plain signal, not `createResource`: refetching a resource increments the
  // nearest Suspense counter, and OpenCode Desktop wraps the whole window in a
  // Suspense boundary, so every poll would swap the window for its fallback.
  const [state, setState] = createSignal<SupabaseStatus>(offline)
  let shown: string | undefined

  const refresh = async (directory: string, worktree?: string) => {
    const next = (await ctx.client.rpc(Supabase).status({ directory, worktree }).catch(() => undefined)) as
      | SupabaseStatus
      | undefined
    if (!next || directory !== props.session.directory) return
    shown = next.configured ? directory : undefined
    setState(next)
  }

  const open = () => {
    const status = state()
    if (!status.running) return
    const provider = browser()
    if (provider.status !== "active") {
      ctx.toast.show({ title: "Supabase", description: "The browser panel is unavailable." })
      return
    }
    // Studio refuses to be framed (X-Frame-Options: DENY), so both open in the desktop browser pane.
    provider.value.open(props.session, status.studio)
    provider.value.open(props.session, status.mailpit)
  }

  // Cached timelines stay mounted while hidden, so only the visible one polls.
  // Reading the directory here also refreshes the badge when a session moves.
  createEffect(() => {
    if (!props.active) return
    const directory = props.session.directory
    const worktree = props.session.project?.worktree
    // Keep the last answer when the same timeline just became visible again.
    if (shown !== directory) setState(offline)
    void refresh(directory, worktree)
    const timer = setInterval(() => void refresh(directory, worktree), refreshInterval)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <Show when={state().configured}>
      <ctx.ui.Tooltip value={state().running ? "Open Studio and Mailpit" : "Stopped"} placement='bottom'>
        <ctx.ui.Button variant='ghost-muted' size='small' disabled={!state().running} onClick={open}>
          <img
            alt={props.compact ? "Supabase" : ""}
            src={iconURL}
            style={{
              width: "12px",
              height: "12px",
              display: "block",
              filter: state().running ? undefined : "grayscale(1)",
              opacity: state().running ? 1 : 0.55,
            }}
          />
          {!props.compact && "Supabase"}
        </ctx.ui.Button>
      </ctx.ui.Tooltip>
    </Show>
  )
}

export default Plugin.define({
  setup(ctx) {
    ctx.add(Slot, {
      at: "session.header",
      order: 10,
      render: (input) => <Badge session={input.session} active={input.active} compact={input.compact} />,
    })
  },
})
