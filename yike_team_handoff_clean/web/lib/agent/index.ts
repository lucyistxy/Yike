import type { AgentGateway } from "../contracts/v1";
import { canUseHttpAgentGateway, HttpAgentGateway } from "./http-gateway";
import { MockAgentGateway } from "./mock-gateway";

export function createAgentGateway(): AgentGateway {
  return canUseHttpAgentGateway() ? new HttpAgentGateway() : new MockAgentGateway();
}

export const agentGateway: AgentGateway = createAgentGateway();

// 真实服务接入点：在这里按环境变量替换为 HttpAgentGateway，页面无需改动。
export { HttpAgentGateway, MockAgentGateway };
