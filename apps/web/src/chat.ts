import { KotikClient } from '@kotik/client'

export interface ChatStreamHandlers {
  onReasoning(delta: string): void
  onAnswer(delta: string): void
}

export async function streamChat(
  question: string,
  signal: AbortSignal,
  handlers: ChatStreamHandlers,
): Promise<void> {
  const gateway = window.kotik?.getGatewayConfig()
  const client = new KotikClient({
    baseUrl: gateway?.baseUrl,
    accessToken: gateway?.accessToken,
  })
  const session = await client.createSession({ ephemeral: true, signal })

  for await (const event of client.streamTurn(session.id, question, signal)) {
    if (event.type === 'reasoning.delta') {
      handlers.onReasoning(event.delta)
    } else if (event.type === 'answer.delta') {
      handlers.onAnswer(event.delta)
    }
  }
}
