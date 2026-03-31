/**
 * Full-auto mainline begins only after the user has explicitly approved the
 * analyze confirmation. Once that approval exists, HelloLoop should continue
 * the backlog instead of stopping at medium/high/critical risk gates that are
 * meant for manual run-once / run-loop invocations.
 */
export function resolveFullAutoMainlineOptions(options = {}) {
  return {
    ...options,
    allowHighRisk: true,
    fullAutoMainline: true,
  };
}
