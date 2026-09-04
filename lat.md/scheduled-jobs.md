# Scheduled jobs

The Schedules screen presents Hermes cron jobs consistently across local files, the remote API, and named SSH profiles.

Jobs explicitly marked `completed` keep that terminal state even though Hermes also disables them. Other disabled jobs are normalized as paused by [[src/main/cronjobs.ts#listCronJobs]].

## Test specifications

These tests protect state normalization at the boundary between Hermes cron data and the desktop schedule model.

### Completed jobs remain completed

A disabled API job whose source state is `completed` is normalized as completed rather than paused, preserving the terminal-state badge and actions in the renderer.
