// Stub for Flow 5 — "إنشاء من بيانات" (From Data).
// Will land after Phases 7 (Enhance) + 8 (Mimic) ship — see context.md §14.
//
// MVP shape (when un-stubbed, per 2026-05-15 product call):
//   - User uploads .xlsx / .xls / .csv (Supabase storage, same path as Flow 1)
//   - User picks brand (same wizard as Flow 1, OR pick a saved BrandKit)
//   - Generate fires deck.generate.requested with type: "data" + the file
//     attached for Claude to read directly. No server-side parsing, no
//     sheet editor — auto-pilot.
//   - Claude composes data slides with inline <svg> charts (round-trips to
//     OOXML vectors via svgAsVector: true).

export default function DatasheetComingSoon() {
  return (
    <section dir="rtl" className="page-container">
      <div className="glass-card mx-auto mt-12 max-w-2xl rounded-2xl p-12 text-center">
        <span className="material-symbols-outlined mb-6 block text-[64px] text-[#36B8E0]">
          dataset
        </span>
        <div className="badge-purple mx-auto mb-4 inline-block">قريباً</div>
        <h1 className="mb-3 text-[28px] font-bold text-white">إنشاء من بيانات</h1>
        <p className="text-muted mb-8 text-[15px] leading-relaxed">
          ارفع ملف Excel أو CSV، اختر هويتك البصرية، وتولّى Claude تحويل بياناتك
          إلى عرض احترافي يحتوي على رسومات ومخططات مصممة بدقة.
        </p>
        <p className="text-muted text-[13px]">
          سيتم إطلاق هذه الميزة بعد اكتمال تدفقات إنشاء وتحسين.
        </p>
      </div>
    </section>
  );
}
