# Chrome Web Store Listing (English)

## Short description (≤132 chars)
Lightweight reminder for one-off and recurring tasks with snooze, search, sync, and catch-up after sleep.

## Full description
Todorima – Optimal Reminder is a task‑centric desktop notification reminder. It helps you remember deadlines with a clean popup UI and reliable scheduling in the background.

Features
- Create tasks with title, note, due date/time, priority, and tags
- Recurrence: Daily / Weekly (select weekdays) / Monthly (with interval)
- Actions: Complete, Snooze (configurable default minutes)
- List, edit, delete, search, and sort (due ascending or by priority)
- Sync via chrome.storage.sync (signed‑in Chrome profiles)
- Catch‑up notifications after sleep (individual cap + summary)
- Reschedules only the nearest alarm to reduce drift
- Auto‑delete completed tasks after N days (configurable)
- English/Japanese UI (default: Auto – follows the browser)

How it works
- The extension registers the nearest upcoming task with `chrome.alarms`.
- On alarm fire, it shows a notification and rolls repeating tasks forward.
- On resume/start, it runs a catch‑up window to notify items missed during sleep.

Privacy
- No external servers. Your tasks and settings are stored locally and in `chrome.storage.sync` for your signed‑in Chrome profile.
- No personal data is sold or shared.

Permissions
- alarms: schedule the next reminder
- notifications: show reminders with action buttons
- storage: save tasks/settings and sync across browsers
- idle: detect active state and run catch‑up after resume

Support
- Issues and feedback: use the extension’s options page or repository issue tracker.

