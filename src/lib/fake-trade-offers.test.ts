import { describe, expect, it } from "vitest";
import { generateFakeOffer, isSamplePack, withExampleOffer } from "@/lib/fake-trade-offers";
import { computeInboxSections } from "@/lib/inbox";
import { packIdFor } from "@/lib/pack-id";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { BidPack } from "@/types/bidpack";
import type { TradeOffer } from "@/types/trade";

const realPack: BidPack = { ...SAMPLE_BID_PACK, id: packIdFor({ base: "MEM", aircraft: "B767", seat: SAMPLE_BID_PACK.seat, month: "DEC26" }) };
const example = generateFakeOffer(SAMPLE_BID_PACK)!;
const realOffer = (over: Partial<TradeOffer> = {}): TradeOffer => ({ ...example, id: "real-1", offeringUserId: "pilot-2", offeringDisplayName: "A Pilot", isDemo: undefined, ...over });

describe("example trade offers", () => {
  it("are made only for the sample pack, even when a real pack has the same trips", () => {
    expect(isSamplePack(SAMPLE_BID_PACK)).toBe(true);
    expect(isSamplePack(realPack)).toBe(false);
    expect(example.isDemo).toBe(true);
    for (let i = 0; i < 25; i++) expect(generateFakeOffer(realPack, "123")).toBeNull();
  });

  it("join the sample pack's board while it's otherwise empty", () => {
    expect(withExampleOffer(example, [], SAMPLE_BID_PACK, "me")).toEqual([example]);
  });

  it("never reach a real pack's board, even in the moment an old example is still held", () => {
    expect(withExampleOffer(example, [], realPack, "me")).toEqual([]);
    const real = realOffer();
    expect(withExampleOffer(example, [real], realPack, "me")).toEqual([real]);
    expect(withExampleOffer(example, [], null, "me")).toEqual([]);
  });

  it("step aside once a real pilot has an open offer", () => {
    const real = realOffer();
    expect(withExampleOffer(example, [real], SAMPLE_BID_PACK, "me")).toEqual([real]);
  });

  it("can't reach the Inbox or its badge, which count only the board's real offers", () => {
    const mine = realOffer({ id: "mine", offeringUserId: "me", status: "open" });
    const shown = withExampleOffer(example, [mine], realPack, "me");
    const { needsResponse, directInterest, accepted } = computeInboxSections(shown, "me");
    expect([...needsResponse, ...directInterest, ...accepted].some((o) => o.isDemo)).toBe(false);
  });
});
