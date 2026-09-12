import Link from "next/link";
import { Heading } from "@/components/ui/Heading";

const LAST_UPDATED = "September 11, 2026";

/**
 * A real Privacy Policy describing what this app actually does with data —
 * every claim below was checked directly against the current codebase
 * (storage keys, API routes, third-party calls) rather than written from a
 * generic template, specifically so this document doesn't promise more (or
 * less) protection than what's actually implemented. If the app's data
 * handling changes, this page needs to change with it — a Privacy Policy
 * that no longer matches real behavior is a liability, not a shield. Two
 * bracketed placeholders need the operator's own facts filled in. Not a
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
            <span className="font-medium text-ink">[OPERATOR NAME/ENTITY]</span>) collects, why,
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

        <Section title="2. Your preferences and rankings stay on your device">
          <p>
            The parsed bid pack, your interview answers, your preference weights, and your line
            rankings are stored only in your own browser&rsquo;s local storage on your own device
            &mdash; they are never uploaded to, or stored on, our servers, whether or not you have
            an account. If you clear your browser data or switch devices, that information is
            gone and you&rsquo;ll need to re-upload and re-answer. Creating an account does not
            change this &mdash; it only enables the account-linked features described below
            (Trade Board, Inbox, and reporting what you held).
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
            Anthropic does not use API inputs to train its models by default. We do not separately
            store your interview transcript on our servers &mdash; it lives in your browser
            alongside the rest of your profile, as described above.
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
            (Section 11).
          </p>
        </Section>

        <Section title="9. Technical and abuse-prevention data">
          <p>
            To prevent abuse of the Service (and its underlying paid AI and data providers), we
            briefly record request counts keyed to your account (if signed in) or IP address (if
            not), for routes like the interview, bid-pack upload, and hotel lookups. These counters
            expire automatically, typically within an hour, and are used only to enforce rate
            limits &mdash; not for tracking or profiling.
          </p>
        </Section>

        <Section title="10. What we don't do">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>We don&rsquo;t sell or rent your personal information to anyone.</li>
            <li>
              We don&rsquo;t run analytics trackers, advertising pixels, or third-party marketing
              scripts on the Service.
            </li>
            <li>
              We don&rsquo;t read, extract, or store any page from your bid pack that lists another
              pilot&rsquo;s name, employee number, or seniority.
            </li>
            <li>We don&rsquo;t use your bid pack, interview answers, or account data to train any AI model ourselves.</li>
          </ul>
        </Section>

        <Section title="11. Your choices and rights">
          <p>
            You can delete your account at any time by contacting us at the address below; this
            removes your login credentials and disassociates your future access, though Trade Board
            posts and award-history reports already made may remain (the former because they were
            shared publicly by design, the latter because they were never linked to you in the
            first place). You can clear your locally-stored bid pack and preferences at any time
            from within the app, or simply by clearing your browser&rsquo;s site data.
          </p>
          <p className="mt-3">
            Regardless of where you live, you may contact us to ask what account-linked data we
            hold about you, request its deletion, or ask us to stop processing it &mdash; we&rsquo;ll
            honor reasonable requests even though the Service, given its size, does not currently
            meet the legal thresholds that make certain state privacy laws (like California&rsquo;s
            CCPA/CPRA) mandatory.
          </p>
        </Section>

        <Section title="12. Children's privacy">
          <p>
            The Service is intended for working airline pilots and is not directed at, or intended
            for use by, anyone under 18. We don&rsquo;t knowingly collect information from anyone
            under 18.
          </p>
        </Section>

        <Section title="13. Security">
          <p>
            We use industry-standard measures appropriate to the data we actually hold &mdash;
            encrypted connections, salted password hashing, httpOnly session cookies, and rate
            limiting on every route that touches a paid third-party service or account creation.
            No method of transmission or storage is perfectly secure, and we can&rsquo;t guarantee
            absolute security.
          </p>
        </Section>

        <Section title="14. Changes to this policy">
          <p>
            We may update this Privacy Policy as the Service changes. We&rsquo;ll update the
            &ldquo;Last updated&rdquo; date above whenever we do, and for a material change
            we&rsquo;ll provide reasonably prominent notice.
          </p>
        </Section>

        <Section title="15. Contact">
          <p>
            Questions about this policy, or a request about your data, can be sent to{" "}
            <a
              href="mailto:privacy@lineselect.app"
              className="underline decoration-dotted underline-offset-4 hover:text-ink"
            >
              privacy@lineselect.app
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
