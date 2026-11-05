import { describe, expect, it } from "vitest";
import type { TradeOffer } from "@/types/trade";
import { ANOTHER_PILOT, offerForViewer } from "./trade-view";

const offer = { id: "t1", offeringUserId: "alice", responderUserId: "bob", offeringDisplayName: "Alice", responderDisplayName: "Bob" } as unknown as TradeOffer;

describe("offerForViewer", () => {
  it("keeps the viewer's own id and hides everyone else's", () => {
    expect(offerForViewer(offer, "alice")).toMatchObject({ offeringUserId: "alice", responderUserId: ANOTHER_PILOT, responderDisplayName: "Bob" });
    expect(offerForViewer(offer, "bob")).toMatchObject({ offeringUserId: ANOTHER_PILOT, responderUserId: "bob" });
    expect(offerForViewer(offer, "carol")).toMatchObject({ offeringUserId: ANOTHER_PILOT, responderUserId: ANOTHER_PILOT });
  });

  it("leaves an offer nobody has answered without a responder", () => {
    expect(offerForViewer({ ...offer, responderUserId: null }, "carol").responderUserId).toBeNull();
  });
});
