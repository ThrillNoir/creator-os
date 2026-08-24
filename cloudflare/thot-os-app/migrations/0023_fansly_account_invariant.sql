PRAGMA foreign_keys = ON;

-- Fansly bridge setup selects one account per creator. Enforce that invariant in
-- storage so concurrent form submissions cannot create an inaccessible account.
CREATE UNIQUE INDEX IF NOT EXISTS operational_accounts_one_fansly_per_creator
  ON operational_accounts(creator_id)
  WHERE platform='fansly';
