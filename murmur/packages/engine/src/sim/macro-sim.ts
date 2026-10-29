/**
 * @murmur/engine — Micro-Macro Decoupled Simulation Loop (Milestone M3, Feature 8).
 *
 * Decouples micro qualitative LLM reasoning (10–30 exemplar cohort personas)
 * from macro quantitative population dynamics (100k+ nodes in TypedArray buffers).
 *
 * Provides:
 * - Macro prior summaries (<150 tokens) for LLM persona prompts
 * - Micro-to-macro semantic shockwave injection
 * - Macro-to-micro archetype susceptibility feedback
 * - Coordinated decoupled multi-scale simulation stepping
 */

import {
  type MacroGraphState,
  type MacroStepResult,
  MacroCompartment,
  stepMacroGraph,
} from "../dynamics/macro-graph.js";

// ==========================================
// 1. Interfaces & Types
// ==========================================

export interface MacroPriorSummary {
  population: number;
  outragedPct: number;
  churnCount: number;
  dominantCohortOutrage: "low" | "moderate" | "high" | "extreme";
  globalOutrageIndex?: number;
  meanStance?: number;
}

export interface SemanticShockwave {
  targetCohort?: string;
  targetSeedIndices: number[];
  deltaOutrage: number;
  stanceShift: number;
  makeContagious?: boolean;
}

export interface MicroPersonaState {
  id: string;
  archetype: string;
  stance: number;
  activity?: number;
}

export interface DecoupledSimulationParams {
  macroState: MacroGraphState;
  round: number;
  microPersonas?: MicroPersonaState[];
  shockwave?: SemanticShockwave;
  contagionBeta?: number;
  decayFactor?: number;
  churnThreshold?: number;
}

export interface DecoupledSimulationResult {
  round: number;
  stepResult: MacroStepResult;
  macroPrior: MacroPriorSummary;
  updatedMicroPersonas?: MicroPersonaState[];
  tokenBurn: 0; // Guaranteed 0 tokens burned by macro dynamics
}

// ==========================================
// 2. Formatting Compact Macro Priors (<150 tokens)
// ==========================================

/**
 * Formats a compact macro prior summary (<150 tokens) for injection into
 * micro LLM persona generation prompts.
 */
export function formatMacroPriors(
  macroState: MacroGraphState,
  stepResult: MacroStepResult,
): MacroPriorSummary {
  const outragedPct = Math.round(stepResult.outrageIndex * 1000) / 10;
  let dominantCohortOutrage: "low" | "moderate" | "high" | "extreme" = "moderate";

  if (stepResult.outrageIndex > 0.7 || stepResult.stateDistribution.contagious > macroState.nodeCount * 0.1) {
    dominantCohortOutrage = "high";
  } else if (stepResult.outrageIndex > 0.4 || stepResult.stateDistribution.contagious > macroState.nodeCount * 0.05) {
    dominantCohortOutrage = "high";
  } else if (stepResult.outrageIndex < 0.15) {
    dominantCohortOutrage = "low";
  }

  return {
    population: macroState.nodeCount,
    outragedPct,
    churnCount: stepResult.churnCount,
    dominantCohortOutrage,
  };
}

// ==========================================
// 3. Injecting Semantic Shockwaves
// ==========================================

/**
 * Injects qualitative shockwave vectors from micro discourse/war-room debates
 * into specified macro graph seed nodes.
 */
export function injectSemanticShockwave(
  macroState: MacroGraphState,
  shockwave: SemanticShockwave,
): void {
  const { targetSeedIndices, deltaOutrage, stanceShift, makeContagious = true } = shockwave;
  const nodeCount = macroState.nodeCount;

  for (const idx of targetSeedIndices) {
    if (idx < 0 || idx >= nodeCount) continue;

    macroState.outrage[idx] = Math.min(1.0, Math.max(0.0, macroState.outrage[idx] + deltaOutrage));
    macroState.stances[idx] = Math.min(1.0, Math.max(-1.0, macroState.stances[idx] + stanceShift));

    if (makeContagious && macroState.states[idx] !== MacroCompartment.CHURNED) {
      macroState.states[idx] = MacroCompartment.CONTAGIOUS; // 3
    }
  }
}

