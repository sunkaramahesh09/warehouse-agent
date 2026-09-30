import { executeTool, type Tool, type ToolCtx, type ToolResult } from './framework.js';
import * as read from './read-tools.js';
import * as act from './action-tools.js';
import * as plan from './planner-tools.js';

export const TOOLS: Record<string, Tool> = Object.fromEntries(
  [
    ...read.INVESTIGATION_TOOLS, read.getPickerStatus, read.getCurrentPlan,
    act.holdOrder, act.syncOrderStatus, act.requestApproval, act.decideApproval, act.executeApprovedAction,
    act.createEscalation, act.updateExceptionStatus, act.resolveEscalation,
    plan.generatePlan, plan.setPickerAvailability, plan.injectUrgentOrder, plan.adjustInventorySim, plan.injectFault, plan.advanceClock,
  ].map((t) => [t.name, t as Tool]),
);

/** Invoke a registered tool by name through the controlled pipeline. */
export function callTool<T = any>(name: string, input: unknown, ctx: ToolCtx): Promise<ToolResult<T>> {
  const tool = TOOLS[name];
  if (!tool) return Promise.resolve({ success: false, error: { code: 'UNKNOWN_TOOL', message: `No tool named ${name}` } });
  return executeTool(tool, input, ctx) as Promise<ToolResult<T>>;
}

export type { ToolCtx, ToolResult };
