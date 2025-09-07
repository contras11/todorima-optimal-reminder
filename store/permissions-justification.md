#+ Permissions Justification

- alarms: Required to schedule the next upcoming reminder precisely and re-register after it fires.
- notifications: Required to show reminders, and provide action buttons (Complete / Snooze).
- storage: Required to store tasks and settings locally and in chrome.storage.sync for cross-browser sync under the user’s account.
- idle: Used to detect when the user becomes active again to run catch-up logic for items that became due during sleep.

No additional or optional host permissions are requested.

