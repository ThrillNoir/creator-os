// A new social profile on an already-active creator is reviewed on its own.
// It must not reactivate a retired account or grant provider publishing access.
export const approveCreatorSocialAccountSql = `
  UPDATE operational_accounts SET is_active=1,updated_at=CURRENT_TIMESTAMP
  WHERE id=? AND creator_id=? AND account_kind='social' AND platform IN ('instagram','tiktok','reddit')
    AND is_active=0 AND creator_visible=1 AND publishing_authority='not_configured'
    AND EXISTS (SELECT 1 FROM creator_onboarding_profiles p WHERE p.creator_id=operational_accounts.creator_id AND p.workflow_state='active')
    AND EXISTS (SELECT 1 FROM creator_access_audit_events e WHERE e.creator_id=operational_accounts.creator_id
      AND e.subject=operational_accounts.id AND e.actor_role='creator' AND e.event_type='onboarding_operational_account_created')
`;

export const auditApprovedCreatorSocialAccountSql = `
  INSERT INTO creator_access_audit_events (id,creator_id,actor_email,actor_role,event_type,subject,detail)
  SELECT ?,?,?,?,'creator_social_profile_approved',?,? WHERE changes()=1
`;
