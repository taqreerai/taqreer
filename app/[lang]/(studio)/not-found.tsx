// 404 for the deck studio/viewer route. Reached when the page calls notFound()
// for a missing OR access-denied deck (resolveProjectAccess hides the existence
// of private/unauthorized decks behind the same 404). This route serves BOTH the
// signed-in owner (e.g. a deleted deck) AND anonymous public-link visitors, so
// recovery points HOME (the landing) rather than a login-implying "dashboard".
import { NotFoundContent } from "@/components/i18n/NotFoundContent";

export default function StudioNotFound() {
  return (
    <div className="page-container flex flex-col items-center gap-8 px-6 pt-[12vh] text-center">
      <NotFoundContent recovery="home" />
    </div>
  );
}
