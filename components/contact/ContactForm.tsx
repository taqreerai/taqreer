"use client";

// Public contact form. Posts to /api/contact, which routes to the chosen
// department inbox via Resend. The department <select> is a small custom
// dropdown (surface-menu + dropdown-item recipe, like LanguageMenu). A hidden
// honeypot (`company`) catches bots; the server also rate-limits + validates.

import { useEffect, useRef, useState } from "react";
import { useDict, useLocale } from "@/components/i18n/LocaleProvider";

type DeptKey = "general" | "sales" | "billing" | "support";
const DEPT_KEYS: DeptKey[] = ["general", "sales", "billing", "support"];

function DepartmentSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: DeptKey | "";
  onChange: (k: DeptKey) => void;
  options: { key: DeptKey; label: string }[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.key === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="input-dark flex w-full items-center justify-between text-start"
      >
        <span className={selected ? "text-foreground" : "text-muted"}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="material-symbols-outlined text-[20px] text-muted">
          expand_more
        </span>
      </button>
      {open ? (
        <div
          role="listbox"
          className="surface-menu absolute z-20 mt-1 w-full overflow-hidden rounded-xl"
        >
          <ul className="flex flex-col p-1.5">
            {options.map((o) => (
              <li key={o.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.key === value}
                  onClick={() => {
                    onChange(o.key);
                    setOpen(false);
                  }}
                  className="dropdown-item w-full text-start"
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ContactForm() {
  const dict = useDict();
  const { dir } = useLocale();
  const t = dict.contact;

  const options = DEPT_KEYS.map((key) => ({
    key,
    label: t.departments[key],
  }));

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState<DeptKey | "">("");
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const valid =
    name.trim().length >= 1 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    department !== "" &&
    message.trim().length >= 10;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || status === "sending") return;
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, department, message, company }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("sent");
    } catch {
      setStatus("idle");
      setError(t.error);
    }
  }

  if (status === "sent") {
    return (
      <div className="surface-card flex flex-col items-center gap-3 rounded-2xl p-10 text-center">
        <span
          className="material-symbols-outlined text-[var(--tq-status-ok-dot)]"
          style={{ fontSize: 48 }}
          aria-hidden
        >
          check_circle
        </span>
        <h2 className="text-lg font-semibold text-foreground">{t.successTitle}</h2>
        <p className="text-sm text-muted">{t.successBody}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" dir={dir}>
      {/* Honeypot: hidden from users, tempting to bots. */}
      <input
        type="text"
        name="company"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">{t.nameLabel}</span>
          <input
            type="text"
            className="input-dark"
            placeholder={t.namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            required
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">{t.emailLabel}</span>
          <input
            type="email"
            className="input-dark"
            placeholder={t.emailPlaceholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            dir="ltr"
            maxLength={200}
            required
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">{t.departmentLabel}</span>
        <DepartmentSelect
          value={department}
          onChange={setDepartment}
          options={options}
          placeholder={t.departmentPlaceholder}
        />
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">{t.messageLabel}</span>
        <textarea
          className="input-dark min-h-[140px] resize-y"
          placeholder={t.messagePlaceholder}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={4000}
          required
        />
      </label>

      {error ? (
        <p className="text-sm text-[rgb(220,38,38)]" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!valid || status === "sending"}
        className="btn-gradient w-fit px-8 py-3 text-sm disabled:opacity-50"
      >
        {status === "sending" ? t.submitting : t.submit}
      </button>
    </form>
  );
}
