-- Template SEO detail pages: admin-assigned slug + per-locale name/description.
-- All nullable, additive; no backfill. Slug uniqueness enforced by the index.
ALTER TABLE "Template" ADD COLUMN "slug" TEXT;
ALTER TABLE "Template" ADD COLUMN "nameAr" TEXT;
ALTER TABLE "Template" ADD COLUMN "nameEn" TEXT;
ALTER TABLE "Template" ADD COLUMN "descriptionAr" TEXT;
ALTER TABLE "Template" ADD COLUMN "descriptionEn" TEXT;

CREATE UNIQUE INDEX "Template_slug_key" ON "Template"("slug");
