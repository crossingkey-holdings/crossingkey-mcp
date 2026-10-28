-- STAGING ONLY. Reconstructed from live pg_get_functiondef, then patched.
-- Requires separate review before any production application.
CREATE OR REPLACE FUNCTION public.dock_fulfill_stripe_event(p_event_id text, p_event_type text, p_livemode boolean, p_payment_link_id text, p_checkout_session_id text, p_payment_intent_id text, p_customer_email text, p_amount_cents integer, p_currency text, p_payload_hash text, p_client_reference_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  ev public.dock_payment_events%rowtype;
  b public.dock_builds%rowtype;
  pl public.dock_plans%rowtype;
  ent public.dock_entitlements%rowtype;
begin
  /*
    Sandbox events are valid webhook/checkout evidence but must never grant
    production access. Record the event and a receipt without an entitlement.
  */
  if p_livemode is distinct from true then
    insert into public.dock_payment_events(
      stripe_event_id,event_type,livemode,payment_link_id,checkout_session_id,
      payment_intent_id,customer_email,amount_cents,currency,payload_hash,processed
    ) values (
      p_event_id,p_event_type,false,p_payment_link_id,p_checkout_session_id,
      p_payment_intent_id,p_customer_email,p_amount_cents,
      lower(coalesce(p_currency,'usd')),p_payload_hash,false
    ) on conflict(stripe_event_id) do nothing returning * into ev;

    if ev.id is null then
      select * into ev
      from public.dock_payment_events
      where stripe_event_id = p_event_id;

      return jsonb_build_object(
        'duplicate',true,
        'event_id',ev.id,
        'processed',ev.processed,
        'test',true
      );
    end if;

    insert into public.dock_receipts(
      entitlement_id,payment_event_id,receipt_type,receipt_hash,details
    ) values (
      null,
      ev.id,
      'test_payment',
      encode(
        digest(
          coalesce(p_event_id,'') || ':' || coalesce(p_checkout_session_id,''),
          'sha256'
        ),
        'hex'
      ),
      jsonb_build_object(
        'test',true,
        'event_type',p_event_type,
        'checkout_session_id',p_checkout_session_id,
        'payment_intent_id',p_payment_intent_id,
        'payment_link_id',p_payment_link_id,
        'amount_cents',p_amount_cents,
        'currency',lower(coalesce(p_currency,'usd')),
        'client_reference_id',p_client_reference_id,
        'note','Sandbox evidence only; no production entitlement granted.'
      )
    );

    update public.dock_payment_events
    set processed=true, processed_at=now()
    where id=ev.id;

    return jsonb_build_object(
      'duplicate',false,
      'recorded',true,
      'test',true,
      'entitlement_created',false,
      'receipt_created',true,
      'reason','test_event_recorded_without_live_access'
    );
  end if;

  if p_client_reference_id is not null then
    if p_event_type not in (
         'checkout.session.completed',
         'checkout.session.async_payment_succeeded'
       )
       or p_payment_link_id is distinct from 'plink_1UUZPsHL8NkFtBuMfWxSJvxO'
       or p_amount_cents is distinct from 2900
       or lower(p_currency) is distinct from 'usd'
       or p_checkout_session_id is null then
      raise exception 'build_payment_mismatch';
    end if;
  end if;

  insert into public.dock_payment_events(
    stripe_event_id,event_type,livemode,payment_link_id,checkout_session_id,
    payment_intent_id,customer_email,amount_cents,currency,payload_hash,processed
  ) values (
    p_event_id,p_event_type,p_livemode,p_payment_link_id,p_checkout_session_id,
    p_payment_intent_id,p_customer_email,p_amount_cents,
    lower(coalesce(p_currency,'usd')),p_payload_hash,false
  ) on conflict(stripe_event_id) do nothing returning * into ev;

  if ev.id is null then
    select * into ev
    from public.dock_payment_events
    where stripe_event_id = p_event_id;

    return jsonb_build_object(
      'duplicate',true,
      'event_id',ev.id,
      'processed',ev.processed
    );
  end if;

  if p_client_reference_id is not null
     and p_event_type in (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded'
     ) then
    begin
      select * into b
      from public.dock_builds
      where id = p_client_reference_id::uuid
      for update;
    exception when invalid_text_representation then
      b.id := null;
    end;

    if b.id is null then
      raise exception 'unknown_custom_build_reference';
    end if;
    if b.status is distinct from 'awaiting_payment' and b.status not in ('paid','delivered','revoked') then
      raise exception 'invalid_custom_build_state';
    end if;
    if b.id is not null then
      if b.status = 'revoked' then
        raise exception 'build_revoked';
      end if;

      if b.status in ('paid','delivered') then
        update public.dock_payment_events
        set processed=true, processed_at=now()
        where id=ev.id;

        return jsonb_build_object(
          'duplicate',true,
          'build_id',b.id,
          'status',b.status
        );
      end if;

      if p_amount_cents is distinct from b.price_cents
         or lower(coalesce(p_currency,'')) is distinct from lower(b.currency) then
        raise exception 'custom_build_payment_mismatch';
      end if;

      select * into ent
      from public.dock_entitlements
      where stripe_checkout_session_id = p_checkout_session_id;

      if ent.id is not null then
        raise exception 'checkout_already_bound';
      end if;

      update public.dock_builds set
        status='paid',
        stripe_payment_link_id=p_payment_link_id,
        stripe_checkout_session_id=p_checkout_session_id,
        stripe_payment_intent_id=p_payment_intent_id,
        customer_email=p_customer_email,
        paid_at=now(),
        updated_at=now()
      where id=b.id;

      insert into public.dock_entitlements(
        plan_id,owner_id,customer_email,stripe_event_id,
        stripe_checkout_session_id,stripe_payment_intent_id,
        capability_limits,usage
      ) values (
        null,b.owner_id,p_customer_email,p_event_id,
        p_checkout_session_id,p_payment_intent_id,
        jsonb_build_object(
          'custom_skill_export',
          jsonb_build_object('units',1)
        ),
        '{}'::jsonb
      ) returning * into ent;

      insert into public.dock_receipts(
        entitlement_id,payment_event_id,receipt_type,receipt_hash,details
      ) values (
        ent.id,
        ev.id,
        'payment',
        encode(
          digest(
            p_event_id || ':' || coalesce(p_checkout_session_id,''),
            'sha256'
          ),
          'hex'
        ),
        jsonb_build_object(
          'offer','custom_skill_export',
          'build_id',b.id,
          'event_type',p_event_type,
          'amount_cents',p_amount_cents,
          'currency',p_currency
        )
      );

      update public.dock_payment_events
      set processed=true, processed_at=now()
      where id=ev.id;

      return jsonb_build_object(
        'duplicate',false,
        'recorded',true,
        'build_id',b.id,
        'entitlement_id',ent.id,
        'entitlement_created',true
      );
    end if;
  end if;

  if p_event_type = 'charge.refunded'
     and p_payment_intent_id is not null then
    select * into b
    from public.dock_builds
    where stripe_payment_intent_id = p_payment_intent_id
    for update;

    if b.id is not null then
      update public.dock_builds
      set status='revoked', updated_at=now()
      where id=b.id;

      select * into ent
      from public.dock_entitlements
      where stripe_payment_intent_id=p_payment_intent_id
      order by granted_at desc
      limit 1
      for update;

      if ent.id is not null then
        update public.dock_entitlements
        set status='revoked', revoked_at=now()
        where id=ent.id;

        insert into public.dock_receipts(
          entitlement_id,payment_event_id,receipt_type,receipt_hash,details
        ) values (
          ent.id,
          ev.id,
          'revocation',
          encode(
            digest(p_event_id || ':' || p_payment_intent_id,'sha256'),
            'hex'
          ),
          jsonb_build_object(
            'build_id',b.id,
            'event_type',p_event_type
          )
        );
      end if;

      update public.dock_payment_events
      set processed=true, processed_at=now()
      where id=ev.id;

      return jsonb_build_object(
        'recorded',true,
        'build_id',b.id,
        'revoked',true
      );
    end if;
  end if;

  -- Phase 1D staging guard: revoke matching generic-plan entitlements on refunds.
  -- The existing custom-build refund branch above retains precedence.
  if p_event_type = 'charge.refunded' then
    if p_payment_intent_id is null then
      update public.dock_payment_events set processed=true,processed_at=now() where id=ev.id;
      return jsonb_build_object('recorded',true,'entitlement_created',false,'revoked',false,'reason','refund_without_payment_intent');
    end if;
    -- Prevent overlapping refund processing from racing the same payment intent.
    perform pg_advisory_xact_lock(hashtextextended(p_payment_intent_id, 1));
    select * into ent from public.dock_entitlements
      where stripe_payment_intent_id=p_payment_intent_id and plan_id is not null
      order by granted_at desc limit 1 for update;
    if ent.id is not null and ent.status <> 'revoked' then
      update public.dock_entitlements set status='revoked',revoked_at=now() where id=ent.id;
      insert into public.dock_receipts(entitlement_id,payment_event_id,receipt_type,receipt_hash,details)
      values(ent.id,ev.id,'revocation',
             encode(digest(p_event_id || ':' || p_payment_intent_id,'sha256'),'hex'),
             jsonb_build_object('event_type',p_event_type,'payment_intent_id',p_payment_intent_id));
    end if;
    update public.dock_payment_events set processed=true,processed_at=now() where id=ev.id;
    return jsonb_build_object('recorded',true,'revoked',ent.id is not null,
      'entitlement_created',false,'already_revoked',ent.id is not null and ent.status='revoked');
  end if;

  -- Staging-only Phase 1C correction for the generic plan path.
  -- Checkout events must be paid before the webhook calls this service-role RPC.
  -- Database validation rejects any other event class or missing checkout.
  if p_event_type not in (
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded'
  ) or p_checkout_session_id is null or p_client_reference_id is not null then
    update public.dock_payment_events
      set processed=true, processed_at=now()
    where id=ev.id;
    return jsonb_build_object(
      'recorded',true,'entitlement_created',false,
      'reason','not_eligible_generic_checkout'
    );
  end if;

  -- Serializes different event IDs attempting the same checkout session.
  perform pg_advisory_xact_lock(hashtextextended(p_checkout_session_id, 0));

  select * into pl
  from public.dock_plans
  where stripe_payment_link_id=p_payment_link_id
    and active=true;

  if pl.id is null then
    update public.dock_payment_events
    set processed=true, processed_at=now()
    where id=ev.id;

    return jsonb_build_object(
      'recorded',true,
      'entitlement_created',false,
      'reason','no_active_plan_or_build_mapping'
    );
  end if;

  -- Never grant a mapped entitlement for an incorrect price or currency.
  if p_amount_cents is distinct from pl.amount_cents
     or lower(coalesce(p_currency,'')) is distinct from lower(pl.currency) then
    raise exception 'generic_plan_payment_mismatch';
  end if;

  select * into ent
  from public.dock_entitlements
  where stripe_checkout_session_id=p_checkout_session_id;

  if ent.id is not null then
    update public.dock_payment_events
    set processed=true, processed_at=now()
    where id=ev.id;

    return jsonb_build_object(
      'duplicate',true,
      'entitlement_id',ent.id
    );
  end if;

  insert into public.dock_entitlements(
    plan_id,customer_email,stripe_event_id,
    stripe_checkout_session_id,stripe_payment_intent_id,
    capability_limits
  ) values (
    pl.id,p_customer_email,p_event_id,
    p_checkout_session_id,p_payment_intent_id,
    pl.capability_limits
  ) returning * into ent;

  insert into public.dock_receipts(
    entitlement_id,payment_event_id,receipt_type,receipt_hash,details
  ) values (
    ent.id,
    ev.id,
    'payment',
    encode(
      digest(
        p_event_id || ':' || coalesce(p_checkout_session_id,''),
        'sha256'
      ),
      'hex'
    ),
    jsonb_build_object(
      'event_type',p_event_type,
      'amount_cents',p_amount_cents,
      'currency',p_currency
    )
  );

  update public.dock_payment_events
  set processed=true, processed_at=now()
  where id=ev.id;

  return jsonb_build_object(
    'duplicate',false,
    'recorded',true,
    'entitlement_created',true,
    'entitlement_id',ent.id
  );
end;
$function$;
