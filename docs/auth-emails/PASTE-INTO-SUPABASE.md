# Supabase auth emails - paste sheet

Dashboard: **Authentication -> Emails**. For each template below: paste the **Subject**, switch the body to **Source** mode, `Cmd+A` to select all, then paste the **Body**.

> The dashboard **Preview** shows the literal `{{ if }}` tag and renders the Arabic branch first then the English one. That is expected - the preview never evaluates Go conditionals. The real sent email evaluates `.Data.lang` and picks one language.

Arabic is the explicit branch; English is the default. Flat dark background (no aurora), the logo is a single baked PNG.

---

## 1. Confirm signup

**Subject:**

```
{{ if eq .Data.lang "ar" }}أكّد بريدك الإلكتروني{{ else }}Confirm your taqreer.ai email{{ end }}
```

**Body:**

```html
<!doctype html>
<html lang="{{ if eq .Data.lang "ar" }}ar{{ else }}en{{ end }}" dir="{{ if eq .Data.lang "ar" }}rtl{{ else }}ltr{{ end }}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <title>taqreer.ai</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600&display=swap');
      body { margin: 0; padding: 0; background: #111111; }
      a { text-decoration: none; }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#111111;">
{{ if eq .Data.lang "ar" }}
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#111111;">رمز التأكيد لتفعيل حسابك في taqreer.ai.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="background:#111111;">
      <tr>
        <td align="center" style="padding:0;">
          <!-- Email canvas: 600px, flat #111111. height=560 acts as a
               min-height; the footer row valigns to the bottom. -->
          <table role="presentation" width="600" height="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="width:600px;max-width:600px;background:#111111;font-family:'Cairo', -apple-system, system-ui, 'Segoe UI', Tahoma, Arial, sans-serif;">
            <tr>
              <td valign="top" align="center" dir="rtl" style="padding:76px 40px 0;text-align:center;">
                <!-- logo box: single baked PNG (mark + tile + hairline border), flip-proof -->
                <img src="https://taqreer.ai/email/icon-box.png" width="62" height="62" alt="taqreer.ai" style="display:block;width:62px;height:62px;margin:0 auto 48px;" />
                
                <h1 style="margin:0;font-size:30px;font-weight:400;letter-spacing:-0.01em;color:#ffffff;line-height:1.3;">أكّد بريدك الإلكتروني</h1>
                <p style="margin:20px auto 0;max-width:384px;font-size:15px;font-weight:400;line-height:1.75;color:#b4b4b4;">بقيت خطوة واحدة لتفعيل حسابك. أدخل الرمز أدناه في صفحة التسجيل لتكمل من حيث توقفت، أو اضغط زر التأكيد.</p>
                
              <p style="margin:36px 0 10px;font-size:13px;line-height:1.6;color:#b4b4b4;">رمز التأكيد</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
                <tr>
                  <td align="center" dir="ltr" style="padding:14px 28px;border:1px solid rgba(255,255,255,0.18);border-radius:14px;background:#1b1b1b;font-family:'Courier New',Courier,monospace;font-size:30px;font-weight:600;letter-spacing:8px;color:#ffffff;">{{ .Token }}</td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:44px auto 0;">
                <tr>
                  <td align="center" bgcolor="#0057FF" style="background:#0057FF;border-radius:999px;">
                    <a href="{{ .SiteURL }}/confirm?token_hash={{ .TokenHash }}&amp;type=email&amp;next=%2Far%2Fdashboard" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:500;color:#ffffff;text-decoration:none;">تأكيد البريد الإلكتروني</a>
                  </td>
                </tr>
              </table>
                
              </td>
            </tr>
            <tr>
              <td valign="bottom" align="center" dir="rtl" style="padding:56px 36px 84px;text-align:center;">
                <p style="margin:0 0 18px;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">إذا لم تنشئ هذا الحساب، يمكنك تجاهل هذه الرسالة بأمان.</p>
                <p dir="ltr" style="margin:0;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">taqreer.ai<br />5830 E 2nd St, Ste 7000, Casper, WY 82609, USA</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
{{ else }}
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#111111;">Your code to activate your taqreer.ai account.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="background:#111111;">
      <tr>
        <td align="center" style="padding:0;">
          <!-- Email canvas: 600px, flat #111111. height=560 acts as a
               min-height; the footer row valigns to the bottom. -->
          <table role="presentation" width="600" height="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="width:600px;max-width:600px;background:#111111;font-family:'Cairo', -apple-system, system-ui, 'Segoe UI', Tahoma, Arial, sans-serif;">
            <tr>
              <td valign="top" align="center" dir="ltr" style="padding:76px 40px 0;text-align:center;">
                <!-- logo box: single baked PNG (mark + tile + hairline border), flip-proof -->
                <img src="https://taqreer.ai/email/icon-box.png" width="62" height="62" alt="taqreer.ai" style="display:block;width:62px;height:62px;margin:0 auto 48px;" />
                
                <h1 style="margin:0;font-size:26px;font-weight:400;letter-spacing:-0.01em;color:#ffffff;line-height:1.3;">Activate your account</h1>
                <p style="margin:20px auto 0;max-width:384px;font-size:15px;font-weight:400;line-height:1.75;color:#b4b4b4;">Thanks for joining taqreer.ai. Enter the code below on the sign-up page to pick up where you left off, or press the button.</p>
                
              <p style="margin:36px 0 10px;font-size:13px;line-height:1.6;color:#b4b4b4;">Your confirmation code</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
                <tr>
                  <td align="center" dir="ltr" style="padding:14px 28px;border:1px solid rgba(255,255,255,0.18);border-radius:14px;background:#1b1b1b;font-family:'Courier New',Courier,monospace;font-size:30px;font-weight:600;letter-spacing:8px;color:#ffffff;">{{ .Token }}</td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:44px auto 0;">
                <tr>
                  <td align="center" bgcolor="#0057FF" style="background:#0057FF;border-radius:999px;">
                    <a href="{{ .SiteURL }}/confirm?token_hash={{ .TokenHash }}&amp;type=email&amp;next=%2Fen%2Fdashboard" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:500;color:#ffffff;text-decoration:none;">Confirm email</a>
                  </td>
                </tr>
              </table>
                
              </td>
            </tr>
            <tr>
              <td valign="bottom" align="center" dir="ltr" style="padding:56px 36px 84px;text-align:center;">
                <p style="margin:0 0 18px;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">If you didn't create this account, you can safely ignore this email.</p>
                <p dir="ltr" style="margin:0;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">taqreer.ai<br />5830 E 2nd St, Ste 7000, Casper, WY 82609, USA</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
{{ end }}
  </body>
</html>
```

