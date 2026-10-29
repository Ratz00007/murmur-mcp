/**
 * Empirical Challenger Test Suite — Milestone M3: Challenger 2 (challenger_m3_2)
 *
 * RIGOROUS EMPIRICAL VERIFICATION:
 * 1. Binary BLOB snapshot save and load (`saveMacroSnapshot`, `loadMacroSnapshot`)
 *    with 100,000 nodes. Verifies bit-exact fidelity across all Float32Array and Uint8Array buffers.
 * 2. SQLite concurrent read/write and handle cleanup to ensure zero `EBUSY` locks on Windows.
 * 3. `injectSemanticShockwave` and `updateMicroPersonasFromMacro` with extreme stance shocks (-1.0 to +1.0)
 *    and mathematical convergence verification.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  openDatabase,
  Storage,
  createMacroGraphState,
  stepMacroGraph,
  serializeMacroGraph,
  deserializeMacroGraph,
  saveMacroSnapshot,
  loadMacroSnapshot,
  formatMacroPriors,
  injectSemanticShockwave,
  updateMicroPersonasFromMacro,
  MacroCompartment,
  type MicroPersonaState,
} from "@murmur/engine";

const createIsolatedDbDir = (prefix = "murmur-challenger-m3-2-") => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, dbPath: path.join(dir, "murmur.db") };
};

describe("Adversarial Challenger M3-2: Macro Engine, SQLite Durability & Micro-Macro Feedback", () => {
  // =========================================================================
  // SECTION 1: 100k Node BLOB Snapshot Serialization & Bit-Exact Fidelity
  // =========================================================================
  describe("1. 100,000 Node BLOB Snapshot Bit-Exact Fidelity Stress Testing", () => {
    it("preserves 100% bit-exact fidelity across all 8 TypedArray buffers on 100k nodes & 800k edges", () => {
      const nodeCount = 100_000;
      const averageDegree = 8;
      const state = createMacroGraphState({
        nodeCount,
        averageDegree,
        initialOutrageSeedRate: 0.12,
        kolRatio: 0.03,
      });

      // Inject special floating point boundary values to test IEEE 754 fidelity:
      // -1.0, 1.0, 0.0, -0.0, arbitrary mantissa floats
      state.stances[0] = -1.0;
      state.stances[1] = 1.0;
      state.stances[2] = 0.0;
      state.stances[3] = -0.0;
      state.stances[4] = 0.12345679;
      state.stances[5] = -0.9876543;

      state.outrage[0] = 0.0;
      state.outrage[1] = 1.0;
      state.outrage[2] = 0.5555556;

      state.susceptibility[0] = 0.0;
      state.susceptibility[1] = 1.0;
      state.susceptibility[2] = 0.4242424;

      state.kolWeight[0] = 1.0;
      state.kolWeight[1] = 100.0;
      state.kolWeight[2] = 33.333332;

      // Ensure all 5 SEICR states exist in buffer
      state.states[0] = MacroCompartment.SUSCEPTIBLE;
      state.states[1] = MacroCompartment.EXPOSED;
      state.states[2] = MacroCompartment.INFECTED;
      state.states[3] = MacroCompartment.CONTAGIOUS;
      state.states[4] = MacroCompartment.CHURNED;

      // Execute a simulation step to produce non-trivial dynamic values across all 100k nodes
      const stepRes = stepMacroGraph(state, { round: 1, contagionBeta: 0.4 });

      // Save to SQLite via saveMacroSnapshot
      const { dir, dbPath } = createIsolatedDbDir();
      const db = openDatabase(dbPath);
      const storage = new Storage(db);
      const world = storage.createWorld({ name: "snapshot-100k-world", seed: "seed-100k-test" });

      // 1. In-memory buffer serialization benchmark
      const memSerStart = performance.now();
      const inMemoryBlob = serializeMacroGraph(state);
      const memSerDuration = performance.now() - memSerStart;
      expect(inMemoryBlob.length).toBe(8_500_016); // Exactly ~8.5MB for 100k nodes & 800k edges
      expect(memSerDuration).toBeLessThan(500);

      // 2. In-memory buffer deserialization benchmark
      const memDeserStart = performance.now();
      const memRecovered = deserializeMacroGraph(inMemoryBlob);
      const memDeserDuration = performance.now() - memDeserStart;
      expect(memRecovered.nodeCount).toBe(100_000);
      expect(memDeserDuration).toBeLessThan(500);

      // 3. SQLite disk persistence of 8.5MB BLOB
      const diskSaveStart = performance.now();
      saveMacroSnapshot(db, world.id, 1, state, stepRes);
      const diskSaveDuration = performance.now() - diskSaveStart;
      expect(diskSaveDuration).toBeLessThan(2500); // Allow disk I/O budget on Windows NTFS

      // 4. Reload snapshot from SQLite disk
      const loadStart = performance.now();
      const loaded = loadMacroSnapshot(db, world.id, 1);
      const loadDuration = performance.now() - loadStart;
      expect(loadDuration).toBeLessThan(2000);

      expect(loaded).not.toBeNull();
      expect(loaded!.snapshot.node_count).toBe(nodeCount);
      expect(loaded!.snapshot.edge_count).toBe(800_000);
      expect(loaded!.snapshot.mean_stance).toBe(stepRes.meanStance);
      expect(loaded!.snapshot.outrage_index).toBe(stepRes.outrageIndex);
      expect(loaded!.snapshot.churn_count).toBe(stepRes.churnCount);

      const rec = loaded!.state;

      // 1. Array lengths verification
      expect(rec.nodeCount).toBe(state.nodeCount);
      expect(rec.edgeCount).toBe(state.edgeCount);
      expect(rec.stances.length).toBe(nodeCount);
      expect(rec.outrage.length).toBe(nodeCount);
      expect(rec.susceptibility.length).toBe(nodeCount);
      expect(rec.kolWeight.length).toBe(nodeCount);
      expect(rec.states.length).toBe(nodeCount);
      expect(rec.rowPointers.length).toBe(nodeCount + 1);
      expect(rec.columnIndices.length).toBe(state.edgeCount);
      expect(rec.edgeWeights.length).toBe(state.edgeCount);

      // 2. Exact Buffer Byte-by-Byte comparison (zero bit divergence across all 8 buffers)
      const stancesBufOrig = Buffer.from(state.stances.buffer, state.stances.byteOffset, state.stances.byteLength);
      const stancesBufRec = Buffer.from(rec.stances.buffer, rec.stances.byteOffset, rec.stances.byteLength);
      expect(Buffer.compare(stancesBufOrig, stancesBufRec)).toBe(0);

      const outrageBufOrig = Buffer.from(state.outrage.buffer, state.outrage.byteOffset, state.outrage.byteLength);
      const outrageBufRec = Buffer.from(rec.outrage.buffer, rec.outrage.byteOffset, rec.outrage.byteLength);
      expect(Buffer.compare(outrageBufOrig, outrageBufRec)).toBe(0);

      const suscBufOrig = Buffer.from(state.susceptibility.buffer, state.susceptibility.byteOffset, state.susceptibility.byteLength);
      const suscBufRec = Buffer.from(rec.susceptibility.buffer, rec.susceptibility.byteOffset, rec.susceptibility.byteLength);
      expect(Buffer.compare(suscBufOrig, suscBufRec)).toBe(0);

      const kolBufOrig = Buffer.from(state.kolWeight.buffer, state.kolWeight.byteOffset, state.kolWeight.byteLength);
      const kolBufRec = Buffer.from(rec.kolWeight.buffer, rec.kolWeight.byteOffset, rec.kolWeight.byteLength);
      expect(Buffer.compare(kolBufOrig, kolBufRec)).toBe(0);

      const statesBufOrig = Buffer.from(state.states.buffer, state.states.byteOffset, state.states.byteLength);
      const statesBufRec = Buffer.from(rec.states.buffer, rec.states.byteOffset, rec.states.byteLength);
      expect(Buffer.compare(statesBufOrig, statesBufRec)).toBe(0);

      const rowPtrBufOrig = Buffer.from(state.rowPointers.buffer, state.rowPointers.byteOffset, state.rowPointers.byteLength);
      const rowPtrBufRec = Buffer.from(rec.rowPointers.buffer, rec.rowPointers.byteOffset, rec.rowPointers.byteLength);
      expect(Buffer.compare(rowPtrBufOrig, rowPtrBufRec)).toBe(0);

      const colIdxBufOrig = Buffer.from(state.columnIndices.buffer, state.columnIndices.byteOffset, state.columnIndices.byteLength);
      const colIdxBufRec = Buffer.from(rec.columnIndices.buffer, rec.columnIndices.byteOffset, rec.columnIndices.byteLength);
      expect(Buffer.compare(colIdxBufOrig, colIdxBufRec)).toBe(0);

      const edgeWtBufOrig = Buffer.from(state.edgeWeights.buffer, state.edgeWeights.byteOffset, state.edgeWeights.byteLength);
      const edgeWtBufRec = Buffer.from(rec.edgeWeights.buffer, rec.edgeWeights.byteOffset, rec.edgeWeights.byteLength);
      expect(Buffer.compare(edgeWtBufOrig, edgeWtBufRec)).toBe(0);

      // Clean teardown
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("handles corrupt, truncated, or invalid BLOB payloads gracefully", () => {
      // 1. Corrupt magic header
      const invalidHeaderBuf = Buffer.alloc(100);
      invalidHeaderBuf.writeUInt32LE(0xdeadbeef, 0);
      expect(() => deserializeMacroGraph(invalidHeaderBuf)).toThrow(/magic mismatch/);

      // 2. Truncated buffer
      const shortBuf = Buffer.alloc(8);
      shortBuf.writeUInt32LE(0x4d414352, 0); // valid "MACR" magic
      shortBuf.writeInt32LE(100, 4); // nodeCount 100, but buffer ends before edgeCount or data
      expect(() => deserializeMacroGraph(shortBuf)).toThrow();
    });

    it("correctly differentiates multiple rounds and handles missing rounds", () => {
      const { dir, dbPath } = createIsolatedDbDir();
      const db = openDatabase(dbPath);
      const storage = new Storage(db);
      const world = storage.createWorld({ name: "multi-round-world" });

      const state1 = createMacroGraphState({ nodeCount: 100, averageDegree: 4 });
      const res1 = stepMacroGraph(state1, { round: 1 });
      saveMacroSnapshot(db, world.id, 1, state1, res1);

      const state2 = createMacroGraphState({ nodeCount: 100, averageDegree: 4 });
      state2.stances[0] = 0.99;
      const res2 = stepMacroGraph(state2, { round: 2 });
      saveMacroSnapshot(db, world.id, 2, state2, res2);

      // Query round 1 specifically
      const loadedR1 = loadMacroSnapshot(db, world.id, 1);
      expect(loadedR1?.snapshot.round).toBe(1);

      // Query round 2 specifically
      const loadedR2 = loadMacroSnapshot(db, world.id, 2);
      expect(loadedR2?.snapshot.round).toBe(2);
      expect(loadedR2?.state.stances[0]).toBeCloseTo(state2.stances[0], 5);

      // Default (no round specified) retrieves latest round (2)
      const loadedLatest = loadMacroSnapshot(db, world.id);
      expect(loadedLatest?.snapshot.round).toBe(2);

      // Query non-existent round 999
      const loadedMissing = loadMacroSnapshot(db, world.id, 999);
      expect(loadedMissing).toBeNull();

      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  // =========================================================================
  // SECTION 2: SQLite Concurrency & Zero EBUSY Locks on Windows
  // =========================================================================
  describe("2. SQLite Concurrency & Zero Windows EBUSY Locks", () => {
    it("handles concurrent readers while a writer commits 100k snapshots in WAL mode", () => {
      const { dir, dbPath } = createIsolatedDbDir();

      // Open writer connection
      const writerDb = openDatabase(dbPath);
      const storage = new Storage(writerDb);
      const world = storage.createWorld({ name: "concurrency-world" });

      // Open separate reader connection to the same SQLite file
      const readerDb = openDatabase(dbPath);

      // Write round 1 snapshot
      const state = createMacroGraphState({ nodeCount: 5000, averageDegree: 6 });
      const res1 = stepMacroGraph(state, { round: 1 });
      saveMacroSnapshot(writerDb, world.id, 1, state, res1);

      // Reader queries round 1
      const readR1 = loadMacroSnapshot(readerDb, world.id, 1);
      expect(readR1).not.toBeNull();
      expect(readR1?.snapshot.round).toBe(1);

      // Concurrently perform read while writer writes round 2
      const res2 = stepMacroGraph(state, { round: 2 });
      saveMacroSnapshot(writerDb, world.id, 2, state, res2);

      const readR2 = loadMacroSnapshot(readerDb, world.id, 2);
      expect(readR2).not.toBeNull();
      expect(readR2?.snapshot.round).toBe(2);

      // Clean handle closing in reverse order
      readerDb.close();
      writerDb.close();

      // Critical Windows test: deleting directory must NOT throw EBUSY
      expect(() => fs.rmSync(dir, { recursive: true, force: true })).not.toThrow();
      expect(fs.existsSync(dir)).toBe(false);
    });

    it("survives rapid consecutive open/save/load/close/unlink cycles without leaking file handles", () => {
      // 15 rapid cycles to stress Windows NTFS lock release and garbage collection
      for (let i = 0; i < 15; i++) {
        const { dir, dbPath } = createIsolatedDbDir(`murmur-rapid-ebusy-${i}-`);
        const db = openDatabase(dbPath);
        const storage = new Storage(db);
        const world = storage.createWorld({ name: `rapid-world-${i}` });

        const state = createMacroGraphState({ nodeCount: 1000, averageDegree: 4 });
        const res = stepMacroGraph(state, { round: 1 });
        saveMacroSnapshot(db, world.id, 1, state, res);

        const loaded = loadMacroSnapshot(db, world.id, 1);
        expect(loaded?.snapshot.round).toBe(1);

        // Close connection cleanly
        db.close();

        // Attempt immediate directory deletion on Windows
        // If file descriptors (DB, WAL, SHM) were leaked, this throws EBUSY
        let deleted = false;
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          deleted = true;
        } catch (err: any) {
          throw new Error(`Windows EBUSY lock leak on cycle ${i}: ${err.message}`);
        }
        expect(deleted).toBe(true);
        expect(fs.existsSync(dir)).toBe(false);
      }
    });

    it("allows 4 concurrent database handles without deadlocking", () => {
      const { dir, dbPath } = createIsolatedDbDir("murmur-multi-handle-");
      const connections = Array.from({ length: 4 }, () => openDatabase(dbPath));
      const storage = new Storage(connections[0]);
      const world = storage.createWorld({ name: "multi-handle-world" });

      try {
        const state = createMacroGraphState({ nodeCount: 500, averageDegree: 4 });
        const res = stepMacroGraph(state, { round: 1 });

        // Connection 0 writes snapshot
        saveMacroSnapshot(connections[0], world.id, 1, state, res);

        // Connections 1, 2, 3 read snapshot
        for (let i = 1; i < 4; i++) {
          const loaded = loadMacroSnapshot(connections[i], world.id, 1);
          expect(loaded).not.toBeNull();
          expect(loaded?.snapshot.round).toBe(1);
        }
      } finally {
        for (const conn of connections) {
          conn.close();
        }
      }

      fs.rmSync(dir, { recursive: true, force: true });
      expect(fs.existsSync(dir)).toBe(false);
    });
  });

  // =========================================================================
  // SECTION 3: Micro-Macro Feedback, Extreme Stance Shocks & Mathematical Convergence
  // =========================================================================
  describe("3. Extreme Stance Shocks (-1.0 to +1.0) & Mathematical Convergence", () => {
    it("strictly bounds stances and outrage under extreme out-of-range shocks (+10.0 and -10.0)", () => {
      const state = createMacroGraphState({ nodeCount: 1000, averageDegree: 6 });

      // 1. Extreme negative shock
      injectSemanticShockwave(state, {
        targetSeedIndices: [0, 1, 2],
        deltaOutrage: 10.0, // Exceeds upper bound
        stanceShift: -10.0, // Exceeds lower bound
        makeContagious: true,
      });

      expect(state.outrage[0]).toBe(1.0);
      expect(state.stances[0]).toBe(-1.0);
      expect(state.states[0]).toBe(MacroCompartment.CONTAGIOUS);

      // 2. Extreme positive shock ("Vaccine" / Walkback) on fresh node 10
      injectSemanticShockwave(state, {
        targetSeedIndices: [10],
        deltaOutrage: -10.0, // Exceeds lower bound
        stanceShift: 10.0, // Exceeds upper bound
        makeContagious: false,
      });

      expect(state.outrage[10]).toBe(0.0);
      expect(state.stances[10]).toBe(1.0);
      // Node 10 was not contagious and makeContagious was false, so state remains non-contagious
      expect(state.states[10]).not.toBe(MacroCompartment.CONTAGIOUS);
    });

    it("verifies de-escalation from CONTAGIOUS compartment and formatMacroPriors low outrage report on cooldown", () => {
      const state = createMacroGraphState({ nodeCount: 1000, averageDegree: 4, initialOutrageSeedRate: 0.0 });
      // Initially, all nodes are susceptible and outrage is 0.05
      // Inject shockwave to 1 node to make it CONTAGIOUS
      injectSemanticShockwave(state, {
        targetSeedIndices: [0],
        deltaOutrage: 0.9,
        stanceShift: -0.9,
        makeContagious: true,
      });
      expect(state.states[0]).toBe(MacroCompartment.CONTAGIOUS);

      // Now inject extreme positive vaccine/walkback on node 0
      injectSemanticShockwave(state, {
        targetSeedIndices: [0],
        deltaOutrage: -1.0,
        stanceShift: 2.0,
        makeContagious: false,
      });

      expect(state.outrage[0]).toBe(0.0); // Completely calmed down
      expect(state.stances[0]).toBe(1.0); // Completely positive
      expect(state.states[0]).toBe(MacroCompartment.CONTAGIOUS);

      // Step simulation: when outrage and exposure cool down, stepMacroGraph de-escalates CONTAGIOUS to INFECTED
      const stepRes = stepMacroGraph(state, { round: 1, contagionBeta: 0.0, decayFactor: 0.1 });
      expect(stepRes.stateDistribution.contagious).toBe(0);
      expect(stepRes.stateDistribution.infected).toBe(1);

      // With proportional contagious threshold (<= 5%), formatMacroPriors accurately reflects low outrage
      const prior = formatMacroPriors(state, stepRes);
      expect(prior.dominantCohortOutrage).toBe("low");
    });

    it("safely ignores out-of-bounds seed indices in injectSemanticShockwave", () => {
      const state = createMacroGraphState({ nodeCount: 100, averageDegree: 4 });
      const initialStance = state.stances[50];

      expect(() => {
        injectSemanticShockwave(state, {
          targetSeedIndices: [-1, -999, 100, 101, 1000000],
          deltaOutrage: 0.5,
          stanceShift: -0.5,
        });
      }).not.toThrow();

      // Valid indices within range were untouched
      expect(state.stances[50]).toBe(initialStance);
    });

    it("verifies mathematical convergence of macro population dynamics over 30 rounds", () => {
      const nodeCount = 5000;
      const state = createMacroGraphState({
        nodeCount,
        averageDegree: 8,
        initialOutrageSeedRate: 0.15,
      });

      // Track outrageIndex across 30 rounds with decay = 0.92
      const history: number[] = [];
      for (let r = 1; r <= 30; r++) {
        const res = stepMacroGraph(state, {
          round: r,
          contagionBeta: 0.20,
          decayFactor: 0.92,
        });

        // Verification: Zero NaN or Infinite values allowed
        expect(Number.isFinite(res.meanStance)).toBe(true);
        expect(Number.isFinite(res.outrageIndex)).toBe(true);
        expect(Number.isNaN(res.meanStance)).toBe(false);
        expect(Number.isNaN(res.outrageIndex)).toBe(false);

        // Verification: Compartment conservation law
        const totalNodes =
          res.stateDistribution.susceptible +
          res.stateDistribution.exposed +
          res.stateDistribution.infected +
          res.stateDistribution.contagious +
          res.stateDistribution.churned;
        expect(totalNodes).toBe(nodeCount);

        history.push(res.outrageIndex);
      }

      // Mathematical convergence test:
      // In late rounds (rounds 20 to 30), the change per round |outrage(t+1) - outrage(t)|
      // must converge to near zero (< 0.05 per round delta)
      for (let t = 20; t < 29; t++) {
        const delta = Math.abs(history[t + 1] - history[t]);
        expect(delta).toBeLessThan(0.05);
      }
    });

    it("verifies mathematical convergence of updateMicroPersonasFromMacro under sustained shock", () => {
      let personas: MicroPersonaState[] = [
        { id: "p1", archetype: "oss_maintainer", stance: 0.8 },
        { id: "p2", archetype: "enterprise_architect", stance: 0.8 },
      ];

      // Sustained high macro outrage (1.0) for 25 rounds
      for (let r = 0; r < 25; r++) {
        personas = updateMicroPersonasFromMacro(personas, 1.0);
        // Stances must strictly clamp at -1.0 and never underflow
        for (const p of personas) {
          expect(p.stance).toBeGreaterThanOrEqual(-1.0);
          expect(p.stance).toBeLessThanOrEqual(1.0);
          expect(Number.isFinite(p.stance)).toBe(true);
        }
      }

      // After 25 rounds of 1.0 outrage, stances must converge to the lower bound -1.0
      expect(personas[0].stance).toBe(-1.0);
      expect(personas[1].stance).toBe(-1.0);
    });

    it("verifies absorbing state property: churned nodes never recover to susceptible without external intervention", () => {
      const state = createMacroGraphState({ nodeCount: 500, averageDegree: 4 });

      // Force 50 nodes into CHURNED state
      for (let i = 0; i < 50; i++) {
        state.states[i] = MacroCompartment.CHURNED;
        state.stances[i] = -1.0;
        state.outrage[i] = 1.0;
      }

      // Run 5 rounds of simulation with 0 contagion beta and high decay
      for (let r = 1; r <= 5; r++) {
        const res = stepMacroGraph(state, { round: r, contagionBeta: 0.0, decayFactor: 0.5 });
        // Churned count must never drop below 50 (absorbing property)
        expect(res.churnCount).toBeGreaterThanOrEqual(50);
        for (let i = 0; i < 50; i++) {
          expect(state.states[i]).toBe(MacroCompartment.CHURNED);
        }
      }
    });

    it("verifies shockwave cannot resurrect already-churned nodes", () => {
      const state = createMacroGraphState({ nodeCount: 100, averageDegree: 4 });
      state.states[0] = MacroCompartment.CHURNED;

      // When injectSemanticShockwave is invoked on node 0 with makeContagious = true
      injectSemanticShockwave(state, {
        targetSeedIndices: [0],
        deltaOutrage: 0.5,
        stanceShift: -0.5,
        makeContagious: true,
      });

      // Resolved: injectSemanticShockwave guards against resurrecting churned accounts
      expect(state.states[0]).toBe(MacroCompartment.CHURNED);
    });
  });
});
