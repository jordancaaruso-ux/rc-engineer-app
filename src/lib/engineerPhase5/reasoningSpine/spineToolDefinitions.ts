import "server-only";

/** OpenAI tool definitions for reasoning-spine hybrid retrieval (Phase 4). */
export const SPINE_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "get_param_spread",
      description:
        "Fetch setup-vs-spread rows for an anchor run (current value, community median, positionBand, grip trend). Use when hybrid context trimmed spread or user asks about specific parameters.",
      parameters: {
        type: "object",
        properties: {
          anchor_run_id: { type: "string", description: "User's run id to anchor spread." },
          parameter_keys: {
            type: "array",
            items: { type: "string" },
            description: "Optional filter — canonical keys like toe_rear, damper_oil_rear.",
          },
        },
        required: ["anchor_run_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "kb_search",
      description:
        "Search vehicle-dynamics KB excerpts by query. Prefer over inventing physics when context KB is trimmed.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer", description: "Default 6, max 12." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "compare_tires",
      description:
        "Compare pace stats between two tire labels (substring match on compound/set label). Optional track_query filter.",
      parameters: {
        type: "object",
        properties: {
          tire_label_a: { type: "string" },
          tire_label_b: { type: "string" },
          track_query: { type: "string", description: "Optional track name or LiveRC slug." },
          calendar_time_zone: { type: "string", description: "IANA timezone for when labels." },
        },
        required: ["tire_label_a", "tire_label_b"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "tire_history_at_track",
      description:
        "Best-lap / avg-top-10 summary per tire compound at a track (aggregated from user's runs).",
      parameters: {
        type: "object",
        properties: {
          track_query: { type: "string" },
          tire_label_contains: { type: "string", description: "Optional substring filter on tire label." },
          calendar_time_zone: { type: "string" },
          max_results: { type: "integer" },
        },
        required: ["track_query"],
        additionalProperties: false,
      },
    },
  },
] as const;

export const SPINE_TOOL_INSTRUCTIONS = `
Spine retrieval tools (use when hybridContextMode is true or spread/KB is missing):
- get_param_spread: on-demand setupVsSpread rows for specific keys on a run id.
- kb_search: vehicle-dynamics KB excerpts (chunk index + fallback retrieval).
- compare_tires: pace comparison between two tire labels; optional track filter.
- tire_history_at_track: per-tire pace rollup at a track.
Always use run ids from search_runs, focusedRunPair, or context — never invent ids.`;
