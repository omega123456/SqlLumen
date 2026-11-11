import type { AiQueryExpandResponse } from '../../lib/ai-commands'

export interface PlaywrightAiChatFixture {
  fallbackStreamId: string
  responseText: string
  thinkingText: string
  errorMessage: string
}

export const AI_CHAT_FIXTURE: PlaywrightAiChatFixture = {
  fallbackStreamId: 'mock-stream-id',
  responseText:
    "Here's a query to help you:\n\n```sql\nSELECT * FROM users WHERE active = 1;\n```\n\nThis query filters for active users.",
  thinkingText: 'Let me analyze the database schema and find the best approach...',
  errorMessage: 'Connection refused: unable to reach AI endpoint',
}

export const AI_QUERY_EXPANSION: AiQueryExpandResponse = {
  text: '{"queries":["SELECT users","JOIN orders","user_id foreign key"],"hypotheticalSql":"SELECT u.* FROM `ecommerce_db`.`users` u JOIN `ecommerce_db`.`orders` o ON u.id = o.user_id","entities":["users","orders"],"joins":["users → orders"],"metrics":["count"]}',
}
