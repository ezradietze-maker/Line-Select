import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_VIPS_LINES,
  NO_TO_EVERYTHING,
  buildVipsBidFields,
  getVipsAnswers,
  getVipsEmployeeNumber,
  normalizeEmployeeNumber,
  setVipsAnswers,
  setVipsEmployeeNumber,
  vipsBidInputUrl,
} from "@/lib/vips-bid";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

function fieldsOf(result: ReturnType<typeof buildVipsBidFields>) {
  if (!result.ok) throw new Error(result.reason);
  return result.fields;
}

describe("buildVipsBidFields", () => {
  it("lays the bid out the way VIPS reads it: questions, lines from n101, then submit", () => {
    const fields = fieldsOf(
      buildVipsBidFields({
        lineNumbers: ["2182", "2306", "2268"],
        answers: { waiveBufferRecurrent: true, waiveBufferPhaseIn: false, waive1in10: true, protectMinDays: false },
      })
    );
    expect(fields).toEqual([
      ["n003", "Yes"],
      ["n004", "No"],
      ["n005", "Yes"],
      ["n006", "No"],
      ["n007", "Unasked"],
      ["n008", "Unasked"],
      ["n009", "Unasked"],
      ["n101", "2182"],
      ["n102", "2306"],
      ["n103", "2268"],
      ["n999", "   Submit   "],
    ]);
  });

  it("puts the catch-all choices after the pilot's own lines, in the order given", () => {
    const result = buildVipsBidFields({
      lineNumbers: ["1001", "1002"],
      anyLines: ["regular", "reserve", "secondary"],
      answers: NO_TO_EVERYTHING,
    });
    expect(result.ok && result.lines).toEqual(["1001", "1002", "9950", "9954", "9952"]);
  });

  it("drops a repeated line instead of bidding it twice", () => {
    const result = buildVipsBidFields({ lineNumbers: ["1001", " 1002 ", "1001", "1002"], answers: NO_TO_EVERYTHING });
    expect(result.ok && result.lines).toEqual(["1001", "1002"]);
  });

  it("refuses an empty bid, a non-number, and more lines than VIPS has slots for", () => {
    expect(buildVipsBidFields({ lineNumbers: [], answers: NO_TO_EVERYTHING }).ok).toBe(false);
    expect(buildVipsBidFields({ lineNumbers: ["1001", "10A2"], answers: NO_TO_EVERYTHING }).ok).toBe(false);
    const tooMany = Array.from({ length: MAX_VIPS_LINES + 1 }, (_, i) => String(1000 + i));
    expect(buildVipsBidFields({ lineNumbers: tooMany, answers: NO_TO_EVERYTHING }).ok).toBe(false);
    const result = buildVipsBidFields({ lineNumbers: tooMany.slice(0, MAX_VIPS_LINES), answers: NO_TO_EVERYTHING });
    expect(result.ok && result.fields.at(-2)).toEqual(["n998", String(1000 + MAX_VIPS_LINES - 1)]);
  });
});

describe("employee number", () => {
  it("accepts up to seven digits and nothing else", () => {
    expect(normalizeEmployeeNumber(" 564936 ")).toBe("564936");
    expect(normalizeEmployeeNumber("")).toBeNull();
    expect(normalizeEmployeeNumber("0")).toBeNull();
    expect(normalizeEmployeeNumber("12345678")).toBeNull();
    expect(normalizeEmployeeNumber("56 4936")).toBeNull();
    expect(normalizeEmployeeNumber("abc")).toBeNull();
  });

  it("goes into the bid page's address", () => {
    expect(vipsBidInputUrl("564936")).toBe("https://pilot.fedex.com/vips-bin/vipscgi?webmtb?564936?input");
  });
});

describe("storage", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
  });

  it("keeps the employee number in this browser until cleared", () => {
    expect(getVipsEmployeeNumber()).toBeNull();
    setVipsEmployeeNumber("564936");
    expect(getVipsEmployeeNumber()).toBe("564936");
    setVipsEmployeeNumber(null);
    expect(getVipsEmployeeNumber()).toBeNull();
  });

  it("answers No to everything until the pilot has answered, then remembers", () => {
    expect(getVipsAnswers()).toEqual(NO_TO_EVERYTHING);
    const answers = { waiveBufferRecurrent: false, waiveBufferPhaseIn: true, waive1in10: false, protectMinDays: true };
    setVipsAnswers(answers);
    expect(getVipsAnswers()).toEqual(answers);
  });

  it("treats anything but a stored true as No", () => {
    window.localStorage.setItem("line-select:vips-answers:v1", '{"waive1in10":"yes","protectMinDays":true}');
    expect(getVipsAnswers()).toEqual({ ...NO_TO_EVERYTHING, protectMinDays: true });
  });
});
