/**
 * Fabric runtime state — the active persona-fabric population per world.
 *
 * Persistence is minimal by design: the world directory carries `fabric.json`
 * with the spec (count + weights + seed), the fitted surrogate model JSON and
 * the persona memory log. The population itself is NEVER persisted — it is
 * rebuilt deterministically from the spec on demand (same seed ⇒ byte-
 * identical typed arrays), so even a 1,000,000-persona world costs kilobytes
 * on disk.
 */
import {
  fabricate,
  modelFromJson,
  modelToJson,
  type FabricMemoryEntry,
  type FabricMemoryLog,
  type FabricPopulation,
  type FabricSpec,
  type SurrogateModel,
  type Workspace,
  type World,
} from "@murmur/engine";

export interface FabricWorldState {
  worldId: string;
  spec: FabricSpec;
  /** Fitted surrogate model, or null (views are UNCALIBRATED until one exists). */
  model: SurrogateModel | null;
  memory: FabricMemoryLog;
  /** In-memory typed-array cache; rebuilt from the spec on demand. */
  population: FabricPopulation | null;
}

/** The on-disk envelope — mirrors the world-file layout in worlddir.ts. */
interface FabricFileV1 {
  format: "murmur-fabric";
  version: 1;
  spec: FabricSpec;
  model: Record<string, unknown> | null;
  memory: FabricMemoryEntry[];
}

export class FabricState {
  private readonly cache = new Map<string, FabricWorldState>();

  constructor(private readonly workspace: Workspace) {}

  /**
   * The active fabric state for a world, or null. Memory cache first, then
   * the world directory (restart rehydration), then null.
   */
  get(world: World): FabricWorldState | null {
    const hit = this.cache.get(world.id);
    if (hit) return hit;
    const loaded = this.load(world);
    if (!loaded) return null;
    this.cache.set(world.id, loaded);
    return loaded;
  }

  /** Cache + persist the state (spec + model + memory; never the population). */
  save(world: World, state: FabricWorldState): void {
    this.cache.set(world.id, state);
    const file: FabricFileV1 = {
      format: "murmur-fabric",
      version: 1,
      spec: state.spec,
      model: state.model ? modelToJson(state.model) : null,
      memory: [...state.memory],
    };
    this.workspace.writeAtomic(
      this.workspace.fabricPath(world.slug),
      JSON.stringify(file, null, 2),
    );
  }

  /** The population, fabricated from the spec on first use and cached. */
  population(state: FabricWorldState): FabricPopulation {
    if (!state.population) state.population = fabricate(state.spec);
    return state.population;
  }

  private load(world: World): FabricWorldState | null {
    const raw = this.workspace.readIfExists(
      this.workspace.fabricPath(world.slug),
    );
    if (raw === null) return null;
    let parsed: FabricFileV1;
    try {
      parsed = JSON.parse(raw) as FabricFileV1;
    } catch (e) {
      throw new Error(
        `fabric state for world ${world.slug} is corrupt (${String(e)}) — delete .murmur/${world.slug}/fabric.json or re-run personas({action:'fabricate'})`,
      );
    }
    if (parsed?.format !== "murmur-fabric" || parsed?.version !== 1) return null;
    if (
      !parsed.spec ||
      typeof parsed.spec.seed !== "string" ||
      !Number.isInteger(parsed.spec.count)
    ) {
      return null;
    }
    return {
      worldId: world.id,
      spec: parsed.spec,
      model: parsed.model ? modelFromJson(parsed.model) : null,
      memory: Array.isArray(parsed.memory) ? parsed.memory : [],
      population: null,
    };
  }
}
