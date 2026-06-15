/** When false, chat skips community spread, brain, tire priors, and pre-LLM scope resolution. */
const DEEP_CONTEXT_RE =
  /\b(setup|shim|spring|droop|caster|camber|toe|diff|wing|balance|handling|understeer|oversteer|grip|lap|pace|tire|tyre|compare|change|field|median|spread|damping|roll|steer|anti-?dive|anti-?squat|ride height|bulkhead|gearbox|motor|pinion|slower|faster|mistake|sector|qualifying|practice|race|session|meeting|weekend|yesterday|today)\b/i;

export function engineerChatNeedsDeepContext(input: {
  lastUserMessage: string | undefined;
  runId: string;
  compareRunId: string;
}): boolean {
  if (input.runId.trim() || input.compareRunId.trim()) return true;
  const msg = input.lastUserMessage?.trim() ?? "";
  if (msg.length < 5) return false;
  return DEEP_CONTEXT_RE.test(msg);
}
