-- 0008 (Backend & Database), LOCAL ONLY until QA green. QA P3: DB-backed newsletter rate limit (replaces the
-- per-instance in-memory limiter). Stores only hashes; rows older than 24h are pruned on every call.
CREATE TABLE "newsletter_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "newsletter_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ip_hash" text,
	"email_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_attempts_ip_hash_fmt" CHECK ("newsletter_attempts"."ip_hash" IS NULL OR "newsletter_attempts"."ip_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "newsletter_attempts_email_hash_fmt" CHECK ("newsletter_attempts"."email_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "newsletter_attempts_ip_idx" ON "newsletter_attempts" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "newsletter_attempts_email_idx" ON "newsletter_attempts" USING btree ("email_hash","created_at");--> statement-breakpoint
CREATE INDEX "newsletter_attempts_created_idx" ON "newsletter_attempts" USING btree ("created_at");--> statement-breakpoint

alter table public.newsletter_attempts enable row level security;
revoke all on table public.newsletter_attempts from public, anon, authenticated, service_role;
revoke all on sequence public.newsletter_attempts_id_seq from public, anon, authenticated, service_role;

-- newsletter_attempt(ip_hash, email_hash, limits...) returns boolean (true = allowed).
-- One call = prune (> 24h) + record this attempt + count both windows. Serialized per email (and per IP) with
-- transaction advisory locks so parallel requests cannot all slip under the limit.
-- p_ip_hash NULL (no trusted client IP) => per-email limit only.
create or replace function public.newsletter_attempt(
  p_ip_hash text,
  p_email_hash text,
  p_ip_limit int default 10,
  p_ip_window interval default interval '10 minutes',
  p_email_limit int default 3,
  p_email_window interval default interval '1 hour')
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ip_n int := 0;
  v_email_n int;
begin
  if p_email_hash is null or p_email_hash !~ '^[0-9a-f]{64}$' or (p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$')
     or p_ip_limit < 1 or p_email_limit < 1 or p_ip_window > interval '24 hours' or p_email_window > interval '24 hours' then
    perform app_private.raise_app_error('VALIDATION_ERROR', jsonb_build_object('field', 'newsletter_attempt'));
  end if;
  perform pg_advisory_xact_lock(hashtextextended('newsletter:email:' || p_email_hash, 0));
  if p_ip_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended('newsletter:ip:' || p_ip_hash, 0));
  end if;

  delete from public.newsletter_attempts where created_at < now() - interval '24 hours';
  insert into public.newsletter_attempts (ip_hash, email_hash) values (p_ip_hash, p_email_hash);

  select count(*) into v_email_n from public.newsletter_attempts
   where email_hash = p_email_hash and created_at > now() - p_email_window;
  if p_ip_hash is not null then
    select count(*) into v_ip_n from public.newsletter_attempts
     where ip_hash = p_ip_hash and created_at > now() - p_ip_window;
  end if;
  return v_email_n <= p_email_limit and v_ip_n <= p_ip_limit;
end $$;

revoke all on function public.newsletter_attempt(text, text, int, interval, int, interval) from public, anon, authenticated;
grant execute on function public.newsletter_attempt(text, text, int, interval, int, interval) to service_role;
