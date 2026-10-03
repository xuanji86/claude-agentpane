/** An agent as the pane lists it: `$.agent.list()`'s row, with when the pane first saw it and when it ended. */
export type AgentpaneAgent = {
  id: string
  description: string
  type: string
  /** `running`, `completed`, `failed`, `killed`, or another of the engine's task statuses. */
  status: string
  name?: string
  parentId?: string
  /** When the pane first listed it. */
  firstSeen: number
  /** Whether the pane saw it running, so `firstSeen` is when it started (to within a second). */
  seenRunning: boolean
  /** When the pane first saw it done; absent while it runs, or when it was done before the pane saw it. */
  endedAt?: number
}

/** The tokens an agent's responses used, summed as the API reported them. */
export type AgentpaneTokens = {
  /** Input over all its requests: uncached, cache-read and cache-written together. */
  input: number
  /** The part of `input` the prompt cache served. */
  cached: number
  output: number
  /** Its latest request's input and output: how full its context is. */
  context: number
  requests: number
}

/** What an agent is doing: its latest tool call, and how many it has made. */
export type AgentpaneActivity = { text: string; tools: number }

declare module 'claude-code' {
  interface PluginState {
    agentpane: {
      agents: AgentpaneAgent[]
      activity: Record<string, AgentpaneActivity>
      tokens: Record<string, AgentpaneTokens>
      /** The agent whose conversation the pane shows; null for the list. */
      viewing: string | null
      /** The block scrolled back to, drawn at the top; null follows the conversation live. */
      scrollTop: number | null
      /** Bumped when the conversation in view grows, so the pane draws it again. */
      rev: number
      /** Bumped each second while agents run: the clocks move. */
      tick: number
      /** Bumped five times a second while the list shows a running agent: its spinner and shimmer move. */
      frame: number
      /** The agent whose Stop was pressed once: the next press stops it. */
      confirmStop: string | null
      /** The list shows running agents only. */
      hideDone: boolean
      /** The tool-call groups opened in the conversation in view, by their first call's id. */
      expanded: string[]
      /** Folded away by its handle: the pane is closed and a tab above the prompt reopens it. */
      folded: boolean
      /** Whether that tab shows: folded, with agents running or just finished. */
      tab: boolean
    }
  }
}
