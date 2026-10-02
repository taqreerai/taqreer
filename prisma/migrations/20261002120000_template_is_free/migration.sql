-- Free-plan templates: the few templates a free user may generate with.
ALTER TABLE "Template" ADD COLUMN "isFree" BOOLEAN NOT NULL DEFAULT false;
