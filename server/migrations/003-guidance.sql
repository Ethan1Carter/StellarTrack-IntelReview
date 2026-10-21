CREATE TABLE public.guidance_resources (
    id integer NOT NULL,
    series_id character varying(36) NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    edit_version integer DEFAULT 1 NOT NULL,
    kind character varying(20) NOT NULL,
    college_id integer NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    data json NOT NULL,
    created_by integer NOT NULL,
    published_by integer,
    published_at timestamp with time zone,
    withdrawal_reason character varying(500),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE SEQUENCE public.guidance_resources_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.guidance_resources_id_seq OWNED BY public.guidance_resources.id;

ALTER TABLE ONLY public.guidance_resources ALTER COLUMN id SET DEFAULT nextval('public.guidance_resources_id_seq'::regclass);

ALTER TABLE ONLY public.guidance_resources
    ADD CONSTRAINT guidance_resources_pkey PRIMARY KEY (id);

CREATE INDEX guidance_resources_college_id_kind_status ON public.guidance_resources USING btree (college_id, kind, status);

CREATE UNIQUE INDEX guidance_resources_series_id_revision ON public.guidance_resources USING btree (series_id, revision);
