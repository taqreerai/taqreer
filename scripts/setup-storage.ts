import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// `fileSizeLimit` (bytes) overrides the 50 MB default per bucket. source-files
// must match the app's 100 MB upload cap (app/api/extract MAX_FILE_SIZE_BYTES)
// or fresh setups reject valid uploads at the storage layer.
const DEFAULT_FILE_SIZE_LIMIT = 52428800; // 50 MB
const buckets: { name: string; public: boolean; fileSizeLimit?: number }[] = [
  { name: "source-files", public: false, fileSizeLimit: 104857600 }, // 100 MB
  { name: "brand-assets", public: false },
  { name: "generated-presentations", public: false },
  // public: dashboards/projects pages render <img> tiles for every
  // project on every page load; signed URLs would mean N round-trips
  // per page. Thumbnails are low-value visually and only ever come
  // from the saved version pointer, so public is the simpler tradeoff.
  { name: "slide-previews", public: true },
  { name: "template-assets", public: true },
  // gpt-image-2 generated deck images (context/images.md). Public so the
  // <img src> baked into saved slide HTML never expires (exports + decks
  // older than a year keep resolving).
  { name: "generated-images", public: true },
];

async function setupBuckets() {
  console.log("Setting up Supabase storage buckets...");

  for (const bucket of buckets) {
    try {
      // Try to get bucket to see if it exists
      const { data, error } = await supabase.storage.getBucket(bucket.name);

      if (error && error.statusCode === "404") {
        // Bucket doesn't exist, create it
        const { error: createError } =
          await supabase.storage.createBucket(bucket.name, {
            public: bucket.public,
            fileSizeLimit: bucket.fileSizeLimit ?? DEFAULT_FILE_SIZE_LIMIT,
          });

        if (createError) {
          console.error(`❌ Error creating bucket "${bucket.name}":`, createError);
        } else {
          console.log(`✅ Created bucket: ${bucket.name} (public: ${bucket.public})`);
        }
      } else if (data) {
        console.log(`✓ Bucket already exists: ${bucket.name}`);
      } else {
        console.error(`❌ Unexpected error checking bucket "${bucket.name}":`, error);
      }
    } catch (err) {
      console.error(`❌ Error setting up bucket "${bucket.name}":`, err);
    }
  }

  console.log("\n✅ Storage setup complete!");
}

setupBuckets().catch(console.error);
