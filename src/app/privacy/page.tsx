import Link from "next/link";
import { Heading } from "@/components/ui/Heading";

const LAST_UPDATED = "September 23, 2026";

/**
 * A real Privacy Policy describing what this app actually does with data —
 * every claim below was checked directly against the current codebase
 * (storage keys, API routes, third-party calls) rather than written from a
 * generic template, specifically so this document doesn't promise more (or
 * less) protection than what's actually implemented. If the app's data
 * handling changes, this page needs to change with it — a Privacy Policy
 * that no longer matches real behavior is a liability, not a shield.
 * Operated by Ezra Dietze as an individual (no LLC formed yet). Not a
 * substitute for review by a licensed attorney.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl animate-fade-in">
      <Heading as="h1" className="text-2xl text-ink sm:text-3xl">
        Privacy Policy
      </Heading>
      <p className="mt-1.5 text-xs text-ink-faint">Last updated {LAST_UPDATED}</p>

      <div className="mt-6 space-y-8 text-sm leading-relaxed text-ink-muted">
        <Section title="Overview">
          <p>
            This Privacy Policy explains what information Line Select (&ldquo;the
            Service,&rdquo; operated by{" "}
            <span className="font-medium text-ink">Ezra Dietze</span>) collects, why,
            and what happens to it. We built the Service around a simple rule: your bid pack and
            your preferences are yours, and as little as possible about you ever reaches a server
            at all. Read this alongside our{" "}
            <Link href="/terms" className="underline decoration-dotted underline-offset-4 hover:text-ink">
              Terms of Service
            </Link>
            .
          </p>
        </Section>

        <Section title="1. Your bid pack PDF">
          <p>
            When you upload a bid pack, the file is sent to our server once, over an encrypted
            connection, purely to extract pairing data, line data, reserve-line on-call types, and
            the pack&rsquo;s own printed summary numbers (guarantees, credit ranges, line counts).
            The PDF itself is never written to disk or stored &mdash; it is held in memory only for
            the seconds it takes to parse, then discarded. We deliberately never read or extract
            pages listing other pilots&rsquo; names, employee numbers, seniority lists, vacation
            schedules, or training rosters, even when they appear in the same file; our parser
            classifies and skips those pages by design.
          </p>
        </Section>

        <Section title="2. Your bid pack and rankings stay on your device; your preferences follow your account">
          <p>
            The parsed bid pack and your line rankings are stored only in your own browser&rsquo;s
            local storage on your own device &mdash; they are never uploaded to, or stored on, our
            servers, whether or not you have an account. If you clear your browser data or switch
            devices, that information is gone and you&rsquo;ll need to re-upload.
          </p>
          <p className="mt-3">
            Your interview answers and preference weights work differently if you create an
            account: they&rsquo;re also stored on our server, keyed to your account, specifically
            so they follow you to a new device or browser instead of being lost &mdash; the same
            reasoning as Trade Board and Inbox below. If you use the Service only as a guest, your
            preferences stay local-only, the same as your bid pack.
          </p>
        </Section>

        <Section title="3. The adaptive interview and hotel review summaries use a third-party AI provider">
          <p>
            The interview&rsquo;s questions, and the plain-language summaries shown on the Hotel
            Ratings page, are generated using Anthropic&rsquo;s Claude API. Your interview answers
            and relevant bid pack context (for the interview), or a hotel&rsquo;s public review
            text (for hotel summaries), are sent to Anthropic to generate that turn&rsquo;s response
            or summary. We do not send your name, email, or account identity as part of these
            requests. Anthropic processes this data under its own API terms; as of this writing,
            Anthropic does not use API inputs to train its models by default. Your interview
            transcript is stored alongside the rest of your profile &mdash; in your browser, and,
            if you&rsquo;re signed in, on our server as part of your saved preferences (Section 2) &mdash;
            not in any separate record.
          </p>
        </Section>

        <Section title="4. Hotel Ratings uses a third-party mapping/places provider">
          <p>
            To show you ratings, amenities, and reviews for the actual hotel your bid pack assigns
            to a layover, we send that hotel&rsquo;s name and the relevant airport/city code to
            Google Places. The resulting rating, address, amenity, and review data is cached on our
            server for up to 30 days and shared across all pilots looking up the same hotel &mdash;
            it is not linked to your identity in any way.
          </p>
        </Section>

        <Section title="5. If you create an account">
          <p>Creating an account is optional and only required to use the Trade Board, Inbox, and award-history reporting. If you create one, we store:</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>Your email address and display name, as you provide them;</li>
            <li>
              Your password &mdash; never in plain text. It&rsquo;s hashed with a per-account
              random salt using scrypt, a standard, well-reviewed algorithm, before it&rsquo;s
              stored;
            </li>
            <li>
              A recovery code, shown to you once when you sign up, so you can get back in if you forget your
              password &mdash; also stored only as a salted hash, never in a form that can be read back;
            </li>
            <li>
              If you ask to reset your password by email, a single-use reset link is sent to the address on your
              account through a transactional email provider (Resend). Only a hash of the link&rsquo;s token is
              kept, and it expires after an hour or once used. That is the only email we send you;
            </li>
            <li>
              A session token in an <code className="font-mono text-xs">httpOnly</code> cookie
              (inaccessible to page scripts) used to keep you signed in.
            </li>
          </ul>
        </Section>

        <Section title="6. Trade Board and Inbox">
          <p>
            A trade offer you post &mdash; your display name, the trip details you&rsquo;re
            offering, and any note you write &mdash; is stored on our server and shown to other
            users of the Service, since that&rsquo;s the entire point of the feature. It is not
            private. Don&rsquo;t include information in a note that you don&rsquo;t want visible
            to other pilots.
          </p>
        </Section>

        <Section title="7. Award-history reports are anonymous">
          <p>
            If you report what you actually held for a bid period, we store your seniority number,
            the base/aircraft/seat, and the outcome (line, reserve, or other) &mdash; but that
            record is not linked back to your account or identity in our database. We can&rsquo;t
            tell which report is yours after you submit it, and neither can any other pilot.
          </p>
        </Section>

        <Section title="8. Free-text explanations for a ranking correction">
          <p>
            If you drag-correct a line&rsquo;s ranking and the Service asks why, and your answer
            doesn&rsquo;t map cleanly onto an existing preference, we store your verbatim answer
            together with your account so it can be reviewed later to improve the preference
            taxonomy. Please avoid including sensitive personal details (medical, family, or
            financial information) in these answers &mdash; they&rsquo;re not necessary for the
            Service to work, and while they&rsquo;re not shown to other pilots, they are retained
            longer-term for this review purpose. You can request deletion of these at any time
            (Section 13).
          </p>
        </Section>

        <Section title="9. Feedback you send us">
          <p>
            If you use the &ldquo;Send feedback&rdquo; option in the app, your message is sent to
            our server and stored there &mdash; unlike your bid pack and preferences, this one
            piece of data is never local-only, since the whole point is that it reaches us. If
            you&rsquo;re signed in, your name and email are attached to it so we can follow up; a
            guest submission carries no identifying information at all. Please avoid including
            sensitive personal details you wouldn&rsquo;t want stored this way &mdash; they&rsquo;re
            not necessary to report a bug or an idea.
          </p>
        </Section>

        <Section title="10. Technical and abuse-prevention data">
          <p>
            To prevent abuse of the Service (and its underlying paid AI and data providers), we
            briefly record request counts keyed to your account (if signed in) or IP address (if
            not), for routes like the interview, bid-pack upload, hotel lookups, and feedback
            submissions. These counters
            expire automatically, typically within an hour, and are used only to enforce rate
            limits &mdash; not for tracking or profiling.
          </p>
        </Section>

        <Section title="11. Usage analytics and error monitoring">
          <p>
            The Service uses PostHog to see which pages get used and to catch errors before a
            pilot has to report one themselves. This sends page-view events and a small, fixed set
            of named usage events (for example, that a bid pack was confirmed, or that the
            interview was completed) &mdash; never the bid pack&rsquo;s contents, your interview
            answers, your preference weights, or any free text you&rsquo;ve written anywhere in the
            Service. If something crashes, the error and the page it happened on are sent the same
            way. If you&rsquo;re signed in, these events are tied to your account id so we can tell
            how many distinct pilots hit an issue rather than how many times it happened to one
            pilot &mdash; never your name or email. We don&rsquo;t use this for advertising, and we
            don&rsquo;t run session recording or record what you click or type.
          </p>
        </Section>

        <Section title="12. What we don't do">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>We don&rsquo;t sell or rent your personal information to anyone.</li>
            <li>
              We don&rsquo;t run advertising pixels or third-party marketing scripts on the
              Service. We do run one analytics/error-monitoring tool (Section 11) &mdash; see there
              for exactly what it collects.
            </li>
            <li>
              We don&rsquo;t read, extract, or store any page from your bid pack that lists another
              pilot&rsquo;s name, employee number, or seniority.
            </li>
            <li>We don&rsquo;t use your bid pack, interview answers, or account data to train any AI model ourselves.</li>
          </ul>
        </Section>

        <Section title="13. Your choices and rights">
          <p>
            You can delete your account at any time by contacting us at the address below; this
            removes your login credentials and disassociates your future access, though Trade Board
            posts, award-history reports, and feedback (Section 9) already sent may remain &mdash;
            the first because it was shared publicly by design, the other two because they were
            never linked back to you once your account is gone. You can clear your locally-stored
            bid pack, and any preferences saved only as a guest, at any time from within the app,
            or simply by clearing your browser&rsquo;s site data.
          </p>
          <p className="mt-3">
            Regardless of where you live, you may contact us to ask what account-linked data we
            hold about you, request its deletion, or ask us to stop processing it &mdash; we&rsquo;ll
            honor reasonable requests even though the Service, given its size, does not currently
            meet the legal thresholds that make certain state privacy laws (like California&rsquo;s
            CCPA/CPRA) mandatory.
          </p>
        </Section>

        <Section title="14. Children's privacy">
          <p>
            The Service is intended for working airline pilots and is not directed at, or intended
            for use by, anyone under 18. We don&rsquo;t knowingly collect information from anyone
            under 18.
          </p>
        </Section>

        <Section title="15. Security">
          <p>
            We use industry-standard measures appropriate to the data we actually hold &mdash;
            encrypted connections, salted password hashing, httpOnly session cookies, and rate
            limiting on every route that touches a paid third-party service or account creation.
            No method of transmission or storage is perfectly secure, and we can&rsquo;t guarantee
            absolute security.
          </p>
        </Section>

        <Section title="16. Changes to this policy">
          <p>
            We may update this Privacy Policy as the Service changes. We&rsquo;ll update the
            &ldquo;Last updated&rdquo; date above whenever we do, and for a material change
            we&rsquo;ll provide reasonably prominent notice.
          </p>
        </Section>

        <Section title="17. Contact">
          <p>
            Questions about this policy, or a request about your data, can be sent to{" "}
            <a
              href="mailto:ezradietze@gmail.com"
              className="underline decoration-dotted underline-offset-4 hover:text-ink"
            >
              ezradietze@gmail.com
            </a>
            .
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
