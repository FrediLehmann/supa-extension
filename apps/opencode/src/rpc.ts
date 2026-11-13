import { Rpc } from "@opencode/plugin/rpc"
import type { SupabaseStatus } from "@supa-extension/supabase"

export interface StatusInput {
  readonly directory: string
  readonly worktree?: string
}

export type Status = SupabaseStatus

const input = {
  type: "object",
  properties: {
    directory: { type: "string" },
    worktree: { type: "string" },
  },
  required: ["directory"],
  additionalProperties: false,
} as const

const output = {
  type: "object",
  properties: {
    configured: { type: "boolean" },
    running: { type: "boolean" },
  },
  required: ["configured", "running"],
  additionalProperties: false,
} as const

export const Supabase = Rpc.define({
  id: "supabase",
  methods: {
    status: { input, output },
  },
  events: {},
})
