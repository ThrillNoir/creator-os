# Staging D1 migration reconciliation — 2026-08-26

Observed target: `thot-os-staging` (`174532e8-5ada-4e30-abba-1276b3540b3f`). The
read-only `d1_migrations` ledger contains IDs 1–50. IDs 1–43 match the existing
repository sources; IDs 44–50 were absent from commit
`33a68fc2ef976e56ef2b306961228c311d11ad92` and were recovered byte-for-byte
from the authoritative Git commits below. D1's ledger stores filenames, not
source checksums; the recorded SHA-256 values prove the recovered working-tree
files equal their Git sources.

| D1 ID | Migration | Source commit | SHA-256 |
| ---: | --- | --- | --- |
| 44 | `0044_onlyfans_upload_bridge.sql` | `db19e0a23a158136a6c421f46a9c144154a9afc5` | `e50a0e6a6adb1f7b8acb41f1dbdf5aa25bf1838462cb415bfe670266903d066c` |
| 45 | `0045_onlyfans_authorized_delivery.sql` | `909462df24501a47e5d20bcdff2a2259f94e085c` | `0ed79edd276d93f3c30ba787040f067dc8ec761de92e25c464d5d6147be7daab` |
| 46 | `0046_onlyfans_sequential_batches.sql` | `7d55a29cb6e763901637e574524fbf25276dbc7d` | `36df35d8b9fe46e273450bf7cc4ef0f51ca6102d415794328f7ea0ca7e04d253` |
| 47 | `0047_onlyfans_supervised_delivery.sql` | `395bb725dea26323968e28dc4213132ccce05e14` | `06f65b60d01094b91fdc3dfe236e11498bf44550bd945a6ad6d4f3c705930cf4` |
| 48 | `0048_onlyfans_grouped_message_delivery.sql` | `1e9fe4d7469c999cacd1f0ba673bfdcf4c0ab242` | `8ff9d4a253350063cc65a96d93140eb48b64b276f4a0428278a66bba6cbc9ee4` |
| 49 | `0044_creator_r2_library.sql` | `75a356ff07588a4d7c6d2b18e03723e308fcaad7` | `5dc87af078d63f47ebda0db8c4d0fc105b2ee3b7bd825f0c031753f4632cd41e` |
| 50 | `0045_finished_media_uploads.sql` | `dac4ef54f4860bad1186e1330176e0a2aa1e314d` | `11955fefabd32e30d65a0d681d380768d77341b87b01bd5b78594c229d58370b` |

The duplicate `0044` and `0045` prefixes are historical facts, not a new
ordering rule. `config/staging-d1-migration-ledger.json` binds the unique
filenames, source checksums, and remote order; the bounded executor refuses a
directory or remote history that differs from that reviewed ledger. The new
creator-onboarding/Access-vault migration is therefore `0049_creator_onboarding_access_vault.sql` and is the sole pending entry.
