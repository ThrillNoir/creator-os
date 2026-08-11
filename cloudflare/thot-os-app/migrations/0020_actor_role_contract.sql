PRAGMA foreign_keys = ON;

-- Contract step for the temporary Phase 1D-H compatibility layer.
-- Migration 0019 intentionally left DEFAULT 'legacy' in place so rollback
-- writers could survive the expand interval. All deployed writers now supply a
-- server-derived role, so the default must be impossible to use for new rows.
--
-- We retain the existing columns and CHECK constraints to avoid rebuilding six
-- historical audit tables in D1. These triggers reject the temporary default,
-- NULL/empty values, and every unrecognised role on INSERT. UPDATE triggers
-- enforce the same contract and make historical legacy rows immutable while
-- leaving them readable as truthful provenance.

CREATE TRIGGER asset_classification_actor_role_contract_insert
BEFORE INSERT ON asset_classification_events
WHEN NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER asset_classification_actor_role_contract_update
BEFORE UPDATE ON asset_classification_events
WHEN OLD.actor_role='legacy' OR NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER social_post_actor_role_contract_insert
BEFORE INSERT ON social_post_events
WHEN NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER social_post_actor_role_contract_update
BEFORE UPDATE ON social_post_events
WHEN OLD.actor_role='legacy' OR NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER reddit_community_actor_role_contract_insert
BEFORE INSERT ON reddit_community_events
WHEN NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER reddit_community_actor_role_contract_update
BEFORE UPDATE ON reddit_community_events
WHEN OLD.actor_role='legacy' OR NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER vault_upload_actor_role_contract_insert
BEFORE INSERT ON vault_upload_events
WHEN NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER vault_upload_actor_role_contract_update
BEFORE UPDATE ON vault_upload_events
WHEN OLD.actor_role='legacy' OR NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER messaging_audit_actor_role_contract_insert
BEFORE INSERT ON messaging_audit_events
WHEN NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER messaging_audit_actor_role_contract_update
BEFORE UPDATE ON messaging_audit_events
WHEN OLD.actor_role='legacy' OR NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER identity_audit_actor_role_contract_insert
BEFORE INSERT ON identity_audit_events
WHEN NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;

CREATE TRIGGER identity_audit_actor_role_contract_update
BEFORE UPDATE ON identity_audit_events
WHEN OLD.actor_role='legacy' OR NEW.actor_role IS NULL OR NEW.actor_role NOT IN ('agency_admin','operator','creator','viewer','service')
BEGIN
  SELECT RAISE(ABORT, 'audit_actor_role_contract');
END;
