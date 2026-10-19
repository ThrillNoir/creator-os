-- AMA intake is separate from the private creator inbox. No route imports
-- questions until its own abuse and consent checks are ready.
CREATE TABLE ama_questions (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL CHECK(length(trim(question_text)) BETWEEN 1 AND 2000),
  source TEXT NOT NULL CHECK(source IN ('public','telegram','import')),
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TEXT,
  UNIQUE(id, creator_id)
);
CREATE INDEX ama_questions_creator_received ON ama_questions(creator_id, received_at DESC, id);

-- Revisions are immutable. A draft save never makes an answer public.
CREATE TABLE ama_answer_revisions (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  answer_text TEXT NOT NULL CHECK(length(trim(answer_text)) BETWEEN 1 AND 5000),
  author_email TEXT NOT NULL COLLATE NOCASE REFERENCES users(email),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(question_id, creator_id, revision),
  UNIQUE(id, question_id, creator_id),
  FOREIGN KEY(question_id, creator_id) REFERENCES ama_questions(id, creator_id) ON DELETE RESTRICT
);
CREATE INDEX ama_revisions_question ON ama_answer_revisions(creator_id, question_id, revision DESC);

CREATE TABLE ama_audit_events (
  id INTEGER PRIMARY KEY,
  creator_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  actor_email TEXT NOT NULL COLLATE NOCASE,
  event_type TEXT NOT NULL CHECK(event_type IN ('draft_saved')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(revision_id, question_id, creator_id)
    REFERENCES ama_answer_revisions(id, question_id, creator_id) ON DELETE RESTRICT
);
CREATE INDEX ama_audit_creator_created ON ama_audit_events(creator_id, created_at DESC);

-- The receipt is written with the revision, even if a caller omits it.
CREATE TRIGGER ama_revision_audit AFTER INSERT ON ama_answer_revisions
BEGIN
  INSERT INTO ama_audit_events(creator_id, question_id, revision_id, actor_email, event_type)
  VALUES(NEW.creator_id, NEW.question_id, NEW.id, NEW.author_email, 'draft_saved');
END;

CREATE TRIGGER ama_revision_no_update BEFORE UPDATE ON ama_answer_revisions
BEGIN SELECT RAISE(ABORT, 'ama_revision_immutable'); END;
CREATE TRIGGER ama_revision_no_delete BEFORE DELETE ON ama_answer_revisions
BEGIN SELECT RAISE(ABORT, 'ama_revision_immutable'); END;
CREATE TRIGGER ama_audit_no_update BEFORE UPDATE ON ama_audit_events
BEGIN SELECT RAISE(ABORT, 'ama_audit_immutable'); END;
CREATE TRIGGER ama_audit_no_delete BEFORE DELETE ON ama_audit_events
BEGIN SELECT RAISE(ABORT, 'ama_audit_immutable'); END;

-- Local-only publication proof. This file is a fixture, not an applied D1 migration.
CREATE TABLE ama_publications (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  creator_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  revision_id TEXT,
  profile_version_id TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('publish','withdraw')),
  safety TEXT CHECK(safety='sfw'),
  CHECK((action='publish' AND revision_id IS NOT NULL AND safety='sfw') OR (action='withdraw' AND revision_id IS NULL AND safety IS NULL)),
  FOREIGN KEY(revision_id,question_id,creator_id) REFERENCES ama_answer_revisions(id,question_id,creator_id),
  FOREIGN KEY(question_id,creator_id) REFERENCES ama_questions(id,creator_id)
);
CREATE INDEX ama_publications_creator_question ON ama_publications(creator_id,question_id,sequence DESC);
CREATE TABLE ama_projection_delivery_state (
  creator_id TEXT PRIMARY KEY,
  delivered_sequence INTEGER NOT NULL DEFAULT 0 CHECK(delivered_sequence>=0)
);
CREATE TRIGGER ama_publication_no_update BEFORE UPDATE ON ama_publications
BEGIN SELECT RAISE(ABORT, 'ama_publication_immutable'); END;
CREATE TRIGGER ama_publication_no_delete BEFORE DELETE ON ama_publications
BEGIN SELECT RAISE(ABORT, 'ama_publication_immutable'); END;
