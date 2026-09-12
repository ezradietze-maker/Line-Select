import Link from "next/link";
import { Heading } from "@/components/ui/Heading";

const LAST_UPDATED = "September 11, 2026";

/**
 * A real Terms of Service — not boilerplate copy-pasted from a generator.
 * Grounded in what this app actually does and actually stores (verified
 * against the real code, not assumed) as of the date above. Three bracketed
 * placeholders below need the operator's own facts filled in before this is
 * relied on: the operating entity/individual, the governing-law state, and
 * the legal contact address. This document is not a substitute for review
 * by a licensed attorney in the relevant jurisdiction.
 */
export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl animate-fade-in">
      <Heading as="h1" className="text-2xl text-ink sm:text-3xl">
        Terms of Service
      </Heading>
      <p className="mt-1.5 text-xs text-ink-faint">Last updated {LAST_UPDATED}</p>

      <div className="mt-6 space-y-8 text-sm leading-relaxed text-ink-muted">
        <Section title="1. Who and what this covers">
          <p>
            These Terms of Service (&ldquo;Terms&rdquo;) govern your use of Line Select (the
            &ldquo;Service&rdquo;), operated by{" "}
            <span className="font-medium text-ink">[OPERATOR NAME/ENTITY]</span> (&ldquo;we,&rdquo;
            &ldquo;us,&rdquo; or &ldquo;the Company&rdquo;). By creating an account, uploading a
            bid pack, or otherwise using the Service, you agree to be bound by these Terms and by
            our{" "}
            <Link href="/privacy" className="underline decoration-dotted underline-offset-4 hover:text-ink">
              Privacy Policy
            </Link>
            , which is incorporated here by reference. If you do not agree, do not use the
            Service.
          </p>
          <p className="mt-3">
            You must be at least 18 years old to use the Service. By using it, you represent that
            you meet that requirement.
          </p>
        </Section>

        <Section title="2. Not affiliated with FedEx">
          <p>
            Line Select is an independent, unofficial tool built for FedEx pilots. It is not
            affiliated with, endorsed by, sponsored by, or connected in any way to Federal Express
            Corporation, FedEx Express, or any of their affiliates (collectively,
            &ldquo;FedEx&rdquo;). &ldquo;FedEx&rdquo; and any related marks are the property of
            their respective owners and are used on this site solely to accurately describe the
            pilots this Service is built for &mdash; not to claim any affiliation, sponsorship, or
            endorsement. The Service has no access to, integration with, or ability to submit
            anything to any FedEx system. Nothing you do here is transmitted to FedEx, and nothing
            here affects your actual bid, schedule, or employment in any way unless you separately
            and manually act on it through FedEx&rsquo;s own official systems.
          </p>
        </Section>

        <Section title="3. What the Service does">
          <p>
            The Service lets you upload a bid pack PDF, answers questions about your scheduling
            preferences, and in return generates a ranking, explanatory scoring, and related
            planning content (including the Strategies board, Trade Board, Inbox, and Hotel
            Ratings features) intended solely to help you think through your own bid. Some content
            is generated with the help of a third-party AI system (see Section 10) and some
            reflects patterns the Service has detected in your own uploaded data, not information
            from FedEx or any official source.
          </p>
        </Section>

        <Section title="4. This is a planning aid, not a verified or professional source — read this section before you bid">
          <p className="font-medium text-ink">
            The single most important thing in these Terms: nothing the Service tells you is a
            substitute for your own bid pack, your own PBS/VIPS system, or FedEx&rsquo;s own
            official records. You are solely responsible for independently verifying any
            information from the Service &mdash; line numbers, credit, days off, TAFB, trip
            content, feasibility estimates, or anything else &mdash; against your own official
            bid pack and FedEx&rsquo;s own systems before you rely on it for any real bidding,
            scheduling, trading, or career decision.
          </p>
          <p className="mt-3">
            The Service&rsquo;s PDF parser is automated and, while tested against real bid packs,
            can make mistakes on a bid pack it has not seen before &mdash; a different base, a
            different format, or a printing quirk can all produce a wrong number. Any line the
            Service could not fully verify is labeled &ldquo;estimated&rdquo; in the interface,
            but the absence of that label is not a guarantee of accuracy either.
          </p>
          <p className="mt-3">
            The Satisfaction Index, Strategies board (including every feasibility tier and any
            content labeled &ldquo;pending contract verification&rdquo;), and any AI-generated
            explanation or review summary are estimates and pattern-matches, not professional,
            legal, financial, or career advice, and not a prediction of what you will actually be
            awarded. Real seniority-based award outcomes depend on factors &mdash; other
            pilots&rsquo; bids, contract and PBS rules the Service does not have access to,
            scheduling decisions made after bidding closes &mdash; that the Service cannot see or
            verify. Every strategy is intended to work within applicable FAA duty and rest rules
            (including 14 C.F.R. Part 117); the Service does not compute or verify duty or rest
            legality itself, and you remain solely responsible for ensuring anything you actually
            bid or fly complies with those rules and with your collective bargaining agreement.
          </p>
        </Section>

        <Section title="5. Your account">
          <p>
            You&rsquo;re responsible for keeping your login credentials confidential and for all
            activity under your account. Tell us promptly if you believe your account has been
            compromised. You agree to provide accurate information when creating an account and to
            use your own real identity &mdash; the Service is built for individual pilots, not
            shared or third-party accounts.
          </p>
        </Section>

        <Section title="6. Your bid pack and the content you provide">
          <p>
            You retain ownership of the bid pack PDF you upload and of any preferences, free-text
            answers, or other content you provide. By uploading a bid pack, you represent that you
            are authorized to possess and use that document and to have it processed by the
            Service for the purpose of generating your own results &mdash; you are responsible for
            complying with any policy your employer has regarding your own bid pack. You grant us
            a limited license to process that content solely to provide the Service to you (see
            the{" "}
            <Link href="/privacy" className="underline decoration-dotted underline-offset-4 hover:text-ink">
              Privacy Policy
            </Link>{" "}
            for exactly what is and isn&rsquo;t retained).
          </p>
          <p className="mt-3">
            Anything you post publicly through the Service &mdash; a Trade Board offer, a note on
            an offer, a display name &mdash; is visible to other users of the Service and you are
            solely responsible for its content. Don&rsquo;t post anyone else&rsquo;s personal
            information, and don&rsquo;t post anything false, harassing, or unlawful.
          </p>
        </Section>

        <Section title="7. Acceptable use">
          <p>You agree not to:</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>Upload a bid pack or any document you are not authorized to possess or use;</li>
            <li>
              Attempt to access, scrape, or reverse-engineer the Service beyond normal use, or
              circumvent any rate limit, access control, or security measure;
            </li>
            <li>Use the Service to impersonate another person or misrepresent your identity;</li>
            <li>
              Post false, defamatory, or fraudulent information on the Trade Board or anywhere else
              on the Service, or use it to arrange anything unlawful;
            </li>
            <li>
              Use the Service in any way that could disable, overburden, or impair it, including
              automated bulk requests;
            </li>
            <li>
              Use the Service to violate any law or any agreement you have with your employer or
              union.
            </li>
          </ul>
          <p className="mt-3">
            We may suspend or terminate your access for violating this section, at our discretion,
            with or without notice.
          </p>
        </Section>

        <Section title="8. Trade Board is a coordination tool only — not a real trade">
          <p>
            The Trade Board and Inbox let pilots find and communicate with each other about
            trading trips. Agreeing to something through the Service is <strong>not</strong> a
            real, binding, or legal schedule trade. Any actual trade has to go through
            FedEx&rsquo;s own official scheduling process after bidding closes, where rest rules,
            qualifications, and currency are actually checked &mdash; the Service has no way to
            verify any of that and no visibility into whether a proposed trade is even legal or
            feasible under your contract. We are not a party to any arrangement between pilots
            made through the Service and have no obligation or ability to enforce it, mediate it,
            or guarantee any pilot&rsquo;s identity, seniority, or qualifications.
          </p>
        </Section>

        <Section title="9. Award-history and seniority data is self-reported">
          <p>
            Any seniority, award-outcome, or &ldquo;what pilots near you held&rdquo; data shown by
            the Service is anonymously self-reported by other users, not verified against FedEx
            records, and may be incomplete, outdated, or inaccurate. It is shown as a rough,
            informal signal only and should never be your basis for a real bidding decision.
          </p>
        </Section>

        <Section title="10. Third-party services">
          <p>
            The Service relies on third-party providers to function, including an AI processing
            provider (to power the adaptive interview and summarize hotel reviews), a mapping/places
            data provider (to look up hotel information), and cloud hosting and data-storage
            infrastructure. These providers process limited data on our behalf as described in the{" "}
            <Link href="/privacy" className="underline decoration-dotted underline-offset-4 hover:text-ink">
              Privacy Policy
            </Link>
            . We do not control, and are not responsible for, the availability, accuracy, or
            content of any third-party service, including hotel ratings, reviews, or amenity
            information pulled from a mapping provider, which reflects that provider&rsquo;s own
            data and is not verified by us.
          </p>
        </Section>

        <Section title="11. Intellectual property">
          <p>
            The Service&rsquo;s software, design, and original content are owned by us or our
            licensors and protected by intellectual property law. Except for your own content, you
            may not copy, modify, distribute, sell, or lease any part of the Service without our
            written permission. If you believe material on the Service infringes your copyright,
            contact us at the address in Section 17 with enough detail to identify the material and
            your rights in it.
          </p>
        </Section>

        <Section title="12. Disclaimer of warranties">
          <p className="font-medium text-ink">
            THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE,&rdquo; WITHOUT
            WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING WITHOUT
            LIMITATION ANY IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
            PURPOSE, TITLE, OR NON-INFRINGEMENT, AND ANY WARRANTY THAT THE SERVICE, ITS RESULTS,
            OR ANY AI-GENERATED CONTENT WILL BE ACCURATE, RELIABLE, UNINTERRUPTED, ERROR-FREE, OR
            WILL MEET YOUR REQUIREMENTS. NO ADVICE OR INFORMATION, ORAL OR WRITTEN, OBTAINED FROM
            US OR THROUGH THE SERVICE WILL CREATE ANY WARRANTY NOT EXPRESSLY STATED IN THESE
            TERMS.
          </p>
          <p className="mt-3">
            Some jurisdictions do not allow the exclusion of certain warranties, so some of the
            above exclusions may not apply to you.
          </p>
        </Section>

        <Section title="13. Limitation of liability">
          <p className="font-medium text-ink">
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE AND OUR OFFICERS, EMPLOYEES, AND AGENTS
            WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE
            DAMAGES, OR ANY LOSS OF PROFITS, DATA, GOODWILL, OR OTHER INTANGIBLE LOSSES, ARISING
            OUT OF OR RELATED TO YOUR USE OF OR INABILITY TO USE THE SERVICE, ANY DECISION MADE OR
            ACTION TAKEN IN RELIANCE ON THE SERVICE (INCLUDING ANY BID, TRADE, OR SCHEDULING
            DECISION), OR ANY CONDUCT OF ANY OTHER USER, EVEN IF WE HAVE BEEN ADVISED OF THE
            POSSIBILITY OF SUCH DAMAGES.
          </p>
          <p className="mt-3 font-medium text-ink">
            OUR TOTAL AGGREGATE LIABILITY FOR ANY CLAIM ARISING OUT OF OR RELATING TO THESE TERMS
            OR THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE TOTAL AMOUNT YOU PAID US, IF
            ANY, IN THE TWELVE MONTHS BEFORE THE CLAIM AROSE, OR (B) FIFTY U.S. DOLLARS ($50).
          </p>
          <p className="mt-3">
            This limitation does not apply to liability that cannot be limited under applicable
            law (for example, liability for our own fraud or for death or personal injury caused
            by our gross negligence, where applicable law prohibits limiting it). Some
            jurisdictions do not allow the exclusion or limitation of certain damages, so some of
            the above may not apply to you.
          </p>
        </Section>

        <Section title="14. Indemnification">
          <p>
            You agree to indemnify and hold us harmless from any claim, loss, liability, or expense
            (including reasonable attorneys&rsquo; fees) arising from: your violation of these
            Terms; your use of the Service; your bid pack or other content you upload or post; any
            dispute between you and another pilot arising from the Trade Board or Inbox; or your
            violation of any law or third-party right, including any employer policy governing your
            bid pack.
          </p>
        </Section>

        <Section title="15. Termination">
          <p>
            You may stop using the Service and delete your account at any time. We may suspend or
            terminate your access at our discretion, including for violating these Terms, without
            liability to you. Sections that by their nature should survive termination
            (including Sections 4, 6, 8&ndash;14, and 16) will survive.
          </p>
        </Section>

        <Section title="16. Dispute resolution, arbitration, and governing law">
          <p>
            These Terms are governed by the laws of the State of{" "}
            <span className="font-medium text-ink">[GOVERNING LAW STATE]</span>, without regard to
            its conflict-of-laws principles.
          </p>
          <p className="mt-3">
            <strong className="font-medium text-ink">Agreement to arbitrate.</strong> You and we
            agree that any dispute, claim, or controversy arising out of or relating to these
            Terms or the Service will be resolved by binding individual arbitration, rather than
            in court, except that either party may bring an individual claim in small-claims court
            if it qualifies. This means you and we each waive the right to a jury trial and the
            right to participate in a class action, class arbitration, or representative
            proceeding.
          </p>
          <p className="mt-3">
            <strong className="font-medium text-ink">Opt-out.</strong> You may opt out of this
            arbitration agreement by sending written notice to the address in Section 17 within 30
            days of first agreeing to these Terms; if you opt out, disputes will instead be
            resolved in the state or federal courts located in{" "}
            <span className="font-medium text-ink">[GOVERNING LAW STATE]</span>, and you consent to
            personal jurisdiction there.
          </p>
        </Section>

        <Section title="17. Changes to these Terms">
          <p>
            We may update these Terms from time to time. If we make a material change, we&rsquo;ll
            update the &ldquo;Last updated&rdquo; date above and, where appropriate, provide
            additional notice. Continuing to use the Service after a change takes effect means you
            accept the updated Terms.
          </p>
        </Section>

        <Section title="18. Contact">
          <p>
            Questions about these Terms can be sent to{" "}
            <a
              href="mailto:legal@lineselect.app"
              className="underline decoration-dotted underline-offset-4 hover:text-ink"
            >
              legal@lineselect.app
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
