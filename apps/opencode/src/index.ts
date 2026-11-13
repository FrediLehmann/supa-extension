import { Plugin } from "@opencode/plugin"
import { status } from "@supa-extension/supabase/node"
import { Supabase } from "./rpc"

export default Plugin.define({
  id: "supabase",
  async setup(ctx) {
    await ctx.rpc.register(Supabase, {
      status: (input) => {
        const { directory, worktree } = input as { directory: string; worktree?: string }
        return status(directory, worktree)
      },
    })
  },
})
