import type { Metadata } from "next";
import { ContactForm } from "@/components/contact/ContactForm";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { isLocale, defaultLocale } from "@/lib/i18n/config";
import { LEGAL_META } from "@/lib/legal/content";

function resolve(lang: string): "ar" | "en" {
  return isLocale(lang) ? (lang as "ar" | "en") : (defaultLocale as "ar" | "en");
}

export async function generateMetadata(props: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await props.params;
  const dict = await getDictionary(resolve(lang));
  return { title: `${dict.contact.title} · ${LEGAL_META.brand}` };
}

export default async function ContactPage(props: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await props.params;
  const dict = await getDictionary(resolve(lang));
  const t = dict.contact;

  return (
    <div className="mx-auto w-full max-w-3xl pb-16">
      <h1 className="text-3xl font-bold text-foreground">{t.title}</h1>
      <p className="mt-2 text-sm text-muted">{t.subtitle}</p>
      <div className="mt-10">
        <ContactForm />
      </div>
    </div>
  );
}
