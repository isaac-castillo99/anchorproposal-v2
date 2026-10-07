ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "promptVersionId" TEXT;

DO $$ BEGIN
  ALTER TABLE "profiles" ADD CONSTRAINT "profiles_promptVersionId_fkey"
    FOREIGN KEY ("promptVersionId") REFERENCES "prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
