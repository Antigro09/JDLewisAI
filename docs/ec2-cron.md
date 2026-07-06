# Background jobs on EC2 (no Vercel Cron)

`vercel.json` only schedules `/api/cron/run` **on Vercel**. On the EC2
deployment nothing fires the cron endpoints by itself, so the automations
runner and the meeting janitor each need a trigger:

## Meeting janitor + retention purge

Two equivalent options — pick ONE:

1. **In-process scheduler (recommended for the current single-instance box).**
   Set `ENABLE_INPROCESS_SCHEDULER=true` in the server environment. At boot,
   `instrumentation.ts` starts `lib/meetings/scheduler.ts`, which runs
   `sweepStaleMeetings()` + `purgeExpiredTranscripts()` every 5 minutes inside
   the Node process (no HTTP). This assumes a **single** app instance —
   multi-instance deployments must use option 2 on exactly one scheduler.
2. **External scheduler.** Leave the flag unset and have a system cron or
   systemd timer hit the endpoint:

   ```
   */5 * * * * curl -fsS -X POST https://YOUR_APP/api/cron/meetings \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

## Automations (`/api/cron/run`)

The in-process scheduler does **not** run automations. They always need an
external trigger on EC2 (same contract Vercel Cron uses):

```
*/15 * * * * curl -fsS -X POST https://YOUR_APP/api/cron/run \
  -H "Authorization: Bearer $CRON_SECRET"
```

Both endpoints are idempotent and safe to double-fire; they reject requests
without the correct `Authorization: Bearer $CRON_SECRET` header.
