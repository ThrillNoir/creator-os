# Creator OS performance loop

Creator OS keeps preparation, approval, handoff, publication and measurement as separate states.

## Publication matching

- Direct Instagram API publications receive an exact provider receipt and can be matched automatically once the media object is readable.
- Finish-on-device posts require a human to confirm the exact candidate returned by Instagram analytics.
- Time proximity and caption overlap may rank candidates, but never confirm them.
- Edited or re-approved packages are not assumed to represent an earlier live publication.

## Outcome snapshots

Confirmed matches receive a refreshable `latest` snapshot and the first eligible 1-hour, 24-hour and 7-day milestone. If the first sync arrives after a milestone, the record is an approximate later observation and retains its actual elapsed hours.

## Scheduling

`Use best slot` selects from the creator's current Instagram recommendations, looks up to 21 days ahead and keeps at least four hours between Instagram variants. Changing an approved time supersedes that approval and returns the package to review.

## Creator reminders

Reminder rules prepare two drafts around scheduled content: a posting-due reminder and an overdue confirmation. Draft creation does not send Telegram messages. Each reminder needs human approval and a separate `Send now` action.

## Activity history

The Activity page combines creator-scoped operational records while retaining their category and status. A Telegram handoff is not a publication; a publication is not a measured outcome; and a reminder approval is not a sent message.
