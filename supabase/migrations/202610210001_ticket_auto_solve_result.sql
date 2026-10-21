-- Additive only: preserve all historical values and the legacy request flag.
-- Apply before deploying readers/writers that select these columns.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.ticket_sends
  ADD COLUMN IF NOT EXISTS auto_solve_status text,
  ADD COLUMN IF NOT EXISTS auto_solve_error text,
  ADD COLUMN IF NOT EXISTS auto_solve_recorded_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ticket_sends'::regclass
      AND conname = 'ticket_sends_auto_solve_result_check'
  ) THEN
    ALTER TABLE public.ticket_sends
      ADD CONSTRAINT ticket_sends_auto_solve_result_check CHECK (
        (auto_solve_status IS NULL AND auto_solve_error IS NULL AND auto_solve_recorded_at IS NULL)
        OR
        (auto_solve_status IS NOT NULL AND auto_solve_recorded_at IS NOT NULL
          AND isfinite(auto_solve_recorded_at)
          AND (
            (auto_solve_status = 'not_requested' AND auto_solve_error IS NULL
              AND (status = 'dry_run' OR (status = 'success' AND NOT auto_solved)))
            OR
            (status = 'success' AND auto_solved
              AND zendesk_ticket_id IS NOT NULL AND length(btrim(zendesk_ticket_id)) > 0
              AND (
                (auto_solve_status = 'solved' AND auto_solve_error IS NULL)
                OR (auto_solve_status = 'failed' AND auto_solve_error IS NOT NULL
                  AND length(btrim(auto_solve_error)) > 0)
                OR auto_solve_status = 'unknown'
              ))
          ))
      );
  END IF;
END $$;

COMMENT ON COLUMN public.ticket_sends.auto_solved IS
  'Legacy request flag: whether auto-solve was requested, not proof of completion.';
COMMENT ON COLUMN public.ticket_sends.auto_solve_status IS
  'Recorded result of this send attempt. NULL means no durable result (including legacy rows).';
COMMENT ON COLUMN public.ticket_sends.auto_solve_error IS
  'Server-provided error for a failed or uncertain solve outcome, not client input.';
COMMENT ON COLUMN public.ticket_sends.auto_solve_recorded_at IS
  'Server time when the API result was recorded, not the Zendesk solve event time or current ticket state.';

-- No UPDATE/backfill, DELETE, index, grant, policy or ownership change.
NOTIFY pgrst, 'reload schema';
COMMIT;
