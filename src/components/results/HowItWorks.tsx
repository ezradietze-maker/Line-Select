export function HowItWorksContent() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-ink-muted">
      <p>
        Line Select reads your own uploaded bid pack PDF and compares each
        line&rsquo;s real attributes &mdash; days off, trip length,
        departures, international mix, layover cities, report-time lean,
        credit hours, deadhead legs, and layover hotel quality &mdash;
        against the targets implied by your answers, then blends them into a
        single 0-100 score weighted by how strongly you felt about each one.
      </p>
      <p>
        Several questions let you pin an exact number instead of just leaning
        a slider &mdash; nights home, departures, and (in the deeper round)
        credit hours &mdash; and that exact target is used directly instead
        of the rough midpoint a slider alone implies.
      </p>
      <p>
        <strong className="text-ink">
          This is a preference-matching tool, not an awards predictor.
        </strong>{" "}
        It has no idea what your seniority is, what other pilots are
        bidding, or what you&rsquo;ll actually be awarded. It only tells you
        which lines, on paper, look closest to what you said you want.
      </p>
      <p>
        Your bid pack and preferences are parsed and scored entirely on this
        device &mdash; they&rsquo;re never uploaded anywhere. Creating an
        account and posting to the Trade Board are the only things that go to
        a server, since a trade offer has to be visible to a different pilot
        on a different device to be useful.
      </p>
    </div>
  );
}
