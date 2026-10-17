// Steering packets: `steering/<seq>-<signal>.json`. `seq` and `at` are stamped here, never by a model.

import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SteeringPacket, SteeringSignal } from "./contracts";
import { loadMission, readJson, saveMission, withMissionLock, writeJson } from "./state";

export type AppliedPacket = SteeringPacket & { appliedAt: string; result: string };

export interface PacketDraft {
  signal: SteeringSignal;
  from: string;
  payload: Record<string, unknown>;
  instructions?: SteeringPacket["instructions"];
  context?: SteeringPacket["context"];
  evidence?: SteeringPacket["evidence"];
}

const URGENT: Record<SteeringSignal, boolean> = {
  interrupt: true,
  pause: true,
  redirect: false,
  resume: false,
  reprioritize: false,
  decision: false,
  error: false,
  complete: false,
};

function packetName(packet: Pick<SteeringPacket, "seq" | "signal">): string {
  return `${String(packet.seq).padStart(4, "0")}-${packet.signal}.json`;
}

/** Take the next sequence number from the mission record and write the packet. Returns the stored packet. */
export async function writePacket(missionDir: string, draft: PacketDraft, now: () => string): Promise<SteeringPacket> {
  return withMissionLock(missionDir, async () => {
    const mission = await loadMission(missionDir);
    if (mission === undefined) throw new Error(`mission.json is missing in ${missionDir}`);
    // Spread first: a draft carrying its own seq or at (for example from a model) cannot override these.
    const packet: SteeringPacket = { ...draft, version: 1, seq: mission.nextSeq, at: now() };
    await writeJson(join(missionDir, "steering", packetName(packet)), packet);
    await saveMission(missionDir, { ...mission, nextSeq: mission.nextSeq + 1 });
    return packet;
  });
}

/** Pending packets: interrupt and pause first, each group in `seq` order. */
export async function listPending(missionDir: string): Promise<SteeringPacket[]> {
  let names: string[];
  try {
    names = await readdir(join(missionDir, "steering"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const packets: SteeringPacket[] = [];
  for (const name of names.filter(file => /^\d+-[a-z]+\.json$/.test(file))) {
    const packet = await readJson<SteeringPacket>(join(missionDir, "steering", name));
    if (packet !== undefined) packets.push(packet);
  }
  return packets.sort((a, b) => Number(URGENT[b.signal]) - Number(URGENT[a.signal]) || a.seq - b.seq);
}

/** Return the pending packets in delivery order and move each to `steering/applied/` with a result and timestamp. */
export async function applyPending(missionDir: string, now: () => string, result = "delivered to flight"): Promise<SteeringPacket[]> {
  return withMissionLock(missionDir, async () => {
    const packets = await listPending(missionDir);
    if (packets.length === 0) return packets;
    await mkdir(join(missionDir, "steering", "applied"), { recursive: true });
    for (const packet of packets) {
      const name = packetName(packet);
      const applied: AppliedPacket = { ...packet, appliedAt: now(), result };
      await writeJson(join(missionDir, "steering", "applied", name), applied);
      await rm(join(missionDir, "steering", name));
    }
    return packets;
  });
}
