/**
 * @murmur/engine — Vectorized Macro Graph Dynamics Engine (Milestone M3, Feature 7).
 *
 * Implements high-performance Compressed Sparse Row (CSR) index representation
 * and flat contiguous TypedArray buffers for simulating 100k+ nodes & 1M+ edges
 * with ZERO LLM token consumption (<100ms per round on Windows CPU).
 *
 * State compartments (SEICR):
 *   0 = Susceptible (compliant, business as usual)
 *   1 = Exposed (discussing policy / initial exposure)
 *   2 = Infected (active objection voiced)
 *   3 = Contagious (vocal influencer / amplifies outrage)
 *   4 = Churned (defected / migrated / terminated account)
 */

import type Database from "better-sqlite3";
import { nowIso } from "../util/text.js";

// ==========================================
// 1. Core State & Interface Contracts
// ==========================================

export const MacroCompartment = {
  SUSCEPTIBLE: 0,
  EXPOSED: 1,
  INFECTED: 2,
  CONTAGIOUS: 3,
  CHURNED: 4,
} as const;

export type MacroCompartmentType =
  (typeof MacroCompartment)[keyof typeof MacroCompartment];

export interface MacroGraphState {
  nodeCount: number;
  edgeCount: number;
  // Node buffers: Float32Array / Uint8Array
  stances: Float32Array; // [-1.0, 1.0]
  outrage: Float32Array; // [0.0, 1.0]
  susceptibility: Float32Array; // [0.0, 1.0]
  kolWeight: Float32Array; // [1.0, 100.0]
  states: Uint8Array; // 0=Susceptible, 1=Exposed, 2=Infected, 3=Contagious, 4=Churned
  // Graph CSR buffers
  rowPointers: Int32Array; // length: nodeCount + 1
  columnIndices: Int32Array; // length: edgeCount
  edgeWeights: Float32Array; // length: edgeCount
}

export interface MacroStepResult {
  round: number;
  meanStance: number;
  outrageIndex: number;
  churnCount: number;
  stateDistribution: {
    susceptible: number;
    exposed: number;
    infected: number;
    contagious: number;
    churned: number;
  };
  durationMs: number;
}

export interface MacroGraphInitOptions {
  nodeCount: number;
  averageDegree: number;
  initialOutrageSeedRate?: number;
  kolRatio?: number;
  seed?: number;
}

export interface MacroStepOptions {
  round: number;
  decayFactor?: number;
  contagionBeta?: number;
  churnThreshold?: number;
  boundedConfidenceEpsilon?: number;
}

// ==========================================
// 2. Pre-allocated Scratch Buffer (Zero Heap Allocation)
// ==========================================

let scratchStances: Float32Array | null = null;
let scratchOutrage: Float32Array | null = null;

function getScratchBuffers(nodeCount: number): {
  nextStances: Float32Array;
  nextOutrage: Float32Array;
} {
  if (!scratchStances || scratchStances.length < nodeCount) {
    scratchStances = new Float32Array(nodeCount);
    scratchOutrage = new Float32Array(nodeCount);
  }
  return {
    nextStances: scratchStances,
    nextOutrage: scratchOutrage ?? new Float32Array(nodeCount),
  };
}

// ==========================================
// 3. State Initialization & Factory
// ==========================================

