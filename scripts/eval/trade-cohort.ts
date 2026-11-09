import { readFileSync, readdirSync, statSync } from "node:fs";
import type { PilotModel } from "@/types/pilot-model";

/** Simulated pilots for the trade matching's evaluations: the interview personas in `.cache/eval`, varied. */

const HOMES = ["SAN", "SEA", "DFW", "ATL", "BOS", "PHX", "DEN", "MCO", "MSP", "LAX"];
export const PERSONAS = ["anc-777fo-sea-commuter", "expilot", "ind-local-family", "mem-757-bodyclock", "mem-a300-captain-dates", "mem-md11-paymax"];

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function latestPersona(name: string): PilotModel {
  const dir = ".cache/eval";
  const files = readdirSync(dir).filter((f) => f.startsWith(`brain-${name}-claude-`));
  const newest = files.sort((a, b) => statSync(`${dir}/${b}`).mtimeMs - statSync(`${dir}/${a}`).mtimeMs)[0];
  return (JSON.parse(readFileSync(`${dir}/${newest}`, "utf8")) as { model: PilotModel }).model;
}

/** A persona with its priorities' weights varied and, half the time, a different home. Date requests belong to one pilot's month, so they go. */
export function varied(base: PilotModel, packBase: string, rand: () => number): PilotModel {
  const gaussian = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const commute = rand() < 0.5;
  const home = commute ? { airports: [HOMES[Math.floor(rand() * HOMES.length)]], commuter: true } : { airports: [packBase], commuter: false };
  return {
    ...base,
    home,
    criteria: base.criteria.filter((c) => c.metric !== "requestedDatesWorked").map((c) => ({ ...c, weight: c.weight * Math.exp(0.5 * gaussian()) })),
  };
}

