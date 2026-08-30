# Staging native-video intake migration receipt

- Environment: staging only
- Release: `native-video-intake`
- Plan confirmation: `bounded:56c545aa473b67b8`
- Plan SHA-256: `56c545aa473b67b8b32692a7e473c0f93a9fc423d5fd775fa3e50abba40fa95a`
- Selected migration: `0054_native_video_intake.sql`
- Migration SHA-256: `f2cde4f908b498e0c6ed6f0e34b0d4f70b3db8d5fe54b5608d86d930b176be27`
- Fresh owner-only backup checksum: `f0b2be96710a2b047796e1a3a5cf2be3f9f6bd99241da945cd538ef854c877cb`
- Apply result: `APPLIED`; remote mutation confirmed
- Authoritative remote `d1_migrations` ID: `56`
- Remote schema checks: all four video tables present; `PRAGMA quick_check` returned `ok`; `PRAGMA foreign_key_check` returned no rows.
- Production touched: no

The repository staging ledger was reconciled from the observed remote migration
row. No application deployment, provider provisioning, secret change, media
upload, or consumer cutover is included in this receipt.
