export type ComplianceIdentity = { legalName: string; dateOfBirth: string };

export function complianceIdentityChanged(previous: ComplianceIdentity | null | undefined, next: ComplianceIdentity) {
  return Boolean(previous && (previous.legalName !== next.legalName || previous.dateOfBirth !== next.dateOfBirth));
}

export const SAVE_COMPLIANCE_IDENTITY_SQL = `INSERT INTO creator_compliance_records (creator_id,legal_name,date_of_birth,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP)
  ON CONFLICT(creator_id) DO UPDATE SET legal_name=excluded.legal_name,date_of_birth=excluded.date_of_birth,updated_at=CURRENT_TIMESTAMP`;

export const INVALIDATE_COMPLIANCE_IDENTITY_SQL = "UPDATE creator_compliance_records SET adult_verified_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE creator_id=?";
export const RESET_IDENTITY_VERIFICATION_SQL = "UPDATE creator_onboarding_profiles SET adult_verification_status=CASE WHEN adult_verification_status='verified' THEN 'submitted' ELSE adult_verification_status END,updated_at=CURRENT_TIMESTAMP WHERE creator_id=?";
