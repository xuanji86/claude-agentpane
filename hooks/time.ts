// Time as the pane draws it, pure: shared by the hooks module and the surface modules.

// As Claude Code's own status lines read a duration: "8s", "1m 13s", "1h 2m".
export const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60), h = Math.floor(m / 60)
  return h ? `${h}h ${m % 60}m` : m ? `${m}m ${s % 60}s` : `${s}s`
}

// One agent on the time axis: when it started, and when it ended (null while it runs).
export type Lane = { name: string; mark: string; color: string; dim: boolean; from: number; to: number | null }

// Each lane's bar on one axis `width` cells wide, from the first start to now (or, all ended, to the last
// end): the cells before it, of it (at least one) and after it; and how long it ran.
export const laneRows = (lanes: readonly Lane[], now: number, width: number) => {
  if (!lanes.length) return []
  const start = Math.min(...lanes.map(l => l.from))
  const end = lanes.some(l => l.to === null) ? now : Math.max(...lanes.map(l => l.to ?? now))
  const at = (t: number) => Math.round(((t - start) / Math.max(1, end - start)) * width)
  return lanes.map(l => {
    const from = Math.min(width - 1, Math.max(0, at(l.from)))
    const to = Math.min(width, Math.max(from + 1, at(l.to ?? end)))
    return { before: from, bar: to - from, after: width - to, ms: (l.to ?? end) - l.from }
  })
}
