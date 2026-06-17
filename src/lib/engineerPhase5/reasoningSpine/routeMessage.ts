import "server-only";

import { engineerChatIsLapHistoryQuestion } from "@/lib/engineerPhase5/engineerChatContextTier";
import { parseLapHistoryQueryIntent } from "@/lib/engineerPhase5/lapHistoryQueryParse";
import type { EngineerRoute } from "@/lib/engineerPhase5/reasoningSpine/types";

const SETUP_ADVICE_RE =
  /\b(understeer|oversteer|loose|push|rotate|grip|bite|stable|handling|setup|change|try|suggest|what should i|help me|fix|calm|sharpen)\b/i;

const PLANNING_RE =
  /\b(next meeting|next race|going to|this weekend|tomorrow|first thing|consider changing|what should i consider|prepare for)\b/i;

const COMPARISON_RE =
  /\b(compare|versus|vs\.?|difference between|how do .+ look between|between .+ and .+)\b/i;

const TIRE_COMPARE_RE = /\b(tire|tyre|compound|rubber)\b/i;

const CONCEPTUAL_RE =
  /\b(what does|what is|how does|explain|why does|mechanism|physics)\b/i;

/**
 * Stage 0: classify the user message into a route for context assembly + narration.
 */
export function routeEngineerMessage(message: string): EngineerRoute {
  const msg = message.trim();
  if (!msg) return "conceptual";

  if (engineerChatIsLapHistoryQuestion(msg) || parseLapHistoryQueryIntent(msg)) {
    return "data_query";
  }

  if (COMPARISON_RE.test(msg) && (TIRE_COMPARE_RE.test(msg) || /\bsetup/i.test(msg))) {
    return "comparison";
  }

  if (PLANNING_RE.test(msg)) {
    return "planning";
  }

  if (SETUP_ADVICE_RE.test(msg)) {
    return "setup_advice";
  }

  if (CONCEPTUAL_RE.test(msg) && !/\b(my|i've|last run|this run)\b/i.test(msg)) {
    return "conceptual";
  }

  return "setup_advice";
}
