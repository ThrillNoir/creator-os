export const SAVE_COMPLIANCE_IDENTITY_SQL = `INSERT INTO creator_compliance_records (creator_id,legal_name,date_of_birth,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP)
  ON CONFLICT(creator_id) DO UPDATE SET legal_name=excluded.legal_name,date_of_birth=excluded.date_of_birth,updated_at=CURRENT_TIMESTAMP`;

export const INVALIDATE_COMPLIANCE_IDENTITY_SQL = "UPDATE creator_compliance_records SET adult_verified_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND (legal_name<>? OR date_of_birth<>?)";
export const RESET_IDENTITY_VERIFICATION_SQL = "UPDATE creator_onboarding_profiles SET adult_verification_status='submitted',updated_at=CURRENT_TIMESTAMP WHERE creator_id=? AND adult_verification_status='verified' AND EXISTS (SELECT 1 FROM creator_compliance_records WHERE creator_id=? AND (legal_name<>? OR date_of_birth<>?))";