export function createMacroGraphState(
  opts: MacroGraphInitOptions,
): MacroGraphState {
  const {
    nodeCount,
    averageDegree,
    initialOutrageSeedRate = 0.05,
    kolRatio = 0.02,
  } = opts;
  if (nodeCount <= 0) {
    throw new Error("Invalid nodeCount: must be positive");
  }

  const edgeCount = nodeCount * averageDegree;

  const stances = new Float32Array(nodeCount);
  const outrage = new Float32Array(nodeCount);
  const susceptibility = new Float32Array(nodeCount);
  const kolWeight = new Float32Array(nodeCount);
  const states = new Uint8Array(nodeCount);

  const kolStep = Math.max(1, Math.floor(1 / kolRatio));

  for (let i = 0; i < nodeCount; i++) {
    // Normal-like distributed initial stances [-0.5, 0.5]
    stances[i] = ((i % 100) / 50.0 - 1.0) * 0.5;
    susceptibility[i] = 0.2 + 0.6 * (((i * 7919) % 1000) / 1000);
    const isKOL = i % kolStep === 0;
    kolWeight[i] = isKOL ? 20.0 + 80.0 * (((i * 3571) % 100) / 100) : 1.0;

    if (i < nodeCount * initialOutrageSeedRate) {
      outrage[i] = 0.8 + 0.2 * ((i % 20) / 20);
      stances[i] = -0.9;
      states[i] = MacroCompartment.INFECTED; // 2
    } else {
      outrage[i] = 0.05;
      states[i] = MacroCompartment.SUSCEPTIBLE; // 0
    }
  }

  // Build CSR topology
  const rowPointers = new Int32Array(nodeCount + 1);
  const columnIndices = new Int32Array(edgeCount);
  const edgeWeights = new Float32Array(edgeCount);

  let currentEdge = 0;
  rowPointers[0] = 0;
  const invDegree = averageDegree > 0 ? 1.0 / averageDegree : 1.0;

  for (let i = 0; i < nodeCount; i++) {
    for (let d = 0; d < averageDegree; d++) {
      if (currentEdge < edgeCount) {
        const target = (i + d * 13 + 7) % nodeCount;
        columnIndices[currentEdge] = target;
        edgeWeights[currentEdge] = invDegree;
        currentEdge++;
      }
    }
    rowPointers[i + 1] = currentEdge;
  }

  return {
    nodeCount,
    edgeCount,
    stances,
    outrage,
    susceptibility,
    kolWeight,
    states,
    rowPointers,
    columnIndices,
    edgeWeights,
  };
}

// ==========================================
// 4. Vectorized Simulation Step
// ==========================================

export function stepMacroGraph(
  state: MacroGraphState,
  options: MacroStepOptions = { round: 1 },
): MacroStepResult {
  const startTime = performance.now();
  const {
    nodeCount,
    stances,
    outrage,
    susceptibility,
    kolWeight,
    states,
    rowPointers,
    columnIndices,
  } = state;
  const decay = options.decayFactor ?? 0.95;
  const beta = options.contagionBeta ?? 0.25;
  const churnThreshold = options.churnThreshold ?? 0.85;

  let totalStance = 0;
  let totalOutrage = 0;
  let churnCount = 0;
  const dist = {
    susceptible: 0,
    exposed: 0,
    infected: 0,
    contagious: 0,
    churned: 0,
  };

  const { nextStances, nextOutrage } = getScratchBuffers(nodeCount);

  for (let i = 0; i < nodeCount; i++) {
    const currentState = states[i];
    let neighborInfluence = 0;

    const start = rowPointers[i];
    const end = rowPointers[i + 1];
    const neighborCount = end - start;

    for (let e = start; e < end; e++) {
      const neighbor = columnIndices[e];
      const weight = kolWeight[neighbor];
      neighborInfluence += outrage[neighbor] * weight;
    }

    const exposure =
      (neighborInfluence / (neighborCount + 1)) * beta * susceptibility[i];

    // State transition logic (SEICR)
    let s = currentState;
    if (s === MacroCompartment.SUSCEPTIBLE) {
      if (exposure > 0.12) s = MacroCompartment.EXPOSED;
    } else if (s === MacroCompartment.EXPOSED) {
      if (exposure > 0.25 || outrage[i] > 0.4) s = MacroCompartment.INFECTED;
    } else if (s === MacroCompartment.INFECTED) {
      if (exposure > 0.45 || outrage[i] > 0.75) s = MacroCompartment.CONTAGIOUS;
    } else if (s === MacroCompartment.CONTAGIOUS) {
      if (outrage[i] > churnThreshold && stances[i] < -0.6) {
        s = MacroCompartment.CHURNED;
      } else if (outrage[i] < 0.35 && exposure < 0.25) {
        s = MacroCompartment.INFECTED;
      }
    }

    states[i] = s;

    // Update outrage & stance
    if (s === MacroCompartment.CHURNED) {
      nextOutrage[i] = 1.0;
      nextStances[i] = -1.0;
      churnCount++;
    } else {
      nextOutrage[i] = Math.min(
        1.0,
        Math.max(0.0, outrage[i] * decay + exposure),
      );
      nextStances[i] = Math.min(
        1.0,
        Math.max(-1.0, stances[i] - exposure * 0.5),
      );
    }

    totalStance += nextStances[i];
    totalOutrage += nextOutrage[i];

    if (s === MacroCompartment.SUSCEPTIBLE) dist.susceptible++;
    else if (s === MacroCompartment.EXPOSED) dist.exposed++;
    else if (s === MacroCompartment.INFECTED) dist.infected++;
    else if (s === MacroCompartment.CONTAGIOUS) dist.contagious++;
    else if (s === MacroCompartment.CHURNED) dist.churned++;
  }

  // Copy back from scratch buffer into contiguous state
  stances.set(nextStances.subarray(0, nodeCount));
  outrage.set(nextOutrage.subarray(0, nodeCount));

  const durationMs = performance.now() - startTime;
  return {
    round: options.round,
    meanStance: nodeCount > 0 ? totalStance / nodeCount : 0,
    outrageIndex: nodeCount > 0 ? totalOutrage / nodeCount : 0,
    churnCount,
    stateDistribution: dist,
    durationMs,
  };
}

