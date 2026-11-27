-- LINE reminder Mon–Fri at 17:30 Thai time (10:30 UTC): departments that have not sent today's Daily Report.
-- pg_cron calls the line-notify Edge Function with the token kept in app_secret ('dwp_cron').
-- Safe to run more than once.
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'dwp-line-reminder';
select cron.schedule('dwp-line-reminder', '30 10 * * 1-5', $job$
  select net.http_post(
    url := 'https://yfswjxzsrgngxbuajnov.supabase.co/functions/v1/line-notify',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secret where name='dwp_cron')),
    body := '{"type":"reminder"}'::jsonb,
    timeout_milliseconds := 15000)
$job$);
