import { Rpc } from "@opencode/plugin/rpc"

const directoryInput = {
  type: "object",
  properties: { directory: { type: "string" } },
  required: ["directory"],
  additionalProperties: false,
} as const

/** What `status` answers: whether the project's local stack is up. */
export interface Status {
  readonly running: boolean
}

const statusOutput = {
  type: "object",
  properties: { running: { type: "boolean" } },
  required: ["running"],
  additionalProperties: false,
} as const

export const Supabase = Rpc.define({
  id: "supabase",
  methods: {
    status: { input: directoryInput, output: statusOutput },
  },
  events: {},
})