// ==========================================
// 4. Updating Micro Personas from Macro Dynamics
// ==========================================

const DEFAULT_ARCHETYPE_SUSCEPTIBILITY: Record<string, number> = {
  oss_maintainer: 1.0,
  indie_dev: 0.7,
  tech_lead: 0.5,
  enterprise_architect: 0.3,
  c_suite: 0.2,
};

/**
 * Updates micro persona stances according to archetype susceptibility and macro outrage level.
 */
export function updateMicroPersonasFromMacro(
  microPersonas: MicroPersonaState[],
  macroOutrageIndex: number,
  customSusceptibility?: Record<string, number>,
): MicroPersonaState[] {
  const susceptibilityMap = { ...DEFAULT_ARCHETYPE_SUSCEPTIBILITY, ...customSusceptibility };

  return microPersonas.map((p) => {
    const sensitivity = susceptibilityMap[p.archetype] ?? 0.5;
    const delta = macroOutrageIndex * sensitivity * 0.5;
    return {
      ...p,
      stance: Math.max(-1.0, Math.min(1.0, p.stance - delta)),
    };
  });
}

// ==========================================
// 5. Mapping Micro Personas to Macro Shock
// ==========================================

/**
 * Analyzes micro personas' discourse and derives an aggregate semantic shockwave
 * to be diffused into the macro population.
 */
export function mapMicroPersonasToMacroShock(
  microPersonas: MicroPersonaState[],
  options?: {
    seedCount?: number;
    nodeCount?: number;
  },
): SemanticShockwave {
  if (microPersonas.length === 0) {
    return {
      targetSeedIndices: [],
      deltaOutrage: 0,
      stanceShift: 0,
    };
  }

  let totalStance = 0;
  let negativeCount = 0;

  for (const p of microPersonas) {
    totalStance += p.stance;
    if (p.stance < -0.2) negativeCount++;
  }

  const avgStance = totalStance / microPersonas.length;
  const negativeRatio = negativeCount / microPersonas.length;

  const deltaOutrage = Math.max(0.0, negativeRatio * 0.8);
  const stanceShift = Math.min(0.0, avgStance * 0.5);

  const seedCount = options?.seedCount ?? Math.min(20, Math.max(5, microPersonas.length));
  const maxNode = options?.nodeCount ?? 1000;
  const targetSeedIndices: number[] = [];

  for (let i = 0; i < seedCount && i < maxNode; i++) {
    targetSeedIndices.push(i);
  }

  return {
    targetSeedIndices,
    deltaOutrage,
    stanceShift,
    makeContagious: negativeRatio > 0.4,
  };
}

// ==========================================
// 6. Multi-Scale Coordinated Simulation Loop
// ==========================================

/**
 * Executes a full round of decoupled micro-macro simulation:
 * 1. Injects any semantic shockwaves into macro graph
 * 2. Runs deterministic vectorized macro graph dynamics (0 LLM tokens)
 * 3. Extracts compact macro prior summary (<150 tokens)
 * 4. Updates micro personas from macro trends
 */
export function runDecoupledSimulationRound(
  params: DecoupledSimulationParams,
): DecoupledSimulationResult {
  const {
    macroState,
    round,
    microPersonas,
    shockwave,
    contagionBeta = 0.25,
    decayFactor = 0.95,
    churnThreshold = 0.85,
  } = params;

  // 1. Inject shockwave if provided
  if (shockwave && shockwave.targetSeedIndices.length > 0) {
    injectSemanticShockwave(macroState, shockwave);
  }

  // 2. Step macro dynamics
  const stepResult = stepMacroGraph(macroState, {
    round,
    contagionBeta,
    decayFactor,
    churnThreshold,
  });

  // 3. Extract compact priors
  const macroPrior = formatMacroPriors(macroState, stepResult);

  // 4. Update micro personas if present
  let updatedMicroPersonas: MicroPersonaState[] | undefined;
  if (microPersonas && microPersonas.length > 0) {
    updatedMicroPersonas = updateMicroPersonasFromMacro(microPersonas, stepResult.outrageIndex);
  }

  return {
    round,
    stepResult,
    macroPrior,
    updatedMicroPersonas,
    tokenBurn: 0,
  };
}
