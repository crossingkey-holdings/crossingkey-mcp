-- Run only against disposable PostgreSQL (no live data, no payment credentials).
-- Requires 01_snapshot_generic.sql, 02_actual_fulfillment.sql, then
-- 03_guarded_fulfillment_candidate.sql.
DO $tests$
DECLARE x jsonb; n int; mismatched boolean;
BEGIN
 SELECT public.dock_fulfill_stripe_event('evt_good','checkout.session.completed',true,'plink_fixture','cs_good','pi_good',null,500,'usd','hash',null) INTO x;
 IF x->>'entitlement_created' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'valid checkout was not granted: %', x; END IF;
 SELECT count(*) INTO n FROM public.dock_entitlements;
 IF n <> 1 THEN RAISE EXCEPTION 'expected one entitlement, got %',n; END IF;

 -- Event replay (same Stripe event ID) cannot grant again.
 SELECT public.dock_fulfill_stripe_event('evt_good','checkout.session.completed',true,'plink_fixture','cs_good','pi_good',null,500,'usd','hash',null) INTO x;
 SELECT count(*) INTO n FROM public.dock_entitlements;
 IF n <> 1 OR x->>'duplicate' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'same event replay double-granted'; END IF;

 -- Different Stripe event ID, same Checkout Session, cannot grant twice.
 SELECT public.dock_fulfill_stripe_event('evt_second','checkout.session.async_payment_succeeded',true,'plink_fixture','cs_good','pi_good',null,500,'usd','hash',null) INTO x;
 SELECT count(*) INTO n FROM public.dock_entitlements;
 IF n <> 1 OR x->>'duplicate' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'same session double-granted'; END IF;

 -- Unrelated valid checkout can grant a distinct entitlement.
 SELECT public.dock_fulfill_stripe_event('evt_new','checkout.session.completed',true,'plink_fixture','cs_new','pi_new',null,500,'usd','hash',null) INTO x;
 SELECT count(*) INTO n FROM public.dock_entitlements;
 IF n <> 2 THEN RAISE EXCEPTION 'second distinct checkout not granted'; END IF;

 -- Sandbox valid purchase must produce evidence, not production access.
 SELECT public.dock_fulfill_stripe_event('evt_test','checkout.session.completed',false,'plink_fixture','cs_test','pi_test',null,500,'usd','hash',null) INTO x;
 SELECT count(*) INTO n FROM public.dock_entitlements;
 IF n <> 2 OR x->>'entitlement_created' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'sandbox granted access'; END IF;

 -- Unsupported payment intent event must never grant a mapped entitlement.
 SELECT public.dock_fulfill_stripe_event('evt_intent','payment_intent.succeeded',true,'plink_fixture','cs_intent','pi_intent',null,500,'usd','hash',null) INTO x;
 SELECT count(*) INTO n FROM public.dock_entitlements;
 IF n <> 2 OR x->>'entitlement_created' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'payment_intent event granted entitlement'; END IF;

 -- A refund event on the generic path must never create a new entitlement.
 SELECT public.dock_fulfill_stripe_event('evt_refund','charge.refunded',true,'plink_fixture','cs_refund','pi_refund',null,500,'usd','hash',null) INTO x;
 SELECT count(*) INTO n FROM public.dock_entitlements;
 IF n <> 2 OR x->>'entitlement_created' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'refund event granted entitlement'; END IF;

 -- Unknown / missing checkout session cannot grant an entitlement.
 SELECT public.dock_fulfill_stripe_event('evt_missing','checkout.session.completed',true,'plink_fixture',null,'pi_missing',null,500,'usd','hash',null) INTO x;
 SELECT count(*) INTO n FROM public.dock_entitlements;
 IF n <> 2 OR x->>'entitlement_created' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'missing session granted'; END IF;

 -- Wrong payment link does not grant.
 SELECT public.dock_fulfill_stripe_event('evt_wrong_link','checkout.session.completed',true,'unknown_link','cs_wrong_link','pi_wrong_link',null,500,'usd','hash',null) INTO x;
 SELECT count(*) INTO n FROM public.dock_entitlements;
 IF n <> 2 OR x->>'entitlement_created' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'wrong link granted'; END IF;

 -- Amount mismatch must fail and roll back the event insert atomically.
 mismatched:=false;
 BEGIN
  PERFORM public.dock_fulfill_stripe_event('evt_under','checkout.session.completed',true,'plink_fixture','cs_under','pi_under',null,1,'usd','hash',null);
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='generic_plan_payment_mismatch' THEN mismatched:=true; ELSE RAISE; END IF;
 END;
 IF NOT mismatched THEN RAISE EXCEPTION 'underpayment accepted'; END IF;

 mismatched:=false;
 BEGIN
  PERFORM public.dock_fulfill_stripe_event('evt_currency','checkout.session.completed',true,'plink_fixture','cs_currency','pi_currency',null,500,'usdc','hash',null);
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='generic_plan_payment_mismatch' THEN mismatched:=true; ELSE RAISE; END IF;
 END;
 IF NOT mismatched THEN RAISE EXCEPTION 'currency mismatch accepted'; END IF;
 SELECT count(*) INTO n FROM public.dock_entitlements;
 IF n<>2 THEN RAISE EXCEPTION 'mismatch leaked entitlements'; END IF;

 RAISE NOTICE 'PASS: 11 SQL assertions on real function body and patched staging candidate';
END
$tests$;

SELECT 'database_checks_passed' AS result,
       (SELECT count(*) FROM public.dock_entitlements) AS valid_entitlements,
       (SELECT count(*) FROM public.dock_receipts) AS receipts;