---

## 2. Reset password

**Subject:**

```
{{ if eq .Data.lang "ar" }}إعادة تعيين كلمة المرور{{ else }}Reset your taqreer.ai password{{ end }}
```

**Body:**

```html
<!doctype html>
<html lang="{{ if eq .Data.lang "ar" }}ar{{ else }}en{{ end }}" dir="{{ if eq .Data.lang "ar" }}rtl{{ else }}ltr{{ end }}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <title>taqreer.ai</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600&display=swap');
      body { margin: 0; padding: 0; background: #111111; }
      a { text-decoration: none; }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#111111;">
{{ if eq .Data.lang "ar" }}
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#111111;">استخدم الرابط لاختيار كلمة مرور جديدة.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="background:#111111;">
      <tr>
        <td align="center" style="padding:0;">
          <!-- Email canvas: 600px, flat #111111. height=560 acts as a
               min-height; the footer row valigns to the bottom. -->
          <table role="presentation" width="600" height="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="width:600px;max-width:600px;background:#111111;font-family:'Cairo', -apple-system, system-ui, 'Segoe UI', Tahoma, Arial, sans-serif;">
            <tr>
              <td valign="top" align="center" dir="rtl" style="padding:76px 40px 0;text-align:center;">
                <!-- logo box: single baked PNG (mark + tile + hairline border), flip-proof -->
                <img src="https://taqreer.ai/email/icon-box.png" width="62" height="62" alt="taqreer.ai" style="display:block;width:62px;height:62px;margin:0 auto 48px;" />
                
                <h1 style="margin:0;font-size:30px;font-weight:400;letter-spacing:-0.01em;color:#ffffff;line-height:1.3;">إعادة تعيين كلمة المرور</h1>
                <p style="margin:20px auto 0;max-width:384px;font-size:15px;font-weight:400;line-height:1.75;color:#b4b4b4;">تلقّينا طلبًا لإعادة تعيين كلمة مرور حسابك. اضغط الزر أدناه لاختيار كلمة مرور جديدة. الرابط صالح لمدة محدودة حفاظًا على أمان حسابك.</p>
                
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:44px auto 0;">
                <tr>
                  <td align="center" bgcolor="#0057FF" style="background:#0057FF;border-radius:999px;">
                    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:500;color:#ffffff;text-decoration:none;">إعادة تعيين كلمة المرور</a>
                  </td>
                </tr>
              </table>
                
              </td>
            </tr>
            <tr>
              <td valign="bottom" align="center" dir="rtl" style="padding:56px 36px 84px;text-align:center;">
                <p style="margin:0 0 18px;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">إذا لم تطلب إعادة التعيين، تجاهل هذه الرسالة وستبقى كلمة مرورك كما هي.</p>
                <p dir="ltr" style="margin:0;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">taqreer.ai<br />5830 E 2nd St, Ste 7000, Casper, WY 82609, USA</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
{{ else }}
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#111111;">Use the link to choose a new password.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="background:#111111;">
      <tr>
        <td align="center" style="padding:0;">
          <!-- Email canvas: 600px, flat #111111. height=560 acts as a
               min-height; the footer row valigns to the bottom. -->
          <table role="presentation" width="600" height="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="width:600px;max-width:600px;background:#111111;font-family:'Cairo', -apple-system, system-ui, 'Segoe UI', Tahoma, Arial, sans-serif;">
            <tr>
              <td valign="top" align="center" dir="ltr" style="padding:76px 40px 0;text-align:center;">
                <!-- logo box: single baked PNG (mark + tile + hairline border), flip-proof -->
                <img src="https://taqreer.ai/email/icon-box.png" width="62" height="62" alt="taqreer.ai" style="display:block;width:62px;height:62px;margin:0 auto 48px;" />
                
                <h1 style="margin:0;font-size:26px;font-weight:400;letter-spacing:-0.01em;color:#ffffff;line-height:1.3;">Reset your password</h1>
                <p style="margin:20px auto 0;max-width:384px;font-size:15px;font-weight:400;line-height:1.75;color:#b4b4b4;">We received a request to reset your password. Choose a new one below. This link is valid for a limited time.</p>
                
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:44px auto 0;">
                <tr>
                  <td align="center" bgcolor="#0057FF" style="background:#0057FF;border-radius:999px;">
                    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:500;color:#ffffff;text-decoration:none;">Reset password</a>
                  </td>
                </tr>
              </table>
                
              </td>
            </tr>
            <tr>
              <td valign="bottom" align="center" dir="ltr" style="padding:56px 36px 84px;text-align:center;">
                <p style="margin:0 0 18px;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">If you didn't request this, ignore this email and your password stays unchanged.</p>
                <p dir="ltr" style="margin:0;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">taqreer.ai<br />5830 E 2nd St, Ste 7000, Casper, WY 82609, USA</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
{{ end }}
  </body>
</html>
```

