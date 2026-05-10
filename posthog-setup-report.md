<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into Taqreer. The integration covers client-side initialization via `instrumentation-client.ts`, a server-side PostHog client in `lib/posthog-server.ts`, a reverse proxy through Next.js rewrites, user identification on login/signup, and 10 distinct business events across 8 files — including server-side events from Inngest background functions.

| Event | Description | File |
|---|---|---|
| `user_signed_up` | Fired on successful email or Google signup. Identifies the user with PostHog on direct signup. | `app/(auth)/auth/signup/page.tsx` |
| `user_logged_in` | Fired on successful email login (with identify) or Google OAuth initiation. | `app/(auth)/auth/login/page.tsx` |
| `user_logged_out` | Fired when logout is clicked. Resets PostHog identity. | `components/app/LogoutButton.tsx` |
| `quick_action_clicked` | Fired when a dashboard quick action card is clicked (create, enhance, mimic, custom). | `components/app/QuickActions.tsx` |
| `template_used` | Fired when a user clicks "استخدم" on a template card. | `components/app/MyTemplates.tsx` |
| `profile_updated` | Fired when a user successfully saves profile changes in settings. | `app/(app)/settings/page.tsx` |
| `password_changed` | Fired when a user successfully changes their password. | `app/(app)/settings/page.tsx` |
| `account_deleted` | Fired when a user confirms account deletion. Resets PostHog identity. | `app/(app)/settings/page.tsx` |
| `presentation_generated` | Server-side: fired when an AI-generated deck is saved to the database. | `inngest/functions/deck-generate.ts` |
| `presentation_exported` | Server-side: fired when a presentation is successfully exported as PPTX. | `inngest/functions/deck-export.ts` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics dashboard](/dashboard/671915)
- [New Signups Over Time](/insights/wxSUWZKk) — daily signups by method (email vs Google)
- [Logins Over Time](/insights/kXAF91Ss) — daily unique logins
- [Activation Funnel: Signup → Login → Generate Presentation](/insights/J1hja8Aa) — conversion funnel to first AI-generated deck
- [Quick Actions Popularity](/insights/RC02PsBT) — which quick action cards users click most
- [Presentations Exported vs Generated](/insights/xyZafVhO) — export-to-generate ratio over time

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
