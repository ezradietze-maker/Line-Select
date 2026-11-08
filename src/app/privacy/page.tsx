import Link from "next/link";
import { Heading } from "@/components/ui/Heading";

const LAST_UPDATED = "November 8, 2026";

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
    <div className="mx-auto w-full max-w-3xl">
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
            your preferences are yours, and we keep only what a feature needs. As a guest, they stay on
            your device; with an account, they follow you to your other devices. Read this alongside our{" "}
            <Link href="/terms" className="underline decoration-dotted underline-offset-4 hover:text-ink">
              Terms of Service
            </Link>
            .
          </p>
        </Section>

        <Section title="1. Your bid pack PDF">
          <p>
            When you upload a bid pack, the file is sent to our server once, over an encrypted
            connection, purely to extract pairing data, line data, reserve-line on-call types, FedEx
            flights, and the pack&rsquo;s own printed summary numbers (guarantees, credit ranges, line
            counts). The PDF itself is never written to disk or stored &mdash; it is held in memory only
            for the seconds it takes to parse, then discarded.
          </p>
          <p className="mt-3">
            We never keep another pilot&rsquo;s name or employee number. Pages that only list people, such
            as training rosters, are classified and skipped unread. Two kinds of page that name other pilots
            are read, for numbers only; the name and employee number on each row are matched just to find
            the row and are never captured. From the Bid Seniority List we keep each pilot&rsquo;s place in
            bid order, their seniority number, and whether the list marks them as paid without bidding a
            line. From the Vacation Schedule we keep each vacation block&rsquo;s seniority number, number of
            days, and start and end dates. Those numbers tell the bid forecast (Section 7) how many pilots
            bid ahead of you, and let the Strategies page find and allow for your own vacation. They
            stay part of your parsed pack (Section 2).
          </p>
          <p className="mt-3">
            Parsing also records which hotels the pack names (airport code and hotel name, nothing about
            you) for up to 120 days, so a guest&rsquo;s hotel lookups can be limited to real ones.
          </p>
        </Section>

        <Section title="2. Your bid pack, rankings and preferences: on your device, and on your account if you have one">
          <p>
            <span className="font-medium text-ink">As a guest,</span> the parsed bid pack, your line rankings
            and your preferences are stored only in your own browser&rsquo;s local storage on your own device.
            They are never stored on our servers. If you clear your browser data or switch devices, that
            information is gone and you&rsquo;ll need to re-upload. (Looking up a commuter&rsquo;s flights sends
            the bid pack&rsquo;s FedEx flight times along for that one lookup, without storing them &mdash;
            Section 4.)
          </p>
          <p className="mt-3">
            <span className="font-medium text-ink">If you&rsquo;re signed in,</span> your latest parsed bid pack
            is also stored on our server, compressed and tied to your account, so it follows you to a new device
            and survives your browser clearing its storage. That is the extracted data described in Section 1,
            including the numbers from other pilots&rsquo; rows, and never the PDF. A pack you loaded as a guest
            moves there when you create an account. We keep one per account: each new upload replaces it, and it
            stays until you press &ldquo;Start over&rdquo; on your results page or your account is deleted
            (Section 15). The sample pack is never stored.
          </p>
          <p className="mt-3">
            Your interview answers and preference weights are stored on our server the same way, keyed to your
            account, so they follow you too &mdash; the same reasoning as Trade Board and Inbox below. That
            includes which lines you swapped on your results and any reason you gave. When a save replaces them,
            we keep the five most recent earlier versions for 30 days, as a way back if something you saved ever
            goes missing. These aren&rsquo;t shown in the app, only we can read them, and they expire on their
            own, even after &ldquo;Start over.&rdquo; An unfinished interview is also saved to your account so it
            can follow you to another device; that draft is kept for two days, or until you finish the interview
            or start it fresh.
          </p>
          <p className="mt-3">
            Your ranked order itself is worked out in your browser and kept there, apart from what you share for
            the forecast (Section 7).
          </p>
          <p className="mt-3">
            If you turn on a calendar link, your account also keeps what that calendar shows, for up to your last
            three bid months: your seat&rsquo;s bid dates; your awarded or #1 line&rsquo;s number and its trips, with
            their times, layovers, hotels, rides, pickups and any suggested commute flights; and your days off, if
            you ask for them. Your browser tells our server which line is your #1 so the calendar can follow it. It
            never includes other pilots&rsquo; data. We store only a hash of the link, but the link itself is secret:
            anyone who has it can read that calendar without signing in, and the calendar service you add it to
            (Apple, Google or Microsoft, say) fetches it and keeps a copy under its own terms. Making a new link
            stops the old one at once. Turning the link off, or deleting your account, also removes what we kept
            for it; &ldquo;Start over&rdquo; on your results page doesn&rsquo;t, so turn the link off too. A copy
            may stay in your calendar app until you remove the subscription there.
          </p>
          <p className="mt-3">
            If you use Send to VIPS, your own FedEx employee number and your answers to VIPS&rsquo;s
            bid questions are kept in your browser&rsquo;s local storage too, so you don&rsquo;t retype
            them. Pressing send posts your line order, those answers, and your employee number
            straight from your browser to FedEx&rsquo;s pilot site in a new tab &mdash; none of it passes
            through or is stored on our servers, and you sign in to FedEx yourself, so we never see
            your FedEx password.
          </p>
          <p className="mt-3">
            When you&rsquo;re signed in, your browser also keeps a copy of your account&rsquo;s basic
            details (its ID, email and display name) on your device, so the app can keep showing your own
            data if you reload with no connection &mdash; on a layover, say. Signing out removes it, and what else
            this device kept for your account, unless an edit hasn&rsquo;t reached your account yet.
          </p>
        </Section>

        <Section title="3. The AI features use a third-party provider">
          <p>
            These features use Anthropic&rsquo;s Claude API: the interview, Ask your pack, Ask the contract, reading the reason you
            type for swapping or correcting lines, and the plain-language summaries on the Hotel Ratings page.
            Each one sends Anthropic only what that turn needs: your interview answers and relevant bid pack
            context (for the interview); your question and a short summary of the pack (for Ask your pack); your question, the last few questions and answers in that chat, and, if it names a line, that line&rsquo;s figures and carry-in conflicts (for Ask the contract); what
            you typed, the lines involved and your list of priorities (for a reason); or a hotel&rsquo;s public
            review text (for hotel summaries). We do not attach your name, email, or account identity to these
            requests, though anything you type goes as you wrote it. Anthropic processes this data under its own
            API terms; as of this writing, Anthropic does not use API inputs to train its models by default. Your
            interview transcript is stored alongside the rest of your profile &mdash; in your browser, and, if
            you&rsquo;re signed in, on our server as part of your saved preferences (Section 2) &mdash; not in any
            separate record.
          </p>
        </Section>

        <Section title="4. Hotel ratings, commute flights, weather and dictation use third-party providers">
          <p>
            To show you ratings, amenities, and reviews for the actual hotel your bid pack assigns
            to a layover, we send that hotel&rsquo;s name and the relevant airport/city code to
            Google Places. The resulting rating, address, amenity, and review data is cached on our
            server for up to 30 days and shared across all pilots looking up the same hotel &mdash;
            it is not linked to your identity in any way.
          </p>
          <p className="mt-2">
            If you commute, the Service looks up the real flights that get you to and from your trips.
            Your browser sends our server the airports you fly from, the time windows around the trips
            in your top lines, and the FedEx flights printed in your bid pack (for jumpseat options).
            Our server asks AeroDataBox, a flight-schedule provider, for airport departure boards
            &mdash; airport codes and dates only, nothing about you. Those boards are cached on our
            server for up to six days and shared across pilots; your windows, airports and the bid
            pack&rsquo;s flights are used for that lookup and not stored. The answers are kept on
            your device for a few days.
          </p>
          <p className="mt-2">
            To show a layover city&rsquo;s weather, your browser asks Open-Meteo directly for that city&rsquo;s
            coordinates and the dates in question. Nothing about you is sent, though like any site your browser
            contacts, it sees your IP address. We don&rsquo;t store the results.
          </p>
          <p className="mt-2">
            If you tap the microphone to dictate an answer, the sound from your microphone is sent
            straight from your browser to AssemblyAI, a speech-to-text provider, which sends the words
            back as you speak. Along with it goes a list of words to listen for: pilot terms and the
            airports, base and aircraft in your bid pack &mdash; nothing about you. The sound never
            passes through our server and we don&rsquo;t record or store it; the only thing kept is the
            text that lands in your answer, like anything you type. AssemblyAI handles the audio under
            its own terms and data-retention policy. The microphone only listens while it&rsquo;s on,
            switches itself off after a quiet spell, and you can always type instead. If AssemblyAI
            can&rsquo;t be reached, your browser&rsquo;s own speech recognition is used, which may send
            the audio to your browser&rsquo;s maker (Apple or Google) under their terms.
          </p>
        </Section>

        <Section title="5. If you create an account">
          <p>Creating an account is optional. You need one for the Trade Board, Inbox, award-history reporting, sharing your ranking with the forecast, and keeping your data across devices (Section 2). If you create one, we store:</p>
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
          <p className="mt-3">
            The example offers shown with the sample bid pack are made up in your browser and marked as examples.
            No real pilot is behind them, nothing about them reaches our server, and they never appear with a pack
            you uploaded.
          </p>
        </Section>

        <Section title="7. Bid forecast and shared rankings">
          <p>
            If you enter your seniority number (on your Preferences page or at the start of the
            interview), Line Select uses it, the bid pack&rsquo;s list of seniority numbers, and your
            ranking of the lines to estimate your chance at each one. That estimate runs on our
            server, which receives numbers only &mdash; the lines&rsquo; numbers and features, the
            seniority list&rsquo;s bid order, seniority and pay-status values, and your ranking &mdash; not your bid
            pack file. Your seniority number is stored
            with your preferences: on your device, and on our server too if you have an account.
          </p>
          <p className="mt-3">
            If you&rsquo;re signed in, your ranking is also stored on our server by default so it can
            improve the forecast for other pilots bidding the same seat and month. It is kept under
            a one-way hash of your account, with your place in bid order and seniority number (numbers
            from the bid pack&rsquo;s own list) &mdash; never your name or email &mdash; and is never shown
            to any other pilot: the server uses it only to work out which lines are likely to be taken, and
            sends back nothing but probabilities. Alongside it we keep that month&rsquo;s standardized line features, which hold nothing about
            any pilot. You can stop sharing at any time with the checkbox on your results page, which removes
            your stored ranking and the forecast kept with it, and you can ask us to delete everything
            (Section 15).
          </p>
        </Section>

        <Section title="8. Your bidding-story answer">
          <p>
            Early in the adaptive interview, you can answer one open-ended question describing your
            whole bidding process in your own words. That answer is read by our AI provider (Section
            3) to build your profile, the same as any other interview answer, and is stored with your
            preferences the same way (on your device, and on our server too if you have an account).
          </p>
        </Section>

        <Section title="9. Award history, and how the Service learns from many pilots">
          <p>
            If you report what you actually held for a bid period, we store your seniority number,
            the base/aircraft/seat, the month, the outcome (line, reserve, or other), the held
            line&rsquo;s shape, which of your own ranked choices it was, and, if you check in after the month,
            how it flew compared with what you expected. Other pilots only ever
            see these as anonymous numbers. On our server the report is also tagged with a one-way
            hash of your account &mdash; never your name or email &mdash; so your own months build a
            private hold history that only you are shown, and so the forecast you were shown (if you
            share your ranking, Section 7) can be checked against what you really got.
          </p>
          <p className="mt-3">
            One exception, only if you say yes when you log an award: once at least five pilots in your
            base, aircraft and seat have agreed for that month, signed-in pilots see your seniority number
            beside the line you held (&ldquo;Held by seniority #N&rdquo;, marked as from pilots who shared).
            Your name and employee number are never stored or shown, but anyone with the seniority list can
            match that number to you. Everything else stays in group numbers, shown only once at least five
            pilots stand behind them. Your award also helps check the odds shown to other pilots for that
            month. The account hash is keyed with a secret held only on our server, so a copy of the database
            alone can&rsquo;t link a report to an account. You can withdraw one month or everything from your
            Logbook: it&rsquo;s deleted at once and leaves the learned numbers at their next rebuild.
          </p>
          <p className="mt-3">
            When you finish the interview, a numeric summary of it is stored: your
            base/aircraft/seat and month, whether you commute, a broad seniority band (top, middle,
            or bottom third), where each preference landed, how many questions it took, and which
            topics each question covered. It never contains your words &mdash; not your answers, not
            your bidding story &mdash; nor your seniority number, cities, or dates. If you&rsquo;re
            signed in it carries the same one-way account hash; as a guest it carries nothing. When
            you later move a slider the interview set, we record which preference changed, from what
            to what, and whether that value had been asked, read from your story, or assumed.
          </p>
          <p className="mt-3">
            The story-driven interview stores a similar summary: the same group details, how many
            questions and line-versus-line choices it took, which kinds of priorities you ended up with
            and how much each counted (for example &ldquo;commutes to base &mdash; strongest&rdquo;),
            your ratings of layover cities (the airport codes and how much you like each), and
            whether you marked each priority right, more, less or not mattering at the end. It still
            never contains your words, your seniority number or your dates.
          </p>
          <p className="mt-3">
            From these summaries, across many pilots and many months, the Service computes
            statistics: which questions pilots in a group answer almost the same way (so it can
            assume them, visibly, and let you change them instead of asking), where pilots differ
            (so it asks those well), the typical numbers in each group, and how accurate past
            forecasts were. These are counts and averages, not an AI language model, and none of
            it ever shows another pilot what you answered. Once at least ten pilots in a group have
            taken the story-driven interview and the averages pass our accuracy checks, those group averages
            (never any one pilot&rsquo;s) are given to the AI as hints about what to ask pilots like you; the AI
            is told never to treat them as facts about you. These summaries are kept for years, so the Service
            can learn across many months. The demo bid pack is never learned from.
          </p>
        </Section>

        <Section title="10. Free-text explanations for a ranking correction">
          <p>
            A reason you type for swapping two lines is read by our AI provider (Section 3) and saved with your
            preferences (Section 2). Separately, if you drag-correct a line&rsquo;s ranking and the Service asks why, and your answer
            doesn&rsquo;t map cleanly onto an existing preference, we store your verbatim answer
            together with your account so it can be reviewed later to improve the preference
            taxonomy. Please avoid including sensitive personal details (medical, family, or
            financial information) in these answers &mdash; they&rsquo;re not necessary for the
            Service to work, and while they&rsquo;re not shown to other pilots, they are retained
            longer-term for this review purpose. You can request deletion of these at any time
            (Section 15).
          </p>
        </Section>

        <Section title="11. Feedback you send us">
          <p>
            If you use the &ldquo;Send feedback&rdquo; option in the app, your message and the page you sent it
            from are stored on our server and normally emailed to us through our email provider (Resend), since the
            whole point is that it reaches us. If you&rsquo;re signed in, your
            name and email are attached to it so we can follow up; a guest submission carries no identifying
            information at all. Please avoid including sensitive personal details you wouldn&rsquo;t want stored
            this way &mdash; they&rsquo;re not necessary to report a bug or an idea.
          </p>
        </Section>

        <Section title="12. Technical and abuse-prevention data, and who hosts it">
          <p>
            To prevent abuse of the Service (and its underlying paid AI and data providers), we briefly record
            request counts and each day&rsquo;s spending on those providers, keyed to your account if you&rsquo;re
            signed in, or otherwise to a device cookie and your IP address. The device cookie holds a random ID
            with nothing about you in it, lasts up to 400 days, can&rsquo;t be read by page scripts, and lets pilots sharing one
            connection, such as a crew room&rsquo;s Wi-Fi, keep separate limits. These counters expire
            automatically, within about a day, and are used only to enforce limits &mdash; not for tracking or
            profiling. A paid AI reply may also be held for up to 15 minutes, so a dropped connection gets the same
            answer again rather than a second paid call.
          </p>
          <p className="mt-3">
            The Service runs on Vercel (hosting, including its request logs), Neon (database), Upstash (short-lived
            storage such as counters, caches and interview drafts), and Resend (email). They hold this data on our
            behalf.
          </p>
        </Section>

        <Section title="13. Usage analytics and error monitoring">
          <p>
            The Service uses PostHog to see which pages get used and to catch errors before a
            pilot has to report one themselves. This sends page-view and page-leave events and a small, fixed set
            of named usage events (for example, that a bid pack was confirmed, or that the
            interview was completed) &mdash; never the bid pack&rsquo;s contents, your interview
            answers, your preference weights, or any free text you&rsquo;ve written anywhere in the
            Service. If something crashes, the error and the page it happened on are sent the same
            way, and repeated failures are emailed to us. Like any service your browser contacts, PostHog sees your
            IP address. It also measures page speed &mdash; how quickly each page loads and responds to a tap
            &mdash; as timings only, so slow screens can be found and fixed. If you&rsquo;re signed in, these events are tied to your account id so we can tell
            how many distinct pilots hit an issue rather than how many times it happened to one
            pilot &mdash; never your name or email. We don&rsquo;t use this for advertising, and we
            don&rsquo;t run session recording or record what you click or type.
          </p>
        </Section>

        <Section title="14. What we don’t do">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>We don&rsquo;t sell or rent your personal information to anyone.</li>
            <li>
              We don&rsquo;t run advertising pixels or third-party marketing scripts on the
              Service. We do run one analytics/error-monitoring tool (Section 13) &mdash; see there
              for exactly what it collects.
            </li>
            <li>
              We don&rsquo;t read, extract, or store another pilot&rsquo;s name or employee number from your
              bid pack. From its seniority list and vacation schedule we use only the numbers listed in Section 1.
            </li>
            <li>
              We don&rsquo;t use your bid pack, interview answers, or account data to train any AI
              language model. The Service does compute group statistics from numeric interview and
              award summaries (Section 9) &mdash; never from your words.
            </li>
          </ul>
        </Section>

        <Section title="15. Your choices and rights">
          <p>
            &ldquo;Start over&rdquo; on your results page removes your bid pack and saved preferences, from your
            device and, if you&rsquo;re signed in, from our server. As a guest you can do the same by clearing your
            browser&rsquo;s site data.
          </p>
          <p className="mt-3">
            You can delete your account at any time by contacting us at the address below. This removes your login
            and sessions, your stored bid pack and saved preferences, and your Trade Board offers and responses.
            Earlier versions of your preferences and any interview draft expire on their own (Section 2). Some
            things remain unless you ask us to remove them: award-history reports, interview summaries and stored
            forecasts stay under the one-way hash in Section 9, which can no longer be matched to anyone once your
            account is gone; feedback (Section 11) keeps the name and email it was sent with; and explanations
            (Section 10) stay with your old account ID. Ask and we&rsquo;ll delete all of these along with the
            account.
          </p>
          <p className="mt-3">
            Regardless of where you live, you may contact us to ask what account-linked data we
            hold about you, request its deletion, or ask us to stop processing it &mdash; we&rsquo;ll
            honor reasonable requests even though the Service, given its size, does not currently
            meet the legal thresholds that make certain state privacy laws (like California&rsquo;s
            CCPA/CPRA) mandatory.
          </p>
        </Section>

        <Section title="16. Children’s privacy">
          <p>
            The Service is intended for working airline pilots and is not directed at, or intended
            for use by, anyone under 18. We don&rsquo;t knowingly collect information from anyone
            under 18.
          </p>
        </Section>

        <Section title="17. Security">
          <p>
            We use industry-standard measures appropriate to the data we actually hold &mdash;
            encrypted connections, salted password hashing, httpOnly session cookies, and rate
            limiting on every route that touches a paid third-party service or account creation.
            No method of transmission or storage is perfectly secure, and we can&rsquo;t guarantee
            absolute security.
          </p>
        </Section>

        <Section title="18. Changes to this policy">
          <p>
            We may update this Privacy Policy as the Service changes. We&rsquo;ll update the
            &ldquo;Last updated&rdquo; date above whenever we do, and for a material change
            we&rsquo;ll provide reasonably prominent notice.
          </p>
        </Section>

        <Section title="19. Contact">
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
