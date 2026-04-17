# Vehicle dynamics knowledge base (Engineer)

Markdown files in this folder are **searchable reference** for the Engineer chat. The app loads `.md` files (except this README), splits them on `##` headings, and ranks sections by **keyword overlap** with the user’s latest message.

## How to add content

1. Create a new `.md` file or add sections to an existing one.
2. Use `## Section title` for chunks the retriever can score independently.
3. Write **timeless** RC vehicle-dynamics material: cause → effect, what to try first, common mistakes.
4. Prefer **universal** language (touring car / on-road) unless the file is clearly labeled for a specific platform.
5. Keep sections under ~900 characters when possible so excerpts fit the model context cleanly.

## What not to put here

- User-specific setups, lap times, or secrets.
- Long copy-pastes from copyrighted books; summarize in your own words.

## Improving retrieval later

- Add frontmatter `tags:` per file for filtering (e.g. `grip`, `understeer`, `springs`).
- Replace keyword search with embeddings when you have a stable chunking strategy and evaluation set.

## Team / “what works” data

Historical **spread** and **per-parameter position** for *your* cars come from `SetupParameterAggregation` in the database (rebuilt from your snapshots), not from this folder. Teammate-wide aggregates are a separate future product feature.
