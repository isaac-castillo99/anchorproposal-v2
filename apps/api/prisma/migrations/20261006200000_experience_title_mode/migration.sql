ALTER TABLE "resume_generations" ADD COLUMN "experienceTitleMode" TEXT NOT NULL DEFAULT 'saved';
ALTER TABLE "resume_generations" ADD CONSTRAINT "resume_generations_experienceTitleMode_check"
  CHECK ("experienceTitleMode" IN ('saved', 'tailored'));
