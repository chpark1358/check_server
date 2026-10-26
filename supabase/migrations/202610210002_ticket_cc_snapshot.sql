-- Preserve legacy rows and capture only newly requested CC recipients.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.ticket_sends ADD COLUMN IF NOT EXISTS cc_emails text[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ticket_sends'::regclass
      AND conname = 'ticket_sends_cc_snapshot_check'
  ) THEN
    ALTER TABLE public.ticket_sends ADD CONSTRAINT ticket_sends_cc_snapshot_check CHECK (
      CASE
        WHEN cc_emails IS NULL THEN true
        WHEN cardinality(cc_emails) = 0 THEN true
        WHEN array_ndims(cc_emails) IS DISTINCT FROM 1 OR array_lower(cc_emails, 1) IS DISTINCT FROM 1 THEN false
        ELSE cardinality(cc_emails) <= 48
          AND array_position(cc_emails, NULL) IS NULL
          AND array_position(cc_emails, '') IS NULL
      END
    );
  END IF;
END $$;

COMMENT ON COLUMN public.ticket_sends.cc_emails IS
  'Requested CC snapshot for this send attempt. NULL means not recorded by legacy code; empty array means no CC. Not delivery evidence. Address validation and deduplication are enforced by the server.';

-- No backfill, policy, grant, ownership, or existing mapping changes.
NOTIFY pgrst, 'reload schema';
COMMIT;
