export function shouldAdvanceQueue(input: {
  queuePaused: boolean;
  hasActiveRun: boolean;
  hasQueued: boolean;
}): boolean {
  return !input.queuePaused && !input.hasActiveRun && input.hasQueued;
}