---

## 3. Change email address

**Subject:**

```
{{ if eq .Data.lang "ar" }}تأكيد بريدك الجديد{{ else }}Confirm your new email{{ end }}
```

**Body:**

```html
<!doctype html>
<html lang="{{ if eq .Data.lang "ar" }}ar{{ else }}en{{ end }}" dir="{{ if eq .Data.lang "ar" }}rtl{{ else }}ltr{{ end }}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <title>taqreer.ai</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600&display=swap');
      body { margin: 0; padding: 0; background: #111111; }
      a { text-decoration: none; }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#111111;">
{{ if eq .Data.lang "ar" }}
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#111111;">أكّد العنوان الجديد لتحديث بريد حسابك.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="background:#111111;">
      <tr>
        <td align="center" style="padding:0;">
          <!-- Email canvas: 600px, flat #111111. height=560 acts as a
               min-height; the footer row valigns to the bottom. -->
          <table role="presentation" width="600" height="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="width:600px;max-width:600px;background:#111111;font-family:'Cairo', -apple-system, system-ui, 'Segoe UI', Tahoma, Arial, sans-serif;">
            <tr>
              <td valign="top" align="center" dir="rtl" style="padding:76px 40px 0;text-align:center;">
                <!-- logo box: single baked PNG (mark + tile + hairline border), flip-proof -->
                <img src="https://taqreer.ai/email/icon-box.png" width="62" height="62" alt="taqreer.ai" style="display:block;width:62px;height:62px;margin:0 auto 48px;" />
                
                <h1 style="margin:0;font-size:30px;font-weight:400;letter-spacing:-0.01em;color:#ffffff;line-height:1.3;">تأكيد بريدك الجديد</h1>
                <p style="margin:20px auto 0;max-width:384px;font-size:15px;font-weight:400;line-height:1.75;color:#b4b4b4;">اضغط الزر أدناه لتأكيد عنوان بريدك الإلكتروني الجديد. لن يتم تحديث بريد حسابك حتى يتم التأكيد.</p>
                
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:44px auto 0;">
                <tr>
                  <td align="center" bgcolor="#0057FF" style="background:#0057FF;border-radius:999px;">
                    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:500;color:#ffffff;text-decoration:none;">تأكيد البريد الجديد</a>
                  </td>
                </tr>
              </table>
                
              </td>
            </tr>
            <tr>
              <td valign="bottom" align="center" dir="rtl" style="padding:56px 36px 84px;text-align:center;">
                <p style="margin:0 0 18px;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">إذا لم تطلب هذا التغيير، تواصل معنا على <a href="mailto:support@taqreer.ai" style="color:#66A3FF;text-decoration:none;">support@taqreer.ai</a>.</p>
                <p dir="ltr" style="margin:0;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">taqreer.ai<br />5830 E 2nd St, Ste 7000, Casper, WY 82609, USA</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
{{ else }}
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#111111;">Confirm the new address to update your account email.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="background:#111111;">
      <tr>
        <td align="center" style="padding:0;">
          <!-- Email canvas: 600px, flat #111111. height=560 acts as a
               min-height; the footer row valigns to the bottom. -->
          <table role="presentation" width="600" height="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="width:600px;max-width:600px;background:#111111;font-family:'Cairo', -apple-system, system-ui, 'Segoe UI', Tahoma, Arial, sans-serif;">
            <tr>
              <td valign="top" align="center" dir="ltr" style="padding:76px 40px 0;text-align:center;">
                <!-- logo box: single baked PNG (mark + tile + hairline border), flip-proof -->
                <img src="https://taqreer.ai/email/icon-box.png" width="62" height="62" alt="taqreer.ai" style="display:block;width:62px;height:62px;margin:0 auto 48px;" />
                
                <h1 style="margin:0;font-size:26px;font-weight:400;letter-spacing:-0.01em;color:#ffffff;line-height:1.3;">Confirm your new email</h1>
                <p style="margin:20px auto 0;max-width:384px;font-size:15px;font-weight:400;line-height:1.75;color:#b4b4b4;">Confirm your new email address below. The change doesn't take effect until you confirm it.</p>
                
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:44px auto 0;">
                <tr>
                  <td align="center" bgcolor="#0057FF" style="background:#0057FF;border-radius:999px;">
                    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:500;color:#ffffff;text-decoration:none;">Confirm new email</a>
                  </td>
                </tr>
              </table>
                
              </td>
            </tr>
            <tr>
              <td valign="bottom" align="center" dir="ltr" style="padding:56px 36px 84px;text-align:center;">
                <p style="margin:0 0 18px;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">If you didn't request this change, contact <a href="mailto:support@taqreer.ai" style="color:#66A3FF;text-decoration:none;">support@taqreer.ai</a>.</p>
                <p dir="ltr" style="margin:0;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">taqreer.ai<br />5830 E 2nd St, Ste 7000, Casper, WY 82609, USA</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
{{ end }}
  </body>
</html>
```

