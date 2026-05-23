-- Aligns Template.slideCount default with the actual showcase render
-- output. The brand showcase used to be 4 slides (cover / typography /
-- palette / layout); the layout slide was retired 2026-05-22 leaving
-- 3 (see lib/template/build-showcase-html.ts:SHOWCASE_SLIDE_IDS).
-- Without this change, rows inserted without an explicit slideCount
-- (none in production today — save-as-template explicitly sets 3)
-- would persist incorrect metadata.
ALTER TABLE "Template" ALTER COLUMN "slideCount" SET DEFAULT 3;
