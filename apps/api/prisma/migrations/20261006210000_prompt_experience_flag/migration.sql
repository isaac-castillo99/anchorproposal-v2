ALTER TABLE "prompt_versions" ADD COLUMN "experienceTitleMode" TEXT NOT NULL DEFAULT 'saved';
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_experienceTitleMode_check"
  CHECK ("experienceTitleMode" IN ('saved', 'tailored'));
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_default_fixed_positions_check"
  CHECK (NOT ("isInitial" OR "isPersonalDefault") OR "experienceTitleMode" = 'saved');
