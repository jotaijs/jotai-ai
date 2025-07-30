import type { Message } from '@ai-sdk/ui-utils';

export { generateId } from '@ai-sdk/ui-utils';

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

/**
 Check if the message is an assistant message with completed tool calls.
 The message must have at least one tool invocation and all tool invocations
 must have a result.
 */
export function isAssistantMessageWithCompletedToolCalls(message: Message) {
  const toolInvocationParts = message.parts?.filter(
    part => part.type === 'tool-invocation',
  );
  return (
    message.role === 'assistant' &&
    toolInvocationParts &&
    toolInvocationParts.length > 0 &&
    toolInvocationParts.every(part => part.toolInvocation.state === 'result')
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
