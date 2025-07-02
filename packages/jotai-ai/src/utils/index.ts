import type { Attachment, Message } from '@ai-sdk/ui-utils';
import { generateId as defaultGenerateId } from '@ai-sdk/ui-utils';
import {
  type CoreMessage,
  type CoreToolMessage,
  type ToolInvocation,
} from 'ai';

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

// Modified from https://github.com/vercel/ai-chatbot/blob/e6806aaa542c831e874681a50df39fe26c59d25e/lib/utils.ts
export function convertToUIMessages(
  messages: (CoreMessage & { id?: string })[],
  opts: {
    generateId?: () => string;
  } = {},
): Message[] {
  const generateId = opts.generateId ?? defaultGenerateId;

  return messages.reduce((chatMessages: Message[], message) => {
    if (message.role === 'tool') {
      return addToolMessageToChat({
        toolMessage: message,
        messages: chatMessages,
      });
    }

    let textContent = '';
    const toolInvocations: ToolInvocation[] = [];

    if (typeof message.content === 'string') {
      textContent = message.content;
    } else if (Array.isArray(message.content)) {
      for (const content of message.content) {
        if (content.type === 'text') {
          textContent += content.text;
        } else if (content.type === 'tool-call') {
          toolInvocations.push({
            state: 'call',
            toolCallId: content.toolCallId,
            toolName: content.toolName,
            args: content.args,
          });
        }
      }
    }

    chatMessages.push({
      ...message,
      id: message.id ?? generateId(),
      role: message.role,
      content: textContent,
      toolInvocations,
    });

    return chatMessages;
  }, []);
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
 Returns the number of trailing assistant messages in the array.
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

export async function prepareAttachmentsForRequest(
  attachmentsFromOptions: FileList | Attachment[] | undefined,
) {
  if (attachmentsFromOptions == null) {
    return [];
  }

  if (attachmentsFromOptions instanceof FileList) {
    return Promise.all(
      Array.from(attachmentsFromOptions).map(async attachment => {
        const { name, type } = attachment;

        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = readerEvent => {
            resolve(readerEvent.target?.result as string);
          };
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          reader.onerror = error => reject(error);
          reader.readAsDataURL(attachment);
        });

        return {
          name,
          contentType: type,
          url: dataUrl,
        };
      }),
    );
  }

  if (Array.isArray(attachmentsFromOptions)) {
    return attachmentsFromOptions;
  }

  throw new Error('Invalid attachments type');
}
