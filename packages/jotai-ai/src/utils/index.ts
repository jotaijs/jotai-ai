import type { Message } from '@ai-sdk/ui-utils';
import type { CoreToolMessage } from 'ai';

import { generateId as defaultGenerateId } from '@ai-sdk/ui-utils';

export { defaultGenerateId };

export const isPromiseLike = (
  value: unknown,
): value is PromiseLike<unknown> => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  );
};

// Modified from https://github.com/vercel/ai-chatbot/blob/e6806aaa542c831e874681a50df39fe26c59d25e/lib/utils.ts
export function addToolMessageToChat({
  toolMessage,
  messages,
}: {
  toolMessage: CoreToolMessage;
  messages: Message[];
}): Message[] {
  return messages.map(message => {
    if (message.toolInvocations) {
      return {
        ...message,
        toolInvocations: message.toolInvocations.map(toolInvocation => {
          const toolResult = toolMessage.content.find(
            tool => tool.toolCallId === toolInvocation.toolCallId,
          );

          if (toolResult) {
            return {
              ...toolInvocation,
              state: 'result',
              result: toolResult.result,
            };
          }

          return toolInvocation;
        }),
      };
    }

    return message;
  });
}

/**
 Check if the message is an assistant message with completed tool calls.
 The message must have at least one tool invocation and all tool invocations
 must have a result.
 */
export function isAssistantMessageWithCompletedToolCalls(message: Message) {
  return (
    message.role === 'assistant' &&
    message.toolInvocations &&
    message.toolInvocations.length > 0 &&
    message.toolInvocations.every(toolInvocation => 'result' in toolInvocation)
  );
}

/**
 * Returns the number of trailing assistant messages in the array.
 */
export function countTrailingAssistantMessages(messages: Message[]) {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'assistant') {
      count++;
    } else {
      break;
    }
  }
  return count;
}