---

## 4. Password changed  (security notice - enable its toggle if off)

**Subject:**

```
{{ if eq .Data.lang "ar" }}تم تغيير كلمة المرور{{ else }}Your taqreer.ai password was changed{{ end }}
```

**Body:**

```html
<!doctype html>
<html lang="{{ if eq .Data.lang "ar" }}ar{{ else }}en{{ end }}" dir="{{ if eq .Data.lang "ar" }}rtl{{ else }}ltr{{ end }}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <title>taqreer.ai</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600&display=swap');
      body { margin: 0; padding: 0; background: #111111; }
      a { text-decoration: none; }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#111111;">
{{ if eq .Data.lang "ar" }}
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#111111;">إشعار أمان من taqreer.ai.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="background:#111111;">
      <tr>
        <td align="center" style="padding:0;">
          <!-- Email canvas: 600px, flat #111111. height=560 acts as a
               min-height; the footer row valigns to the bottom. -->
          <table role="presentation" width="600" height="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="width:600px;max-width:600px;background:#111111;font-family:'Cairo', -apple-system, system-ui, 'Segoe UI', Tahoma, Arial, sans-serif;">
            <tr>
              <td valign="top" align="center" dir="rtl" style="padding:76px 40px 0;text-align:center;">
                <!-- logo box: single baked PNG (mark + tile + hairline border), flip-proof -->
                <img src="https://taqreer.ai/email/icon-box.png" width="62" height="62" alt="taqreer.ai" style="display:block;width:62px;height:62px;margin:0 auto 48px;" />
                
                <h1 style="margin:0;font-size:30px;font-weight:400;letter-spacing:-0.01em;color:#ffffff;line-height:1.3;">تم تغيير كلمة المرور</h1>
                <p style="margin:20px auto 0;max-width:384px;font-size:15px;font-weight:400;line-height:1.75;color:#b4b4b4;">تم تغيير كلمة مرور حسابك بنجاح. إذا لم تكن أنت من قام بهذا التغيير، تواصل معنا فورًا على <a href="mailto:support@taqreer.ai" style="color:#66A3FF;text-decoration:none;">support@taqreer.ai</a>.</p>
                
                
              </td>
            </tr>
            <tr>
              <td valign="bottom" align="center" dir="rtl" style="padding:56px 36px 84px;text-align:center;">
                
                <p dir="ltr" style="margin:0;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">taqreer.ai<br />5830 E 2nd St, Ste 7000, Casper, WY 82609, USA</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
{{ else }}
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#111111;">Security alert from your taqreer.ai account.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="background:#111111;">
      <tr>
        <td align="center" style="padding:0;">
          <!-- Email canvas: 600px, flat #111111. height=560 acts as a
               min-height; the footer row valigns to the bottom. -->
          <table role="presentation" width="600" height="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="width:600px;max-width:600px;background:#111111;font-family:'Cairo', -apple-system, system-ui, 'Segoe UI', Tahoma, Arial, sans-serif;">
            <tr>
              <td valign="top" align="center" dir="ltr" style="padding:76px 40px 0;text-align:center;">
                <!-- logo box: single baked PNG (mark + tile + hairline border), flip-proof -->
                <img src="https://taqreer.ai/email/icon-box.png" width="62" height="62" alt="taqreer.ai" style="display:block;width:62px;height:62px;margin:0 auto 48px;" />
                
                <h1 style="margin:0;font-size:26px;font-weight:400;letter-spacing:-0.01em;color:#ffffff;line-height:1.3;">Your password was changed</h1>
                <p style="margin:20px auto 0;max-width:384px;font-size:15px;font-weight:400;line-height:1.75;color:#b4b4b4;">Your taqreer.ai account password was changed successfully. If this wasn't you, contact us right away at <a href="mailto:support@taqreer.ai" style="color:#66A3FF;text-decoration:none;">support@taqreer.ai</a>.</p>
                
                
              </td>
            </tr>
            <tr>
              <td valign="bottom" align="center" dir="ltr" style="padding:56px 36px 84px;text-align:center;">
                
                <p dir="ltr" style="margin:0;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">taqreer.ai<br />5830 E 2nd St, Ste 7000, Casper, WY 82609, USA</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
{{ end }}
  </body>
</html>
```

