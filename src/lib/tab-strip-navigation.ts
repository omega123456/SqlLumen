type TabStripTarget = (currentIndex: number, tabCount: number) => number

export const TAB_STRIP_NAVIGATION: Record<string, TabStripTarget> = {
  ArrowRight: (currentIndex, tabCount) => Math.min(currentIndex + 1, tabCount - 1),
  ArrowLeft: (currentIndex) => Math.max(currentIndex - 1, 0),
  Home: () => 0,
  End: (_currentIndex, tabCount) => tabCount - 1,
}
