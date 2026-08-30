export type ImmutableR2Record = { byte_count: number; r2_version: string | null; r2_etag: string | null };
export type ImmutableR2Object = { size: number; version: string; etag: string };

export function immutableR2IdentityMatches(record: ImmutableR2Record, object: ImmutableR2Object | null | undefined) {
  return Boolean(record.r2_version && record.r2_etag && object && object.size === record.byte_count && object.version === record.r2_version && object.etag === record.r2_etag);
}
