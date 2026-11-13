import { Plugin } from "@opencode/plugin"
import { status } from "@supa-extension/supabase/node"
import { Supabase, type StatusInput } from "./rpc"

export default Plugin.define({
  id: "supabase",
  async setup(ctx) {
    await ctx.rpc.register(Supabase, {
      status: (input) => {
        const { directory, worktree } = input as StatusInput
        return status(directory, worktree)
      },
    })
  },
})
