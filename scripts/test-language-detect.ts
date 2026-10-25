// One-off check of lib/language/detect.ts. Run: npx tsx scripts/test-language-detect.ts
import { detectLanguage } from "../lib/language/detect";

type Case = { name: string; text: string; lang: string | null; secondary?: string | null };

const cases: Case[] = [
  { name: "arabic", text: "نقدم في هذا العرض خطة شاملة لتطوير الهوية المؤسسية وبناء الهيكل التنظيمي للشركة", lang: "ar" },
  { name: "english", text: "This presentation covers our plan for the next quarter and the results that we expect from the team", lang: "en" },
  { name: "french", text: "Cette présentation décrit les fonctions de la direction générale et les projets de l'entreprise pour les clients", lang: "fr" },
  { name: "french short", text: "Direction Générale et Direction Administrative et Financière", lang: "fr" },
  { name: "spanish", text: "Esta presentación describe los servicios de la empresa y los resultados que hemos logrado con nuestros clientes", lang: "es" },
  { name: "portuguese", text: "Esta apresentação descreve os serviços da empresa e os resultados que não conseguimos antes para os nossos clientes", lang: "pt" },
  { name: "italian", text: "Questa presentazione descrive i servizi della nostra azienda e i risultati che abbiamo ottenuto per i clienti", lang: "it" },
  { name: "german", text: "Diese Präsentation beschreibt die Leistungen unseres Unternehmens und die Ergebnisse, die wir für unsere Kunden erzielt haben", lang: "de" },
  { name: "turkish", text: "Bu sunum şirketimizin hizmetlerini ve müşterilerimiz için elde ettiğimiz sonuçları gösterir ve daha fazlasını anlatır", lang: "tr" },
  { name: "indonesian", text: "Presentasi ini menjelaskan layanan perusahaan kami dan hasil yang telah dicapai untuk para pelanggan", lang: "id" },
  { name: "russian", text: "Эта презентация описывает услуги нашей компании и результаты, которые мы достигли для клиентов", lang: "ru" },
  { name: "ukrainian", text: "Ця презентація описує послуги нашої компанії та результати, яких ми досягли для клієнтів", lang: "uk" },
  { name: "chinese", text: "本演示文稿介绍了我们公司的服务以及我们为客户取得的成果", lang: "zh" },
  { name: "japanese", text: "このプレゼンテーションでは、当社のサービスとお客様のために達成した成果について説明します", lang: "ja" },
  { name: "persian", text: "این ارائه خدمات شرکت ما و نتایجی که برای مشتریان به دست آورده ایم را شرح می دهد و گزارش می کند", lang: "fa" },
  { name: "hebrew", text: "מצגת זו מתארת את השירותים של החברה שלנו ואת התוצאות שהשגנו עבור הלקוחות", lang: "he" },
  { name: "arabic with english terms", text: "نقدم خطة KPI جديدة لقياس أداء الفريق مع تقارير شهرية وعرض Dashboard لمتابعة النتائج وتحسين العمل داخل الشركة", lang: "ar" },
  { name: "arabic + english deck", text: "نقدم في هذا العرض خطة شاملة لتطوير الهوية المؤسسية وبناء الهيكل التنظيمي للشركة مع تقارير شهرية ومتابعة النتائج. This plan covers the next quarter and the results that we expect from the team", lang: "ar", secondary: "en" },
  { name: "amharic with 2 latin words", text: "እንኳን ደህና መጡ በአዲስ አበባ ከተማ አስተዳደር ፐብሊክ ሰርቪስና የሰው ኃብት ልማት ቢሮ ከማዕከል እስከ ወረዳ Climate Setting ከስልጠናው ምን ትጠብቃላችሁ", lang: "am" },
  { name: "unknown script (armenian)", text: "Այս ներկայացումը նկարագրում է մեր ընկերության ծառայությունները և արդյունքները", lang: null },
  { name: "numbers only", text: "2024 2025 12% 34.5 1,200 5000", lang: null },
  { name: "empty", text: "", lang: null },
  { name: "too short", text: "OK", lang: null },
];

let failed = 0;
for (const c of cases) {
  const r = detectLanguage(c.text);
  const okLang = r.lang === c.lang;
  const okSecond = c.secondary === undefined || r.secondary === c.secondary;
  if (!okLang || !okSecond) failed++;
  console.log(
    `${okLang && okSecond ? "ok  " : "FAIL"} ${c.name.padEnd(28)} -> ${String(r.lang).padEnd(5)} ${r.direction} conf=${r.confidence.toFixed(2)} second=${r.secondary}`,
  );
}
console.log(failed === 0 ? "\nall passed" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
