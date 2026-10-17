import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type PacketDraft, applyPending, listPending, writePacket } from "../../plugins/interstage/extension/steering";
import { loadMission, saveMission } from "../../plugins/interstage/extension/state";
import type { SteeringSignal } from "../../plugins/interstage/extension/contracts";
import { CLOCK, clock, mission, tempDir } from "./support";

async function missionDir() {
  const dir = await tempDir();
  await saveMission(dir, mission());
  return dir;
}

const draft = (signal: SteeringSignal): PacketDraft => ({ signal, from: "main", payload: { n: signal } });

describe("steering packets", () => {
  test("seq and at are stamped by the extension and seq advances in the mission record", async () => {
    const dir = await missionDir();
    const first = await writePacket(dir, draft("redirect"), clock);
    const second = await writePacket(dir, draft("decision"), () => "2031-02-03T00:00:00.000Z");
    expect([first.seq, second.seq]).toEqual([1, 2]);
    expect(first).toMatchObject({ version: 1, at: CLOCK, signal: "redirect", from: "main" });
    expect(second.at).toBe("2031-02-03T00:00:00.000Z");
    expect((await readdir(join(dir, "steering"))).sort()).toEqual(["0001-redirect.json", "0002-decision.json"]);
    expect((await loadMission(dir))?.nextSeq).toBe(3);
  });

  test("a model-supplied seq or time in the draft cannot override the stamped values", async () => {
    const dir = await missionDir();
    const forged = { ...draft("error"), seq: 99, at: "1999-01-01" } as PacketDraft;
    const packet = await writePacket(dir, forged, clock);
    expect(packet.seq).toBe(1);
    expect(packet.at).toBe(CLOCK);
  });

  test("concurrent writers get distinct sequence numbers", async () => {
    const dir = await missionDir();
    const packets = await Promise.all(Array.from({ length: 10 }, () => writePacket(dir, draft("redirect"), clock)));
    expect(new Set(packets.map(p => p.seq)).size).toBe(10);
    expect((await listPending(dir)).map(p => p.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test("pending packets list interrupt and pause first, each group in seq order", async () => {
    const dir = await missionDir();
    for (const signal of ["redirect", "pause", "decision", "interrupt", "resume"] as const) await writePacket(dir, draft(signal), clock);
    expect((await listPending(dir)).map(p => `${p.seq}-${p.signal}`)).toEqual(["2-pause", "4-interrupt", "1-redirect", "3-decision", "5-resume"]);
  });

  test("applying moves packets to applied/ with a result and returns them in delivery order", async () => {
    const dir = await missionDir();
    await writePacket(dir, draft("redirect"), clock);
    await writePacket(dir, draft("interrupt"), clock);
    const delivered = await applyPending(dir, () => "2032-01-01T00:00:00.000Z");
    expect(delivered.map(p => p.signal)).toEqual(["interrupt", "redirect"]);
    expect(await listPending(dir)).toEqual([]);
    const applied = JSON.parse(await readFile(join(dir, "steering", "applied", "0002-interrupt.json"), "utf8"));
    expect(applied).toMatchObject({ seq: 2, result: "delivered to flight", appliedAt: "2032-01-01T00:00:00.000Z" });
    expect((await readdir(join(dir, "steering"))).sort()).toEqual(["applied"]);
    expect(await applyPending(dir, clock)).toEqual([]);
  });

  test("listing with no steering directory is empty", async () => {
    expect(await listPending(await tempDir())).toEqual([]);
  });
});
