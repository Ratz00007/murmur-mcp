/**
 * Task-capable tool registration.
 *
 * Every generation stage (ontology, personas, sim, report) shares a shape: the
 * server hands out a task, the host completes it, the host hands it back. That
 * two-phase shape is what the MCP **tasks** extension models, so these tools
 * are registered with `execution.taskSupport: "optional"`.
 *
 * Why "optional", and why the work still runs inline:
 *
 * - `taskSupport: "required"` would make task augmentation mandatory, and any
 *   client that cannot do it would lose the stage entirely. Not acceptable for
 *   a tool whose premise is client portability.
 * - With `"optional"` a client that understands tasks may pass a `task`
 *   parameter and get a `{task}` handle back immediately, then poll
 *   `tasks/get` / `tasks/result`. A client that does not is served by the SDK's
 *   own automatic polling, which returns the identical CallToolResult — so
 *   nothing changes for the clients that ignore the extension.
 * - The work itself is pure, in-process and measured in milliseconds, so it
 *   runs to completion inside `createTask` and the task is already terminal by
 *   the time it is returned. A task that is born finished is honest: Murmur's
 *   long-running step is the *client's* generation, which the protocol models
 *   with sampling, not with a server-side job queue. A fake background worker
 *   would buy latency and cost correctness.
 *
 * The SDK path is feature-probed rather than assumed: if the installed SDK has
 * no `experimental.tasks`, the tool is registered the ordinary way and only the
 * optional task affordance is lost.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { log } from "../logging.js";

/** How long a completed task's result stays retrievable, and the poll cadence. */
const TASK_TTL_MS = 10 * 60 * 1000;
const TASK_POLL_INTERVAL_MS = 250;

type Reply = CallToolResult;

/** The parsed argument object for a raw-shape input schema. */
export type ToolArgs<A extends z.ZodRawShape> = z.output<z.ZodObject<A>>;

export interface TaskToolSpec<A extends z.ZodRawShape> {
  title?: string;
  description: string;
  inputSchema: A;
  outputSchema: z.ZodTypeAny;
  /** The tool body. Total: it must answer with a result, not throw. */
  run: (args: ToolArgs<A>) => Promise<Reply>;
}

/**
 * Register a task-capable tool, falling back to plain registration when the
 * installed SDK has no tasks support.
 */
export function registerTaskTool<A extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  spec: TaskToolSpec<A>,
): void {
  // A ZodObject (rather than a bare raw shape) so the SDK's `ToolCallback`
  // infers exactly ToolArgs<A> for a generic A; a raw shape widens to
  // `Record<string, any>` and the handler would have to be cast.
  const inputSchema = z.object(spec.inputSchema);
  const config = {
    title: spec.title,
    description: spec.description,
    inputSchema,
    outputSchema: spec.outputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  };

  const tasks = (
    server as { experimental?: { tasks?: { registerToolTask?: unknown } } }
  ).experimental?.tasks;
  if (typeof tasks?.registerToolTask === "function") {
    (
      tasks.registerToolTask as (
        n: string,
        c: Record<string, unknown>,
        h: Record<string, unknown>,
      ) => unknown
    )(
      name,
      { ...config, execution: { taskSupport: "optional" } },
      {
        createTask: async (args: ToolArgs<A>, extra: TaskExtra) => {
          const task = await extra.taskStore.createTask({
            ttl: TASK_TTL_MS,
            pollInterval: TASK_POLL_INTERVAL_MS,
          });
          // Tool bodies are total — they turn thrown errors into isError
          // replies — so the task always reaches a terminal state here.
          const result = await spec.run(args);
          await extra.taskStore.storeTaskResult(
            task.taskId,
            result.isError ? "failed" : "completed",
            result,
          );
          return { task: (await extra.taskStore.getTask(task.taskId)) ?? task };
        },
        getTask: async (_args: ToolArgs<A>, extra: TaskExtra) =>
          extra.taskStore.getTask(extra.taskId),
        getTaskResult: async (_args: ToolArgs<A>, extra: TaskExtra) =>
          extra.taskStore.getTaskResult(extra.taskId),
      },
    );
    log.info(`tool ${name}: task-capable (taskSupport: optional)`);
    return;
  }

  log.warn(
    `tool ${name}: SDK has no experimental.tasks — registered without task support`,
  );
  server.registerTool(name, config, async (args: ToolArgs<A>) =>
    spec.run(args),
  );
}

/** The slice of the SDK's task-augmented handler extra this module needs. */
interface TaskExtra {
  taskId: string;
  taskStore: {
    createTask(params: {
      ttl: number;
      pollInterval: number;
    }): Promise<{ taskId: string }>;
    getTask(taskId: string): Promise<{ status: string } | null>;
    storeTaskResult(
      taskId: string,
      status: "completed" | "failed",
      result: CallToolResult,
    ): Promise<void>;
    getTaskResult(taskId: string): Promise<CallToolResult>;
  };
}
