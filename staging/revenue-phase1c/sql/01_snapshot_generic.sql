-- Disposable PostgreSQL fixture matching production column contracts and the
-- currently deployed generic-plan branch of dock_fulfill_stripe_event.
-- No production records or secrets are used.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS public;
CREATE TABLE public.dock_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL,
 stripe_payment_link_id text UNIQUE, active boolean NOT NULL DEFAULT true,
 currency text NOT NULL DEFAULT 'usd', amount_cents integer NOT NULL,
 capability_limits jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE public.dock_payment_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_event_id text NOT NULL UNIQUE,
 event_type text NOT NULL, livemode boolean NOT NULL DEFAULT false,
 payment_link_id text, checkout_session_id text,
 payment_intent_id text, customer_email text,
 amount_cents integer, currency text,
 payload_hash text NOT NULL, processed boolean NOT NULL DEFAULT false,
 processed_at timestamptz, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.dock_entitlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 plan_id uuid, owner_id uuid, customer_email text,
 stripe_event_id text NOT NULL UNIQUE,
 stripe_checkout_session_id text UNIQUE,
 stripe_payment_intent_id text,
 status text NOT NULL DEFAULT 'active',
 capability_limits jsonb NOT NULL DEFAULT '{}'::jsonb,
 usage jsonb NOT NULL DEFAULT '{}'::jsonb,
 granted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE TABLE public.dock_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 entitlement_id uuid, payment_event_id uuid, receipt_type text NOT NULL,
 receipt_hash text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz DEFAULT now()
);
-- This explicitly reproduces the production function's generic-plan fulfillment
-- behavior observed through pg_get_functiondef, with its surrounding build branch
-- excluded; see README for that coverage limitation.
CREATE FUNCTION public.dock_fulfill_generic_unchecked(
 p_event_id text,p_event_type text,p_livemode boolean,p_payment_link_id text,
 p_checkout_session_id text,p_payment_intent_id text,p_customer_email text,
 p_amount_cents integer,p_currency text,p_payload_hash text
) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE ev public.dock_payment_events%rowtype;
 pl public.dock_plans%rowtype;
 ent public.dock_entitlements%rowtype;
BEGIN
 INSERT INTO public.dock_payment_events
 (stripe_event_id,event_type,livemode,payment_link_id,checkout_session_id,payment_intent_id,customer_email,amount_cents,currency,payload_hash,processed)
 VALUES (p_event_id,p_event_type,p_livemode,p_payment_link_id,p_checkout_session_id,p_payment_intent_id,p_customer_email,p_amount_cents,lower(coalesce(p_currency,'usd')),p_payload_hash,false)
 ON CONFLICT(stripe_event_id) DO NOTHING RETURNING * INTO ev;
 IF ev.id IS NULL THEN
   SELECT * INTO ev FROM public.dock_payment_events WHERE stripe_event_id=p_event_id;
   RETURN jsonb_build_object('duplicate',true,'event_id',ev.id,'processed',ev.processed);
 END IF;
 SELECT * INTO pl FROM public.dock_plans WHERE stripe_payment_link_id=p_payment_link_id AND active=true;
 IF pl.id IS NULL THEN
   UPDATE public.dock_payment_events SET processed=true,processed_at=now() WHERE id=ev.id;
   RETURN jsonb_build_object('recorded',true,'entitlement_created',false,'reason','no_active_plan_mapping');
 END IF;
 SELECT * INTO ent FROM public.dock_entitlements WHERE stripe_checkout_session_id=p_checkout_session_id;
 IF ent.id IS NOT NULL THEN
   UPDATE public.dock_payment_events SET processed=true,processed_at=now() WHERE id=ev.id;
   RETURN jsonb_build_object('duplicate',true,'entitlement_id',ent.id);
 END IF;
 INSERT INTO public.dock_entitlements(plan_id,customer_email,stripe_event_id,stripe_checkout_session_id,stripe_payment_intent_id,capability_limits)
 VALUES(pl.id,p_customer_email,p_event_id,p_checkout_session_id,p_payment_intent_id,pl.capability_limits) RETURNING * INTO ent;
 INSERT INTO public.dock_receipts(entitlement_id,payment_event_id,receipt_type,receipt_hash,details)
 VALUES(ent.id,ev.id,'payment',encode(digest(p_event_id||':'||coalesce(p_checkout_session_id,''),'sha256'),'hex'),
 jsonb_build_object('event_type',p_event_type,'amount_cents',p_amount_cents,'currency',p_currency));
 UPDATE public.dock_payment_events SET processed=true,processed_at=now() WHERE id=ev.id;
 RETURN jsonb_build_object('duplicate',false,'recorded',true,'entitlement_created',true,'entitlement_id',ent.id);
END;
$f$;
INSERT INTO public.dock_plans(slug,stripe_payment_link_id,amount_cents,currency,capability_limits)
VALUES ('credits_100','plink_fixture',500,'usd','{"credits":100}'::jsonb),
('support','plink_support',500,'usd','{}'::jsonb);
-- Full production function additionally references the builds table.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE TABLE public.dock_builds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'awaiting_payment',
 stripe_payment_link_id text, stripe_checkout_session_id text UNIQUE,
 stripe_payment_intent_id text, customer_email text, paid_at timestamptz,
 updated_at timestamptz DEFAULT now()
);
