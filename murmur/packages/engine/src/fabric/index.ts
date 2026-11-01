/**
 * Persona Fabric (Phase B) — deterministic surrogate populations, fitted
 * surrogate models, mass evaluation and lazy persona materialization.
 *
 * Everything here is LLM-free and network-free at evaluation time, and every
 * fabric-derived output must carry the honesty block (personaCount +
 * surrogate metrics + SURROGATE_DISCLAIMER) — see docs/fabric.md.
 */
export {
  ARCHETYPE_INDEX,
  ARCHETYPE_NAMES,
  clamp01,
  FABRIC_ARCHETYPES,
  MAX_FABRIC_POPULATION,
  normalizeArchetypeWeights,
  SURROGATE_DISCLAIMER,
  TRAIT_COUNT,
  TRAIT_INDEX,
  TRAIT_KEYS,
  type FabricArchetype,
  type FabricSpec,
  type TraitKey,
} from "./traits.js";
export {
  archetypeCounts,
  archetypeSharesByName,
  fabricate,
  personaIdOf,
  resolvePersonaIndex,
  round6,
  traitMeans,
  type FabricPopulation,
} from "./sample.js";
export {
  fit,
  modelFromJson,
  modelToJson,
  predict,
  predictPersona,
  type BinaryHeadJson,
  type FabricExample,
  type FabricMetrics,
  type FabricPrediction,
  type FitOptions,
  type FitResult,
  type SoftmaxHeadJson,
  type SurrogateModel,
} from "./surrogate.js";
export {
  fabricHonesty,
  massEvaluate,
  type ClaimAggregate,
  type FabricClaimInput,
  type FabricEvaluation,
  type FabricHonestyBlock,
} from "./evaluate.js";
export {
  appendMemory,
  getMemory,
  lazyPersona,
  type FabricMemoryEntry,
  type FabricMemoryLog,
  type PersonaView,
} from "./materialize.js";
