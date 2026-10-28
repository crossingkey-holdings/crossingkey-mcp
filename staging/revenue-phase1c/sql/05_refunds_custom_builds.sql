-- Disposable DB-only tests for refund lifecycle and custom Agent Dock builds.
DO $tests$
DECLARE
 x jsonb; n integer; build_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 rejected boolean;
BEGIN
 -- Generic plan purchase + refund, with duplicate refund protection.
 SELECT public.dock_fulfill_stripe_event('evt_rp','checkout.session.completed',true,'plink_fixture','cs_rp','pi_rp',null,500,'usd','hash',null) INTO x;
 IF x->>'entitlement_created' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'generic purchase failed'; END IF;
 SELECT public.dock_fulfill_stripe_event('evt_rf','charge.refunded',true,null,null,'pi_rp',null,500,'usd','hash',null) INTO x;
 IF x->>'revoked' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'refund failed: %',x; END IF;
 SELECT count(*) INTO n FROM public.dock_entitlements WHERE stripe_payment_intent_id='pi_rp' AND status='revoked';
 IF n<>1 THEN RAISE EXCEPTION 'generic entitlement not revoked'; END IF;
 SELECT count(*) INTO n FROM public.dock_receipts WHERE receipt_type='revocation';
 IF n<>1 THEN RAISE EXCEPTION 'refund receipt missing'; END IF;
 PERFORM public.dock_fulfill_stripe_event('evt_rf_again','charge.refunded',true,null,null,'pi_rp',null,500,'usd','hash',null);
 SELECT count(*) INTO n FROM public.dock_receipts WHERE receipt_type='revocation';
 IF n<>1 THEN RAISE EXCEPTION 'duplicate refund created duplicate revocation'; END IF;

 -- Unknown custom build must not silently fall back to a generic plan.
 rejected:=false;
 BEGIN
  PERFORM public.dock_fulfill_stripe_event('evt_unknown_build','checkout.session.completed',true,'plink_1UUZPsHL8NkFtBuMfWxSJvxO','cs_unknown_build','pi_unknown_build',null,2900,'usd','hash','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='unknown_custom_build_reference' THEN rejected:=true; ELSE RAISE; END IF;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'unknown build did not fail closed'; END IF;

 INSERT INTO public.dock_builds(id,owner_id,status,price_cents,currency)
 VALUES(build_id,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','awaiting_payment',2900,'usd');
 -- Strict build link / amount / currency.
 rejected:=false;
 BEGIN
  PERFORM public.dock_fulfill_stripe_event('evt_build_under','checkout.session.completed',true,'plink_1UUZPsHL8NkFtBuMfWxSJvxO','cs_build_under','pi_build_under',null,1,'usd','hash',build_id::text);
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='build_payment_mismatch' THEN rejected:=true; ELSE RAISE; END IF;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'underpaid build allowed'; END IF;
 rejected:=false;
 BEGIN
  PERFORM public.dock_fulfill_stripe_event('evt_build_currency','checkout.session.completed',true,'plink_1UUZPsHL8NkFtBuMfWxSJvxO','cs_build_currency','pi_build_currency',null,2900,'usdc','hash',build_id::text);
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='build_payment_mismatch' THEN rejected:=true; ELSE RAISE; END IF;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'wrong currency build allowed'; END IF;

 SELECT public.dock_fulfill_stripe_event('evt_build_ok','checkout.session.completed',true,'plink_1UUZPsHL8NkFtBuMfWxSJvxO','cs_build_ok','pi_build_ok',null,2900,'usd','hash',build_id::text) INTO x;
 IF x->>'entitlement_created' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'valid custom build rejected: %',x; END IF;
 SELECT count(*) INTO n FROM public.dock_builds WHERE id=build_id AND status='paid';
 IF n<>1 THEN RAISE EXCEPTION 'custom build was not marked paid'; END IF;
 SELECT count(*) INTO n FROM public.dock_entitlements WHERE stripe_payment_intent_id='pi_build_ok' AND owner_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 IF n<>1 THEN RAISE EXCEPTION 'custom entitlement owner mismatch'; END IF;
 SELECT public.dock_fulfill_stripe_event('evt_build_duplicate','checkout.session.completed',true,'plink_1UUZPsHL8NkFtBuMfWxSJvxO','cs_build_ok','pi_build_ok',null,2900,'usd','hash',build_id::text) INTO x;
 IF x->>'duplicate' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'repeat build not idempotent'; END IF;

 SELECT public.dock_fulfill_stripe_event('evt_build_refund','charge.refunded',true,null,null,'pi_build_ok',null,2900,'usd','hash',null) INTO x;
 IF x->>'revoked' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'build refund not revoked'; END IF;
 SELECT count(*) INTO n FROM public.dock_builds WHERE id=build_id AND status='revoked';
 IF n<>1 THEN RAISE EXCEPTION 'build still paid after refund'; END IF;
 SELECT count(*) INTO n FROM public.dock_entitlements WHERE stripe_payment_intent_id='pi_build_ok' AND status='revoked';
 IF n<>1 THEN RAISE EXCEPTION 'build entitlement not revoked'; END IF;
 SELECT count(*) INTO n FROM public.dock_receipts WHERE receipt_type='revocation' AND entitlement_id IN (SELECT id FROM public.dock_entitlements WHERE stripe_payment_intent_id='pi_build_ok');
 IF n<>1 THEN RAISE EXCEPTION 'build revocation receipt missing'; END IF;
 PERFORM public.dock_fulfill_stripe_event('evt_build_refund_again','charge.refunded',true,null,null,'pi_build_ok',null,2900,'usd','hash',null);
 SELECT count(*) INTO n FROM public.dock_receipts WHERE receipt_type='revocation' AND entitlement_id IN (SELECT id FROM public.dock_entitlements WHERE stripe_payment_intent_id='pi_build_ok');
 IF n<>1 THEN RAISE EXCEPTION 'duplicate build refund emitted duplicate receipt'; END IF;
 RAISE NOTICE 'PASS: generic refund and custom-build fulfillment/revocation checks';
END
$tests$;
