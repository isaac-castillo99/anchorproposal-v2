-- Preserve existing profile-first generation until an admin chooses a single prompt.
ALTER TABLE "users" ADD COLUMN "generationPromptMode" TEXT NOT NULL DEFAULT 'profile';
ALTER TABLE "users" ADD CONSTRAINT "users_generationPromptMode_check" CHECK ("generationPromptMode" IN ('user', 'profile'));
ALTER TABLE "prompt_versions" ADD COLUMN "isPersonalDefault" BOOLEAN NOT NULL DEFAULT false;
