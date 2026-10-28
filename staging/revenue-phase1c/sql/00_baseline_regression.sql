-- Baseline vulnerability reproduction. Transaction rolls back all test data.
-- This is the *actual* inspected Supabase fulfillment implementation before patch.
BEGIN;
DO $baseline$
DECLARE result jsonb;
BEGIN
 SELECT public.dock_fulfill_stripe_event(
 'evt_baseline_underpaid','checkout.session.completed',true,'plink_fixture',
 'cs_baseline_underpaid','pi_baseline_underpaid',null,1,'usd','fixture_hash',null
 ) INTO result;
 IF result->>'entitlement_created' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'Baseline no longer reproduces underpayment acceptance: %',result;
 END IF;
 RAISE NOTICE 'BASELINE DEFECT REPRODUCED: 1-cent event created 500-cent plan entitlement';
END $baseline$;
ROLLBACK;
