-- Standing conversation focus for Engineer chat threads.
--
-- Explicit anchoring (founder interview 2026-07-29): the driver can pin a run, saved
-- setup, or event as the conversation's subject. The pin must survive reopening the
-- thread, so it is persisted here rather than living only in the URL. Shape is
-- EngineerThreadFocusAnchorV1: {version, kind, id, compareRunId?, setupId?, pinned, label}.
-- primaryRunId/compareRunId stay in sync for run anchors so existing readers keep working.

ALTER TABLE "EngineerChatThread" ADD COLUMN "focusAnchorJson" JSONB;
