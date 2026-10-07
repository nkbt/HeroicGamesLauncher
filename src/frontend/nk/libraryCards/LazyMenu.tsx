// nk: #4 - drop-in for MUI `Menu` that is only mounted while open (and until
// its close transition finished). Every library card owns a context menu; a
// closed MUI Menu still costs a Menu/Popover/Modal render per card on every
// card re-render, which adds up with ~1000 eagerly rendered cards.
import { useState } from 'react'
import Menu, { type MenuProps } from '@mui/material/Menu'
import { lazyMenuMounted } from './logic'

export default function LazyMenu(props: MenuProps) {
  const [state, setState] = useState({ wasOpen: props.open, exiting: false })
  const next = lazyMenuMounted(props.open, state)
  if (next.wasOpen !== state.wasOpen || next.exiting !== state.exiting) {
    setState({ wasOpen: next.wasOpen, exiting: next.exiting })
  }
  if (!next.mounted) return null

  const transitionProps = props.TransitionProps
  return (
    <Menu
      {...props}
      TransitionProps={{
        ...transitionProps,
        onExited: (node) => {
          setState((s) => ({ ...s, exiting: false }))
          transitionProps?.onExited?.(node)
        }
      }}
    />
  )
}