// ==========================================
// 5. Binary BLOB Serialization / Deserialization
// ==========================================

const MAGIC_HEADER = 0x4d414352; // "MACR"

/**
 * Serializes a MacroGraphState into a single contiguous binary Buffer
 * for ultra-fast SQLite BLOB storage (<10ms for 100k nodes).
 */
export function serializeMacroGraph(state: MacroGraphState): Buffer {
  const { nodeCount, edgeCount } = state;
  // Layout:
  // Header: 4 bytes magic, 4 bytes nodeCount, 4 bytes edgeCount (12 bytes)
  // Float32Array stances: nodeCount * 4
  // Float32Array outrage: nodeCount * 4
  // Float32Array susceptibility: nodeCount * 4
  // Float32Array kolWeight: nodeCount * 4
  // Uint8Array states: nodeCount * 1
  // Int32Array rowPointers: (nodeCount + 1) * 4
  // Int32Array columnIndices: edgeCount * 4
  // Float32Array edgeWeights: edgeCount * 4
  const headerBytes = 12;
  const nodeF32Bytes = nodeCount * 4;
  const nodeU8Bytes = nodeCount * 1;
  const rowPtrBytes = (nodeCount + 1) * 4;
  const edgeI32Bytes = edgeCount * 4;
  const edgeF32Bytes = edgeCount * 4;

  const totalBytes =
    headerBytes +
    nodeF32Bytes * 4 + // stances, outrage, susceptibility, kolWeight
    nodeU8Bytes + // states
    rowPtrBytes + // rowPointers
    edgeI32Bytes + // columnIndices
    edgeF32Bytes; // edgeWeights

  const buf = Buffer.alloc(totalBytes);
  let offset = 0;

  buf.writeUInt32LE(MAGIC_HEADER, offset);
  offset += 4;
  buf.writeInt32LE(nodeCount, offset);
  offset += 4;
  buf.writeInt32LE(edgeCount, offset);
  offset += 4;

  buf.set(
    new Uint8Array(
      state.stances.buffer,
      state.stances.byteOffset,
      nodeF32Bytes,
    ),
    offset,
  );
  offset += nodeF32Bytes;

  buf.set(
    new Uint8Array(
      state.outrage.buffer,
      state.outrage.byteOffset,
      nodeF32Bytes,
    ),
    offset,
  );
  offset += nodeF32Bytes;

  buf.set(
    new Uint8Array(
      state.susceptibility.buffer,
      state.susceptibility.byteOffset,
      nodeF32Bytes,
    ),
    offset,
  );
  offset += nodeF32Bytes;

  buf.set(
    new Uint8Array(
      state.kolWeight.buffer,
      state.kolWeight.byteOffset,
      nodeF32Bytes,
    ),
    offset,
  );
  offset += nodeF32Bytes;

  buf.set(
    new Uint8Array(state.states.buffer, state.states.byteOffset, nodeU8Bytes),
    offset,
  );
  offset += nodeU8Bytes;

  buf.set(
    new Uint8Array(
      state.rowPointers.buffer,
      state.rowPointers.byteOffset,
      rowPtrBytes,
    ),
    offset,
  );
  offset += rowPtrBytes;

  buf.set(
    new Uint8Array(
      state.columnIndices.buffer,
      state.columnIndices.byteOffset,
      edgeI32Bytes,
    ),
    offset,
  );
  offset += edgeI32Bytes;

  buf.set(
    new Uint8Array(
      state.edgeWeights.buffer,
      state.edgeWeights.byteOffset,
      edgeF32Bytes,
    ),
    offset,
  );
  offset += edgeF32Bytes;

  return buf;
}

