export function QueryExecutionOverlay() {
  return (
    <div
      className="pointer-events-auto absolute inset-0 z-10 animate-fade-in-delayed bg-light-smoke opacity-0 window-blurred:animate-fade-in-delayed-paused dark:bg-dark-smoke"
      data-testid="query-execution-overlay"
    />
  )
}
