ALTER TABLE content_download_links ADD COLUMN recipient_reference TEXT
  CHECK(recipient_reference IS NULL OR (length(recipient_reference)<=120 AND instr(recipient_reference,char(0))=0));
ALTER TABLE content_download_links ADD COLUMN amount_minor INTEGER
  CHECK(amount_minor IS NULL OR (typeof(amount_minor)='integer' AND amount_minor BETWEEN 0 AND 1000000000000));
ALTER TABLE content_download_links ADD COLUMN sale_currency TEXT
  CHECK(sale_currency IS NULL OR sale_currency IN ('AUD','USD','EUR','GBP','CAD','NZD','JPY','KWD'));
ALTER TABLE content_download_links ADD COLUMN voided_at TEXT;
ALTER TABLE content_download_links ADD COLUMN updated_at TEXT;
ALTER TABLE content_download_links ADD COLUMN updated_by TEXT;
ALTER TABLE content_download_links ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0);

CREATE TRIGGER content_download_sale_pair_insert
BEFORE INSERT ON content_download_links
WHEN (NEW.amount_minor IS NULL) != (NEW.sale_currency IS NULL)
BEGIN SELECT RAISE(ABORT,'content_download_sale_pair_required'); END;
CREATE TRIGGER content_download_sale_pair_update
BEFORE UPDATE OF amount_minor,sale_currency ON content_download_links
WHEN (NEW.amount_minor IS NULL) != (NEW.sale_currency IS NULL)
BEGIN SELECT RAISE(ABORT,'content_download_sale_pair_required'); END;

CREATE TABLE content_download_sale_audit (
  id INTEGER PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES content_download_links(id) ON DELETE CASCADE,
  event_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('sale_changed','recipient_cleared','sale_voided')),
  old_amount_minor INTEGER,
  old_currency TEXT,
  new_amount_minor INTEGER,
  new_currency TEXT
);
CREATE INDEX content_download_sale_audit_link ON content_download_sale_audit(link_id,event_at DESC);

CREATE TRIGGER content_download_sale_audit_update
AFTER UPDATE OF recipient_reference,amount_minor,sale_currency,voided_at ON content_download_links
WHEN OLD.recipient_reference IS NOT NEW.recipient_reference OR OLD.amount_minor IS NOT NEW.amount_minor
  OR OLD.sale_currency IS NOT NEW.sale_currency OR OLD.voided_at IS NOT NEW.voided_at
BEGIN
  INSERT INTO content_download_sale_audit(link_id,event_at,actor,event_type,old_amount_minor,old_currency,new_amount_minor,new_currency)
  VALUES(NEW.id,COALESCE(NEW.updated_at,CURRENT_TIMESTAMP),COALESCE(NEW.updated_by,NEW.created_by),
    CASE WHEN OLD.voided_at IS NOT NEW.voided_at AND NEW.voided_at IS NOT NULL THEN 'sale_voided'
      WHEN OLD.recipient_reference IS NOT NEW.recipient_reference AND NEW.recipient_reference IS NULL
        AND OLD.amount_minor IS NEW.amount_minor AND OLD.sale_currency IS NEW.sale_currency THEN 'recipient_cleared'
      ELSE 'sale_changed' END,
    OLD.amount_minor,OLD.sale_currency,NEW.amount_minor,NEW.sale_currency);
END;
