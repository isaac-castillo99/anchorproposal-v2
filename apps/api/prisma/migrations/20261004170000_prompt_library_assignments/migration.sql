-- Named prompt library and bidder/profile assignments
ALTER TABLE "prompt_versions" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT 'Prompt';
ALTER TABLE "prompt_versions" ADD COLUMN IF NOT EXISTS "isInitial" BOOLEAN NOT NULL DEFAULT false;

UPDATE "prompt_versions"
SET "name" = CASE
  WHEN "ownerId" IS NULL AND "isPublished" = true THEN 'Initial prompt'
  WHEN "ownerId" IS NULL THEN 'Version ' || "version"::text
  ELSE 'Custom prompt'
END
WHERE "name" = 'Prompt';

UPDATE "prompt_versions" AS p
SET "isInitial" = true
WHERE p."ownerId" IS NULL
  AND p."isPublished" = true
  AND p."id" = (
    SELECT p2."id"
    FROM "prompt_versions" AS p2
    WHERE p2."ownerId" IS NULL AND p2."isPublished" = true
    ORDER BY p2."publishedAt" DESC NULLS LAST, p2."version" DESC
    LIMIT 1
  );

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "selectedPromptId" TEXT;

CREATE TABLE IF NOT EXISTS "prompt_assignments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "promptVersionId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "prompt_assignments_userId_promptVersionId_key"
  ON "prompt_assignments"("userId", "promptVersionId");
CREATE INDEX IF NOT EXISTS "prompt_assignments_userId_idx" ON "prompt_assignments"("userId");

CREATE TABLE IF NOT EXISTS "profile_prompt_assignments" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "promptVersionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profile_prompt_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "profile_prompt_assignments_profileId_userId_key"
  ON "profile_prompt_assignments"("profileId", "userId");
CREATE INDEX IF NOT EXISTS "profile_prompt_assignments_profileId_idx"
  ON "profile_prompt_assignments"("profileId");
CREATE INDEX IF NOT EXISTS "profile_prompt_assignments_userId_idx"
  ON "profile_prompt_assignments"("userId");

DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_selectedPromptId_fkey"
    FOREIGN KEY ("selectedPromptId") REFERENCES "prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "prompt_assignments" ADD CONSTRAINT "prompt_assignments_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "prompt_assignments" ADD CONSTRAINT "prompt_assignments_promptVersionId_fkey"
    FOREIGN KEY ("promptVersionId") REFERENCES "prompt_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "profile_prompt_assignments" ADD CONSTRAINT "profile_prompt_assignments_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "profile_prompt_assignments" ADD CONSTRAINT "profile_prompt_assignments_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "profile_prompt_assignments" ADD CONSTRAINT "profile_prompt_assignments_promptVersionId_fkey"
    FOREIGN KEY ("promptVersionId") REFERENCES "prompt_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
