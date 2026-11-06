/**
 * Error-toast copy for failed Copy, Cut, Clear and Paste actions over result
 * rows (wireframe 8 of the windowed result delivery plan, verbatim).
 *
 * Every failure of one of these actions uses its action's string, whatever the
 * cause (rows that could not be fetched, or a clipboard read or write that was
 * refused). `results_expired` failures do not toast: they route to the
 * "Results expired" block instead.
 */
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