/**
 * Deserializes binary Buffer back into MacroGraphState.
 */
export function deserializeMacroGraph(
  buffer: Uint8Array | Buffer,
): MacroGraphState {
  const buf = Buffer.isBuffer(buffer)
    ? buffer
    : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buf.byteLength < 12) {
    throw new Error("Truncated buffer: insufficient bytes for node/edge count");
  }
  let offset = 0;

  const magic = buf.readUInt32LE(offset);
  offset += 4;
  if (magic !== MAGIC_HEADER) {
    throw new Error(
      `Invalid macro graph buffer: magic mismatch (got ${magic.toString(16)})`,
    );
  }

  const nodeCount = buf.readInt32LE(offset);
  offset += 4;
  const edgeCount = buf.readInt32LE(offset);
  offset += 4;

  const expectedBytes = 12 + nodeCount * 13 + edgeCount * 8;
  if (buf.byteLength < expectedBytes) {
    throw new Error("Truncated buffer: insufficient bytes for node/edge count");
  }

  const nodeF32Bytes = nodeCount * 4;
  const nodeU8Bytes = nodeCount * 1;
  const rowPtrBytes = (nodeCount + 1) * 4;
  const edgeI32Bytes = edgeCount * 4;
  const edgeF32Bytes = edgeCount * 4;

  const stances = new Float32Array(nodeCount);
  new Uint8Array(stances.buffer).set(
    buf.subarray(offset, offset + nodeF32Bytes),
  );
  offset += nodeF32Bytes;

  const outrage = new Float32Array(nodeCount);
  new Uint8Array(outrage.buffer).set(
    buf.subarray(offset, offset + nodeF32Bytes),
  );
  offset += nodeF32Bytes;

  const susceptibility = new Float32Array(nodeCount);
  new Uint8Array(susceptibility.buffer).set(
    buf.subarray(offset, offset + nodeF32Bytes),
  );
  offset += nodeF32Bytes;

  const kolWeight = new Float32Array(nodeCount);
  new Uint8Array(kolWeight.buffer).set(
    buf.subarray(offset, offset + nodeF32Bytes),
  );
  offset += nodeF32Bytes;

  const states = new Uint8Array(nodeCount);
  states.set(buf.subarray(offset, offset + nodeU8Bytes));
  offset += nodeU8Bytes;

  const rowPointers = new Int32Array(nodeCount + 1);
  new Uint8Array(rowPointers.buffer).set(
    buf.subarray(offset, offset + rowPtrBytes),
  );
  offset += rowPtrBytes;

  const columnIndices = new Int32Array(edgeCount);
  new Uint8Array(columnIndices.buffer).set(
    buf.subarray(offset, offset + edgeI32Bytes),
  );
  offset += edgeI32Bytes;

  const edgeWeights = new Float32Array(edgeCount);
  new Uint8Array(edgeWeights.buffer).set(
    buf.subarray(offset, offset + edgeF32Bytes),
  );
  offset += edgeF32Bytes;

  return {
    nodeCount,
    edgeCount,
    stances,
    outrage,
    susceptibility,
    kolWeight,
    states,
    rowPointers,
    columnIndices,
    edgeWeights,
  };
}

