CREATE TABLE public.growth_plans (
    id integer NOT NULL,
    student_id integer NOT NULL,
    college_id integer NOT NULL,
    class_id integer NOT NULL,
    academic_year character varying(20) NOT NULL,
    semester character varying(20) NOT NULL,
    source character varying(30) DEFAULT 'rules'::character varying NOT NULL,
    diagnosis json NOT NULL,
    goals json NOT NULL,
    tasks json NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

COMMENT ON TABLE public.growth_plans IS '学生成长行动计划与核验记录';

CREATE SEQUENCE public.growth_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.growth_plans_id_seq OWNED BY public.growth_plans.id;

ALTER TABLE ONLY public.growth_plans ALTER COLUMN id SET DEFAULT nextval('public.growth_plans_id_seq'::regclass);

ALTER TABLE ONLY public.growth_plans
    ADD CONSTRAINT growth_plans_pkey PRIMARY KEY (id);

CREATE INDEX growth_plans_class_id_academic_year_semester ON public.growth_plans USING btree (class_id, academic_year, semester);

CREATE UNIQUE INDEX growth_plans_student_id_academic_year_semester ON public.growth_plans USING btree (student_id, academic_year, semester);

ALTER TABLE ONLY public.growth_plans
    ADD CONSTRAINT growth_plans_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON UPDATE CASCADE;
