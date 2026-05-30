import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const buckets = [
  { name: "source-files", public: false },
  { name: "brand-assets", public: false },
  { name: "generated-presentations", public: false },
  // public: dashboards/projects pages render <img> tiles for every
  // project on every page load; signed URLs would mean N round-trips
  // per page. Thumbnails are low-value visually and only ever come
  // from the saved version pointer, so public is the simpler tradeoff.
  { name: "slide-previews", public: true },
  { name: "template-assets", public: true },
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
            fileSizeLimit: 52428800, // 50 MB
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
