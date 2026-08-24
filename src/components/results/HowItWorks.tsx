export function HowItWorksContent() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-ink-muted">
      <p>
        Line Select compares each line&rsquo;s real attributes &mdash; days
        off, average trip length, international share, report-time lean,
        deadhead legs, and credit hours &mdash; against the targets implied
        by your answers, then blends them into a single 0-100 score weighted
        by how strongly you felt about each one.
      </p>
      <p>
        In the deeper interview round, you can also type in an exact target
        &mdash; like your ideal number of days off &mdash; which is used
        directly instead of the rough midpoint a slider alone implies.
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
        All schedule data shown here is sample data for this prototype
        &mdash; not a live or real FedEx bid pack. Account sign-in is a local
        demo only: your login and preferences live in this browser, not on a
        server.
      </p>
    </div>
  );
}