// ==========================================
// 6. SQLite Persistence Helpers
// ==========================================

export interface MacroSnapshotRow {
  world_id: string;
  round: number;
  node_count: number;
  edge_count: number;
  mean_stance: number;
  outrage_index: number;
  churn_count: number;
  state_distribution: string;
  graph_blob: Buffer | null;
  created_at: string;
}

export function saveMacroSnapshot(
  db: Database.Database,
  worldId: string,
  round: number,
  state: MacroGraphState,
  result: MacroStepResult,
  includeBlob = true,
): void {
  const blob = includeBlob ? serializeMacroGraph(state) : null;
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO macro_snapshots (
      world_id, round, node_count, edge_count,
      mean_stance, outrage_index, churn_count,
      state_distribution, graph_blob, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    worldId,
    round,
    state.nodeCount,
    state.edgeCount,
    result.meanStance,
    result.outrageIndex,
    result.churnCount,
    JSON.stringify(result.stateDistribution),
    blob,
    nowIso(),
  );
}

export function loadMacroSnapshot(
  db: Database.Database,
  worldId: string,
  round?: number,
): { state: MacroGraphState; snapshot: MacroSnapshotRow } | null {
  const row = (
    round != null
      ? (db
          .prepare(
            "SELECT * FROM macro_snapshots WHERE world_id = ? AND round = ?",
          )
          .get(worldId, round) as MacroSnapshotRow | undefined)
      : (db
          .prepare(
            "SELECT * FROM macro_snapshots WHERE world_id = ? ORDER BY round DESC LIMIT 1",
          )
          .get(worldId) as MacroSnapshotRow | undefined)
  ) as MacroSnapshotRow | undefined;

  if (!row?.graph_blob) return null;

  const state = deserializeMacroGraph(row.graph_blob);
  return { state, snapshot: row };
}

export function persistMacroNodesRelational(
  db: Database.Database,
  worldId: string,
  state: MacroGraphState,
  options?: {
    cohortAssignments?: (index: number) => string;
    arrAssignments?: (index: number) => number;
    priceSensitivityAssignments?: (index: number) => number;
    switchingFrictionAssignments?: (index: number) => number;
    limit?: number;
  },
): void {
  const count = Math.min(state.nodeCount, options?.limit ?? state.nodeCount);
  const getCohort = options?.cohortAssignments ?? (() => "default");
  const getARR = options?.arrAssignments ?? (() => 0);
  const getSensitivity = options?.priceSensitivityAssignments ?? (() => 0.5);
  const getFriction = options?.switchingFrictionAssignments ?? (() => 0.5);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO macro_nodes (
      world_id, node_index, cohort_id, arr,
      price_sensitivity, switching_friction, kol_weight,
      stance, outrage, susceptibility, state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      insertStmt.run(
        worldId,
        i,
        getCohort(i),
        getARR(i),
        getSensitivity(i),
        getFriction(i),
        state.kolWeight[i],
        state.stances[i],
        state.outrage[i],
        state.susceptibility[i],
        state.states[i],
      );
    }
  });

  tx();
}

export function persistMacroEdgesRelational(
  db: Database.Database,
  worldId: string,
  state: MacroGraphState,
  limit?: number,
): void {
  const maxEdges = Math.min(state.edgeCount, limit ?? state.edgeCount);
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO macro_edges (world_id, src_index, dst_index, weight)
    VALUES (?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    let edgeIdx = 0;
    for (let i = 0; i < state.nodeCount && edgeIdx < maxEdges; i++) {
      const start = state.rowPointers[i];
      const end = state.rowPointers[i + 1];
      for (let e = start; e < end && edgeIdx < maxEdges; e++) {
        insertStmt.run(
          worldId,
          i,
          state.columnIndices[e],
          state.edgeWeights[e],
        );
        edgeIdx++;
      }
    }
  });

  tx();
}
