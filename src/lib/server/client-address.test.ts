import { describe, expect, it } from "vitest";
import { addressGroup, clientIp } from "@/lib/server/rate-limit";

const from = (headers: Record<string, string>) => clientIp(new Request("https://example.com", { headers }));

describe("the address a request is counted under", () => {
  it("keeps an IPv4 address whole", () => {
    expect(from({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" })).toBe("198.51.100.4");
    expect(from({ "x-real-ip": "203.0.113.9" })).toBe("203.0.113.9");
    expect(addressGroup(" 203.0.113.9:443 ")).toBe("203.0.113.9");
    expect(from({})).toBe("unknown");
  });

  it("cuts IPv6 to its /64: every address one connection can use is one sender", () => {
    const one = ["2001:db8:1234:5678::1", "2001:db8:1234:5678::ffff", "2001:0DB8:1234:5678:aaaa:bbbb:cccc:dddd", "[2001:db8:1234:5678::9]:443", "2001:db8:1234:5678::7%eth0"];
    expect(new Set(one.map(addressGroup))).toEqual(new Set(["2001:db8:1234:5678::/64"]));
    expect(from({ "x-forwarded-for": "2001:db8:1234:5678::42, 10.0.0.1" })).toBe("2001:db8:1234:5678::/64");
  });

  it("tells one /64 from the next", () => {
    expect(addressGroup("2001:db8:1234:5678::1")).not.toBe(addressGroup("2001:db8:1234:5679::1"));
    expect(addressGroup("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(addressGroup("::1")).toBe("0:0:0:0::/64");
  });

  it("reads an IPv4 address written as IPv6 as the IPv4 address", () => {
    expect(addressGroup("::ffff:198.51.100.4")).toBe("198.51.100.4");
    expect(addressGroup("0:0:0:0:0:ffff:198.51.100.4")).toBe("198.51.100.4");
    expect(addressGroup("::FFFF:198.51.100.4")).toBe("198.51.100.4");
    expect(from({ "x-forwarded-for": "::ffff:198.51.100.4" })).toBe(from({ "x-forwarded-for": "198.51.100.4" }));
  });

  it("leaves anything that isn't an address as it came, so it still counts as one sender", () => {
    expect(addressGroup("not-an-ip")).toBe("not-an-ip");
    expect(addressGroup("1:2:3")).toBe("1:2:3");
  });
});
