-- Bingo Cloud Sharing & Class Review Analytics
-- Run this script once in the Supabase SQL Editor for project oaavmecavooowuayjxjn.

CREATE TABLE IF NOT EXISTS public.bingo_shared_sets (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z2-9]{6}$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 40000),
  question_count integer NOT NULL CHECK (question_count BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bingo_review_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_code text NOT NULL REFERENCES public.bingo_shared_sets(code) ON DELETE CASCADE,
  student_alias text NOT NULL DEFAULT '학생' CHECK (char_length(student_alias) BETWEEN 1 AND 24),
  play_mode text NOT NULL DEFAULT 'solo' CHECK (play_mode IN ('solo', 'team')),
  score integer NOT NULL DEFAULT 0 CHECK (score BETWEEN -10000 AND 100000),
  correct_count integer NOT NULL DEFAULT 0 CHECK (correct_count BETWEEN 0 AND 200),
  wrong_count integer NOT NULL DEFAULT 0 CHECK (wrong_count BETWEEN 0 AND 200),
  won boolean NOT NULL DEFAULT false,
  missed_questions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(missed_questions) = 'array' AND jsonb_array_length(missed_questions) <= 50),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bingo_review_results_code_created
  ON public.bingo_review_results (share_code, created_at DESC);

ALTER TABLE public.bingo_shared_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bingo_review_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bingo_shared_sets_select_public" ON public.bingo_shared_sets;
CREATE POLICY "bingo_shared_sets_select_public"
  ON public.bingo_shared_sets FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "bingo_shared_sets_insert_public" ON public.bingo_shared_sets;
CREATE POLICY "bingo_shared_sets_insert_public"
  ON public.bingo_shared_sets FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    code ~ '^[A-Z2-9]{6}$'
    AND char_length(title) BETWEEN 1 AND 60
    AND char_length(content) BETWEEN 1 AND 40000
    AND question_count BETWEEN 1 AND 200
  );

DROP POLICY IF EXISTS "bingo_review_results_select_public" ON public.bingo_review_results;
CREATE POLICY "bingo_review_results_select_public"
  ON public.bingo_review_results FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "bingo_review_results_insert_public" ON public.bingo_review_results;
CREATE POLICY "bingo_review_results_insert_public"
  ON public.bingo_review_results FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    share_code ~ '^[A-Z2-9]{6}$'
    AND char_length(student_alias) BETWEEN 1 AND 24
    AND play_mode IN ('solo', 'team')
    AND correct_count >= 0 AND wrong_count >= 0
    AND jsonb_typeof(missed_questions) = 'array'
    AND jsonb_array_length(missed_questions) <= 50
  );

-- Public Question Library
CREATE TABLE IF NOT EXISTS public.bingo_public_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
  subject text NOT NULL DEFAULT '기타' CHECK (char_length(subject) BETWEEN 1 AND 20),
  grade text NOT NULL DEFAULT '전학년' CHECK (char_length(grade) BETWEEN 1 AND 20),
  author_alias text NOT NULL DEFAULT '익명 선생님' CHECK (char_length(author_alias) BETWEEN 1 AND 24),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 40000),
  question_count integer NOT NULL CHECK (question_count BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bingo_public_library_subject_created
  ON public.bingo_public_library (subject, created_at DESC);

ALTER TABLE public.bingo_public_library ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bingo_public_library_select_public" ON public.bingo_public_library;
CREATE POLICY "bingo_public_library_select_public"
  ON public.bingo_public_library FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "bingo_public_library_insert_public" ON public.bingo_public_library;
CREATE POLICY "bingo_public_library_insert_public"
  ON public.bingo_public_library FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    char_length(title) BETWEEN 1 AND 60
    AND char_length(subject) BETWEEN 1 AND 20
    AND char_length(grade) BETWEEN 1 AND 20
    AND char_length(author_alias) BETWEEN 1 AND 24
    AND char_length(content) BETWEEN 1 AND 40000
    AND question_count BETWEEN 1 AND 200
  );

-- Public Library Extensions (likes, downloads, reports, optional edit PIN hash)
ALTER TABLE public.bingo_public_library
  ADD COLUMN IF NOT EXISTS likes_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS downloads_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS report_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS edit_pin_hash text;

CREATE OR REPLACE FUNCTION public.bingo_lib_interact(p_id uuid, p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_action = 'like' THEN
    UPDATE public.bingo_public_library SET likes_count = likes_count + 1 WHERE id = p_id;
  ELSIF p_action = 'download' THEN
    UPDATE public.bingo_public_library SET downloads_count = downloads_count + 1 WHERE id = p_id;
  ELSIF p_action = 'report' THEN
    UPDATE public.bingo_public_library SET report_count = report_count + 1 WHERE id = p_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.bingo_lib_delete(p_id uuid, p_pin_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF coalesce(p_pin_hash, '') = '' THEN
    RETURN false;
  END IF;
  DELETE FROM public.bingo_public_library
  WHERE id = p_id AND edit_pin_hash = p_pin_hash;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bingo_lib_interact(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bingo_lib_delete(uuid, text) TO anon, authenticated;
