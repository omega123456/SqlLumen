export type ClipboardAction = 'copy' | 'cut' | 'clear' | 'paste'

export interface ClipboardActionFailure {
  title: string
  message: string
}

export const CLIPBOARD_ACTION_FAILURES: Readonly<Record<ClipboardAction, ClipboardActionFailure>> =
  {
    copy: {
      title: 'Copy failed',
      message: "Couldn't load all selected rows. Nothing was copied. Try again.",
    },
    cut: {
      title: 'Cut failed',
      message: "Couldn't load all selected rows. Nothing was cut. Try again.",
    },
    clear: {
      title: 'Clear failed',
      message: "Couldn't load all selected rows. No cells were cleared. Try again.",
    },
    paste: {
      title: 'Paste failed',
      message: "Couldn't load all target rows. Nothing was pasted. Try again.",
    },
  }
