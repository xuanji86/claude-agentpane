// The agents on one time axis, a row each: its bar from when it started to when it ended, and how long it
// ran. Drawn on the surface's own clock, so a running agent's bar grows and its clock counts without the
// pane redrawing. Surfaces with no Client (VS Code, mobile) get the hooks module's still copy instead.
import type { ClientModule } from 'claude-code'

import { fmtDuration, laneRows } from './time'
import type { Lane } from './time'

type Props = { lanes: Lane[]; now: number; bar: number }
type Ref = { lastNow: number; ms: number; live: boolean }
type State = { ref: Ref }

const STEP_MS = 1000

const Lanes: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const ref = surface.state?.ref ?? { lastNow: -1, ms: 0, live: false }
  if (props.now !== ref.lastNow) {
    // A fresh reading from the hooks module: count on from it.
    ref.lastNow = props.now
    ref.ms = 0
  }
  ref.live = props.lanes.some(l => l.to === null)
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(STEP_MS, () => {
      if (!ref.live) return // all ended: the axis stands still
      ref.ms += STEP_MS
      surface.setState({ ref })
    })
  }
  const geo = laneRows(props.lanes, props.now + ref.ms, props.bar)
  return (
    <Box flexDirection="column">
      {props.lanes.map((l, i) => {
        const g = geo[i]!
        return (
          <Text wrap="truncate-end">
            <Text color={l.color || undefined} dimColor={l.dim}>{`${l.mark} `}</Text>
            <Text>{l.name}</Text>
            <Text dimColor>{` ${'·'.repeat(g.before)}`}</Text>
            <Text color={l.color || undefined} dimColor={l.dim}>{'━'.repeat(g.bar)}</Text>
            <Text dimColor>{`${'·'.repeat(g.after)}${fmtDuration(g.ms).padStart(8)}`}</Text>
          </Text>
        )
      })}
    </Box>
  )
}

export default Lanes
