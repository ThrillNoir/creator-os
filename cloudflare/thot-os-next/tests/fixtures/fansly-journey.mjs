export const creatorReady = {
  creatorName: 'Creator A', actorLabel: 'Creator', role: 'creator',
  accountLabel: 'Creator A Fansly', profileLabel: 'Profile A', profileStatus: 'paired',
  identityConfirmed: true, credentialActive: true, pairingVerified: true,
  lastSeenAt: '2026-10-18T08:00:00Z', lastSeenLabel: '18 Oct 2026, 4:00 pm',
};

export const creatorNotCheckedIn = {
  creatorName: 'Creator B', actorLabel: 'Creator', role: 'creator',
  accountLabel: 'Creator B Fansly', profileLabel: 'Profile B', profileStatus: 'paired',
  identityConfirmed: true, credentialActive: true, pairingVerified: true,
  lastSeenAt: null, lastSeenLabel: 'Not recorded',
};

export const agencyRevoked = {
  ...creatorNotCheckedIn,
  actorLabel: 'Agency administrator', role: 'agency', profileStatus: 'revoked',
};

export const verifiedJob = {
  id: 'job-verified', status: 'verified', basename: 'Approved photo.jpg', receipt: '{"outcome":"verified"}',
};

export const uncertainJob = {
  id: 'job-uncertain', status: 'failed', basename: 'Check before retry.jpg', receipt: '{"outcome":"uncertain","uploadStarted":true}',
};