---

## 5. Email changed  (security notice - enable its toggle if off)

**Subject:**

```
{{ if eq .Data.lang "ar" }}تم تغيير البريد الإلكتروني{{ else }}Your taqreer.ai email was changed{{ end }}
```

**Body:**

```html
<!doctype html>
<html lang="{{ if eq .Data.lang "ar" }}ar{{ else }}en{{ end }}" dir="{{ if eq .Data.lang "ar" }}rtl{{ else }}ltr{{ end }}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <title>taqreer.ai</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600&display=swap');
      body { margin: 0; padding: 0; background: #111111; }
      a { text-decoration: none; }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#111111;">
{{ if eq .Data.lang "ar" }}
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#111111;">إشعار أمان من taqreer.ai.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="background:#111111;">
      <tr>
        <td align="center" style="padding:0;">
          <!-- Email canvas: 600px, flat #111111. height=560 acts as a
               min-height; the footer row valigns to the bottom. -->
          <table role="presentation" width="600" height="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="width:600px;max-width:600px;background:#111111;font-family:'Cairo', -apple-system, system-ui, 'Segoe UI', Tahoma, Arial, sans-serif;">
            <tr>
              <td valign="top" align="center" dir="rtl" style="padding:76px 40px 0;text-align:center;">
                <!-- logo box: single baked PNG (mark + tile + hairline border), flip-proof -->
                <img src="https://taqreer.ai/email/icon-box.png" width="62" height="62" alt="taqreer.ai" style="display:block;width:62px;height:62px;margin:0 auto 48px;" />
                
                <h1 style="margin:0;font-size:30px;font-weight:400;letter-spacing:-0.01em;color:#ffffff;line-height:1.3;">تم تغيير البريد الإلكتروني</h1>
                <p style="margin:20px auto 0;max-width:384px;font-size:15px;font-weight:400;line-height:1.75;color:#b4b4b4;">تم تحديث البريد الإلكتروني المرتبط بحسابك. إذا لم تكن أنت من طلب هذا التغيير، تواصل معنا فورًا على <a href="mailto:support@taqreer.ai" style="color:#66A3FF;text-decoration:none;">support@taqreer.ai</a>.</p>
                
                
              </td>
            </tr>
            <tr>
              <td valign="bottom" align="center" dir="rtl" style="padding:56px 36px 84px;text-align:center;">
                
                <p dir="ltr" style="margin:0;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">taqreer.ai<br />5830 E 2nd St, Ste 7000, Casper, WY 82609, USA</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
{{ else }}
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#111111;">Security alert from your taqreer.ai account.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="background:#111111;">
      <tr>
        <td align="center" style="padding:0;">
          <!-- Email canvas: 600px, flat #111111. height=560 acts as a
               min-height; the footer row valigns to the bottom. -->
          <table role="presentation" width="600" height="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#111111" style="width:600px;max-width:600px;background:#111111;font-family:'Cairo', -apple-system, system-ui, 'Segoe UI', Tahoma, Arial, sans-serif;">
            <tr>
              <td valign="top" align="center" dir="ltr" style="padding:76px 40px 0;text-align:center;">
                <!-- logo box: single baked PNG (mark + tile + hairline border), flip-proof -->
                <img src="https://taqreer.ai/email/icon-box.png" width="62" height="62" alt="taqreer.ai" style="display:block;width:62px;height:62px;margin:0 auto 48px;" />
                
                <h1 style="margin:0;font-size:26px;font-weight:400;letter-spacing:-0.01em;color:#ffffff;line-height:1.3;">Your email was changed</h1>
                <p style="margin:20px auto 0;max-width:384px;font-size:15px;font-weight:400;line-height:1.75;color:#b4b4b4;">The email address on your taqreer.ai account was updated. If this wasn't you, contact us right away at <a href="mailto:support@taqreer.ai" style="color:#66A3FF;text-decoration:none;">support@taqreer.ai</a>.</p>
                
                
              </td>
            </tr>
            <tr>
              <td valign="bottom" align="center" dir="ltr" style="padding:56px 36px 84px;text-align:center;">
                
                <p dir="ltr" style="margin:0;font-size:12px;line-height:1.7;color:rgba(255,255,255,0.55);">taqreer.ai<br />5830 E 2nd St, Ste 7000, Casper, WY 82609, USA</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
{{ end }}
  </body>
</html>
```
