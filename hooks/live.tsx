// A running agent's live line, drawn on the surface's own frame clock so only this region redraws, not the
// pane: Claude Code's spinner glyph, a shimmer across "Running…", and a clock. `since` and `now` come from
// the hooks module's clock; between its redraws the clock counts on from them. `clockOnly` draws the clock
// alone. Surfaces with no Client (VS Code, mobile) get the hooks module's static line instead.
import type { ClientModule } from 'claude-code'

import { fmtDuration } from './time'

type Props = { since: number; now: number; pad: string; detail: string; alert: string; motion: boolean; clockOnly: boolean }
type Ref = { base: number; lastNow: number; ms: number; step: number }
type State = { ref: Ref }

const STEP_MS = 120 // a frame of the shimmer; the spinner turns every other frame
const SPIN = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
const WORD = 'Running…'

const Live: ClientModule<Props, State> = (props, surface) => {
  const { Text } = surface.elements
  const ref = surface.state?.ref ?? { base: 0, lastNow: -1, ms: 0, step: 0 }
  if (props.now !== ref.lastNow) {
    // A fresh reading from the hooks module: count on from it.
    ref.lastNow = props.now
    ref.base = props.now - props.since
    ref.ms = 0
  }
  if (surface.state === undefined) {
    const step = props.motion && !props.clockOnly ? STEP_MS : 1000
    surface.setState({ ref })
    surface.every(step, () => {
      ref.ms += step
      ref.step += 1
      surface.setState({ ref })
    })
  }
  const time = fmtDuration(ref.base + ref.ms)
  if (props.clockOnly) return <Text dimColor>{time}</Text>

  const glyph = props.motion ? (SPIN[Math.floor(ref.step / 2) % SPIN.length] ?? '✻') : '✻'
  const at = props.motion ? (ref.step % (WORD.length + 6)) - 3 : -9
  const lit = (i: number) => Math.abs(i - at) <= 1
  const chars = [...WORD]
  return (
    <Text wrap="truncate-end">
      <Text color="claude">{`${props.pad}  ${glyph} `}</Text>
      {chars.map((ch, i) => (
        <Text color={lit(i) ? 'claudeShimmer' : 'claude'}>{ch}</Text>
      ))}
      <Text dimColor>{` (${[time, props.detail].filter(Boolean).join(' · ')}`}</Text>
      {props.alert ? <Text color="error">{` · ${props.alert}`}</Text> : null}
      <Text dimColor>)</Text>
    </Text>
  )
}

export default Live
