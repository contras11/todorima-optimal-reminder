# Privacy Policy — Todorima – Optimal Reminder

Last updated: 2025‑09‑07

Overview

- This extension stores your tasks and settings locally and in `chrome.storage.sync` so that they can sync between your signed‑in Chrome browsers.
- The extension does not transmit your data to any external servers controlled by the developer.

Data we store

- Tasks: title, optional note, due time, recurrence, priority, tags, timestamps
- Settings: notification preferences, snooze minutes, theme, week start, retention, language, etc.

How data is used

- To schedule reminders, show notifications, and render the popup/options UI.
- For catch‑up after resume, the extension compares the last checked time with due times to notify missed items.

Sharing

- We do not sell or share personal information.
- Data is only stored locally and in `chrome.storage.sync` under your Google account.

Permissions rationale

- alarms: schedule reminders
- notifications: display reminder notifications
- storage: persist tasks and settings (including sync)
- idle: detect active state for catch‑up after resume

Data retention and deletion

- Completed tasks can be auto‑deleted after a user‑configurable number of days (default 30 days).
- You can delete tasks at any time from the popup UI.
- You can remove all data by uninstalling the extension and clearing `chrome.storage.sync` data.

Contact

- Please use the repository’s issue tracker for questions or requests.
