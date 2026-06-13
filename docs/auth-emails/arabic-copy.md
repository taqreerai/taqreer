# Arabic email copy — review for grammar + tone

Every Arabic string across all the transactional emails, grouped by email. Edit
the text freely (keep Latin numerals 0-9, and `taqreer.ai` / `support@taqreer.ai`
as-is). When you're done, hand this back and I'll apply your edits to the source
files. `{name}`, `{deck}`, `{role}`, `{plan}` etc. are placeholders filled at
send time, leave them in place.

Source map (where each lives, for my reference):
- Welcome → `lib/email/send-welcome.ts`
- Confirm / Reset / Change / Password-changed / Email-changed → `scripts/build-supabase-emails.ts`
- Share invite → `lib/email/send-share-invite.ts`
- Billing receipt → lab sample (sender not wired yet)

---

## 1. Welcome (sent once, on signup)

- Subject: أهلاً بك في taqreer.ai
- Preheader: تمت إضافة 400 رصيد مجاني إلى حسابك.
- Credits pill: تمت إضافة 400 رصيد مجاني
- Title: أهلاً بك في taqreer.ai
- Body: حوّل أفكارك إلى عروض تقديمية كاملة التصميم بالعربية والإنجليزية، ثم صدّرها بصيغة PowerPoint. رصيدك جاهز، ابدأ متى شئت.
- Button: ابدأ الإنشاء
- Templates label: أو ابدأ من قالب جاهز
- Footer note: يسعدنا انضمامك. إذا احتجت أي مساعدة، تواصل معنا على support@taqreer.ai.

---

## 2. Confirm signup (verify email)

- Subject: فعّل حسابك في taqreer.ai
- Title: فعّل حسابك
- Body: شكراً لانضمامك إلى taqreer.ai. أكمل تأكيد بريدك الإلكتروني لتفعيل حسابك والبدء في إنشاء عروضك التقديمية.
- Button: تأكيد البريد الإلكتروني
- Footer note: إذا لم تنشئ هذا الحساب، يمكنك تجاهل هذه الرسالة بأمان.

---

## 3. Reset password

- Subject: إعادة تعيين كلمة المرور
- Title: إعادة تعيين كلمة المرور
- Body: تلقّينا طلباً لإعادة تعيين كلمة مرور حسابك. اضغط الزر أدناه لاختيار كلمة مرور جديدة. هذا الرابط صالح لمدة محدودة.
- Button: إعادة تعيين كلمة المرور
- Footer note: إذا لم تطلب هذا، تجاهل هذه الرسالة وستبقى كلمة مرورك كما هي.

---

## 4. Change email (confirm new address)

- Subject: تأكيد بريدك الجديد
- Title: تأكيد بريدك الجديد
- Body: اضغط الزر أدناه لتأكيد عنوان بريدك الإلكتروني الجديد. لن يصبح التغيير سارياً حتى تؤكده.
- Button: تأكيد البريد الجديد
- Footer note: إذا لم تطلب هذا التغيير، تواصل معنا على support@taqreer.ai.

---

## 5. Password changed (security notice, no button)

- Subject: تم تغيير كلمة المرور
- Title: تم تغيير كلمة المرور
- Body: تم تغيير كلمة مرور حسابك على taqreer.ai بنجاح. إذا لم تقم بذلك، تواصل معنا فوراً على support@taqreer.ai.

---

## 6. Email changed (security notice, no button)

- Subject: تم تغيير بريدك الإلكتروني
- Title: تم تغيير بريدك الإلكتروني
- Body: تم تحديث عنوان البريد الإلكتروني لحسابك على taqreer.ai. إذا لم تقم بذلك، تواصل معنا فوراً على support@taqreer.ai.

---

## 7. Share invite (a deck shared with you)

- Subject: {name} شاركك عرضاً على taqreer.ai
- Title: تمت مشاركة عرض معك
- Body: شارك معك {name} عرض «{deck}» على taqreer.ai بصلاحية «{role}». افتحه للاطلاع والتعاون عليه مباشرة في المتصفح.
- Button: فتح العرض
- Footer note: إذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهل هذه الرسالة.
- Role words ({role}): عرض · تعليق · تعديل

---

## 8. Payment receipt (billing, sample)

- Subject: إيصال الدفع
- Title: إيصال الدفع
- Body: شكراً لاشتراكك في taqreer.ai. تم استلام دفعتك بنجاح.
- Summary labels: الخطة · المبلغ · التاريخ
- Button: عرض الفاتورة
- Footer note: سيتم تجديد اشتراكك تلقائياً. يمكنك الإدارة من إعدادات الفوترة.

---

(Contact-form notification is English-only, it goes to the internal team inbox, so no Arabic to review.)
