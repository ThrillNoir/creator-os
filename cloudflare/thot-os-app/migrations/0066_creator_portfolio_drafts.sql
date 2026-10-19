PRAGMA foreign_keys = ON;

-- Private authoring state only. No row in these tables is a public release.
-- Public delivery uses a separately approved, versioned projection.
CREATE TABLE creator_portfolio_categories (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 50),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 9999),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id, creator_id),
  UNIQUE(creator_id, name COLLATE NOCASE)
);
CREATE INDEX creator_portfolio_categories_order ON creator_portfolio_categories(creator_id, sort_order, name);

CREATE TABLE creator_portfolio_genres (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 50),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 9999),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id, creator_id),
  UNIQUE(creator_id, name COLLATE NOCASE)
);
CREATE INDEX creator_portfolio_genres_order ON creator_portfolio_genres(creator_id, sort_order, name);

CREATE TABLE creator_portfolio_items (
  asset_id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  category_id TEXT,
  genre_id TEXT,
  preview_asset_id TEXT,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 100),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 280),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 9999),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL,
  UNIQUE(asset_id, creator_id),
  FOREIGN KEY(asset_id, creator_id) REFERENCES assets(id, creator_id) ON DELETE CASCADE,
  FOREIGN KEY(preview_asset_id, creator_id) REFERENCES assets(id, creator_id),
  FOREIGN KEY(category_id, creator_id) REFERENCES creator_portfolio_categories(id, creator_id),
  FOREIGN KEY(genre_id, creator_id) REFERENCES creator_portfolio_genres(id, creator_id)
);
CREATE INDEX creator_portfolio_items_order ON creator_portfolio_items(creator_id, sort_order, asset_id);

CREATE TABLE creator_portfolio_events (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  asset_id TEXT,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('item_added','item_removed','item_saved','category_created','category_renamed','genre_created','genre_renamed')),
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX creator_portfolio_events_recent ON creator_portfolio_events(creator_id, created_at DESC, id DESC);
