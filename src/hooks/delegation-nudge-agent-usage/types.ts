export interface AgentUsageState {
  sessionID: string;
  agentUsed: boolean;
  reminderShown: boolean;
  reminderCount: number;
  updatedAt: number;
}
