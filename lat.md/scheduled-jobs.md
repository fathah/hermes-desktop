# Scheduled jobs

The Schedules screen presents Hermes cron jobs consistently across local files, the remote API, and named SSH profiles.

Jobs explicitly marked `completed` keep that terminal state even though Hermes also disables them. Other disabled jobs are normalized as paused by [[src/main/cronjobs.ts#listCronJobs]]. Named-profile SSH lists use [[src/main/cronjobs.ts#parseCronListOutput]] and mark completed jobs disabled too, so active-only lists exclude terminal jobs across transports.

## Test specifications

These tests protect state normalization at the boundary between Hermes cron data and the desktop schedule model.

### Completed jobs remain completed

A disabled API job whose source state is `completed` is normalized as completed rather than paused, preserving the terminal-state badge and actions in the renderer.

### Completed SSH jobs stay disabled

Named-profile SSH output retains completed states with `enabled: false`, and active-only requests exclude those terminal jobs.

### Local terminal-state normalization

Reading a real local jobs file preserves completed states, keeps paused and legacy-disabled jobs disabled, and filters active-only results without modifying the stored job data.
