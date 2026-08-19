PRAGMA foreign_keys = ON;

-- A collection receipt must expose whether provider metric coverage was good
-- enough for the weighted-growth contract. These counters are operational
-- evidence only: a missing provider metric remains unavailable, never zero.
ALTER TABLE instagram_analytics_collection_runs
  ADD COLUMN media_insights_attempted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE instagram_analytics_collection_runs
  ADD COLUMN media_insights_succeeded INTEGER NOT NULL DEFAULT 0;

ALTER TABLE instagram_analytics_collection_runs
  ADD COLUMN complete_metric_media INTEGER NOT NULL DEFAULT 0;

ALTER TABLE instagram_analytics_collection_runs
  ADD COLUMN missing_view_media INTEGER NOT NULL DEFAULT 0;

ALTER TABLE instagram_analytics_collection_runs
  ADD COLUMN missing_save_media INTEGER NOT NULL DEFAULT 0;

ALTER TABLE instagram_analytics_collection_runs
  ADD COLUMN missing_share_media INTEGER NOT NULL DEFAULT 0;
