-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.auto_events_pending (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  start_at timestamp with time zone NOT NULL,
  end_at timestamp with time zone,
  timezone text NOT NULL DEFAULT 'UTC'::text CHECK (timezone = ANY (ARRAY['UTC'::text, 'Kyiv'::text])),
  type text NOT NULL DEFAULT 'Listing (TGE)'::text,
  tge_exchanges jsonb NOT NULL DEFAULT '[]'::jsonb,
  link text,
  status USER-DEFINED NOT NULL DEFAULT 'pending'::pending_status,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  event_type_slug text,
  coin_name text,
  coin_quantity numeric,
  coin_price_link text,
  nickname text,
  coins text,
  CONSTRAINT auto_events_pending_pkey PRIMARY KEY (id)
);
CREATE TABLE public.event_edits_pending (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  payload jsonb NOT NULL,
  submitter_email text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  coins text,
  CONSTRAINT event_edits_pending_pkey PRIMARY KEY (id),
  CONSTRAINT event_edits_pending_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events_approved(id)
);
CREATE TABLE public.event_types (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  order_index integer NOT NULL DEFAULT 0,
  is_tge boolean NOT NULL DEFAULT false,
  time_optional boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  label text NOT NULL,
  form_mode text NOT NULL DEFAULT 'datetime'::text,
  sort_order integer NOT NULL DEFAULT 100,
  CONSTRAINT event_types_pkey PRIMARY KEY (id)
);
CREATE TABLE public.events_approved (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  start_at timestamp with time zone NOT NULL,
  end_at timestamp with time zone,
  timezone text NOT NULL DEFAULT 'UTC'::text CHECK (timezone = ANY (ARRAY['UTC'::text, 'Kyiv'::text])),
  type text NOT NULL DEFAULT 'Listing (TGE)'::text,
  tge_exchanges jsonb NOT NULL DEFAULT '[]'::jsonb,
  link text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  event_type_slug text,
  coin_name text,
  coin_quantity numeric,
  coin_price_link text,
  nickname text,
  coins text,
  CONSTRAINT events_approved_pkey PRIMARY KEY (id),
  CONSTRAINT events_approved_event_type_slug_fkey FOREIGN KEY (event_type_slug) REFERENCES public.event_types(slug)
);
CREATE TABLE public.events_pending (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  start_at timestamp with time zone NOT NULL,
  end_at timestamp with time zone,
  timezone text NOT NULL DEFAULT 'UTC'::text CHECK (timezone = ANY (ARRAY['UTC'::text, 'Kyiv'::text])),
  type text NOT NULL DEFAULT 'Listing (TGE)'::text,
  tge_exchanges jsonb NOT NULL DEFAULT '[]'::jsonb,
  link text,
  status USER-DEFINED NOT NULL DEFAULT 'pending'::pending_status,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  event_type_slug text,
  coin_name text,
  coin_quantity numeric,
  coin_price_link text,
  nickname text,
  coins text,
  CONSTRAINT events_pending_pkey PRIMARY KEY (id),
  CONSTRAINT events_pending_event_type_slug_fkey FOREIGN KEY (event_type_slug) REFERENCES public.event_types(slug)
);
CREATE TABLE public.exchanges (
  id bigint NOT NULL DEFAULT nextval('exchanges_id_seq'::regclass),
  name text NOT NULL UNIQUE,
  segment text NOT NULL CHECK (segment = ANY (ARRAY['Spot'::text, 'Futures'::text])),
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT exchanges_pkey PRIMARY KEY (id)
);