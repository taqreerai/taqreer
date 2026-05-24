import { redirect } from "next/navigation";

// Entry point for the Enhance flow. Sidebar's "تحسين" nav item
// links to /enhance; this redirect bounces to step 1.
export default function EnhancePage() {
  redirect("/enhance/content");
}
