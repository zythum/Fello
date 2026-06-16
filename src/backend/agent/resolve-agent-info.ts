import { storageOps } from "../storage";
import type { AgentInfo } from "../../shared/schema";

export function resolveAgentInfo(agentId: string): AgentInfo {
  const settings = storageOps.getSettings();
  const agent = settings.agents.find((a) => a.id === agentId);
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}. Please check your settings.`);
  }
  if (agent.type === "stdio") {
    const command = agent.command.trim();
    if (!command) throw new Error(`Agent "${agent.id}" has no command configured.`);
    return { ...agent, command };
  }
  const provider = agent.provider.trim();
  const baseUrl = agent.baseUrl.trim();
  const apiKey = agent.apiKey.trim();
  if (!provider) throw new Error(`Agent "${agent.id}" has no provider configured.`);
  if (!baseUrl) throw new Error(`Agent "${agent.id}" has no baseUrl configured.`);
  if (!apiKey) throw new Error(`Agent "${agent.id}" has no apiKey configured.`);
  return { ...agent, provider, baseUrl, apiKey };
}
