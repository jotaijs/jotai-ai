import type {
  ChatRequestOptions,
  CreateMessage,
  IdGenerator,
  JSONValue,
  Message,
} from 'ai';
import type { Handlers } from '../make-chat-atoms';

import { useCallback } from 'react';

import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai';

import { makeChatAtoms } from '../make-chat-atoms';

export type UseChatOptions = {
  /**
   * The API endpoint that accepts a `{ messages: Message[] }` object and returns
   * a stream of tokens of the AI chat response. Defaults to `/api/chat`.
   */
  api?: string;
  /**
   * A unique identifier for the chat. If not provided, a random one will be
   * generated. When provided, the `useChat` hook with the same `id` will
   * have shared states across components.
   */
  id?: string;
  /**
   * Initial messages of the chat. Useful to load an existing chat history.
   */
  initialMessages?: Message[];
  /**
   * Initial input of the chat.
   */
  initialInput?: string;

  /**
   * Keeps the last message when an error happens. This will be the default behavior
   * starting with the next major release.
   * The flag was introduced for backwards compatibility and currently defaults to `false`.
   * Please enable it and update your error handling/resubmit behavior.
   */
  keepLastMessageOnError?: boolean;
  /**
   * Maximum number of sequential LLM calls (steps), e.g. when you use tool calls. Must be at least 1.
   *
   * A maximum number is required to prevent infinite loops in the case of misconfigured tools.
   *
   * By default, it's set to 1, which means that only a single LLM call is made.
   */
  maxSteps?: number;
  /**
   * A way to provide a function that is going to be used for ids for messages.
   * If not provided the default AI SDK `generateId` is used.
   */
  generateId?: IdGenerator;
  /**
   * Experimental (React only). When a function is provided, it will be used
   * to prepare the request body for the chat API. This can be useful for
   * customizing the request body based on the messages and data in the chat.
   *
   * @param messages The current messages in the chat.
   * @param requestData The data object passed in the chat request.
   * @param requestBody The request body object passed in the chat request.
   */
  experimental_prepareRequestBody?: (options: {
    messages: Message[];
    requestData?: JSONValue;
    requestBody?: object;
  }) => JSONValue;
} & Handlers;

type UseChatActions = {
  /**
   * Append a user message to the chat list. This triggers the API call to fetch
   * the assistant's response.
   * @param message The message to append
   * @param options Additional options to pass to the API call
   */
  append: (
    message: Message | CreateMessage,
    options?: ChatRequestOptions,
  ) => void;
  /**
   * Reload the last AI chat response for the given chat history. If the last
   * message isn't from the assistant, it will request the API to generate a
   * new response.
   */
  reload: (options?: ChatRequestOptions) => void;
  /**
   * Abort the current request immediately, keep the generated tokens if any.
   */
  stop: () => void;
};

export type UseChatReturn = {
  /** Current messages in the chat */
  messages: Message[];
  /**
   * Update the `messages` state locally. This is useful when you want to
   * edit the messages on the client, and then trigger the `reload` method
   * manually to regenerate the AI response.
   */
  setMessages: (
    messages: Message[] | ((messages: Message[]) => Message[]),
  ) => void;
  /** The current value of the input */
  input: string;
  /** setState-powered method to update the input value */
  setInput: React.Dispatch<React.SetStateAction<string>>;
  /** An input/textarea-ready onChange handler to control the value of the input */
  // handleInputChange: (
  //   e:
  //     | React.ChangeEvent<HTMLInputElement>
  //     | React.ChangeEvent<HTMLTextAreaElement>,
  // ) => void
  /** Form submission handler to automatically reset input and append a user message */
  handleSubmit: (
    event?: { preventDefault?: () => void },
    chatRequestOptions?: ChatRequestOptions,
  ) => void;
  metadata?: object;
  /** Additional data added on the server via StreamData. */
  data?: JSONValue[];
  /**
   * Set the data of the chat. You can use this to transform or clear the chat data.
   *
   * TODO: add to docs, the signature of function is not the same with upstream (vercel/ai)
   */
  setData: (data?: JSONValue[]) => void;

  /** Whether the API request is in progress */
  isLoading: boolean;
  /** The error object of the API request */
  error?: Error;
  /**
   * Append a user message to the chat list. This triggers the API call to fetch
   * the assistant's response.
   * @param message The message to append
   * @param options Additional options to pass to the API call
   */
} & UseChatActions;

const messagesAtom = atom<Message[]>([]);
const inputAtom = atom<string>('');

export const {
  // data containers,
  isLoadingAtom,
  errorAtom,
  dataAtom,

  // actions
  stopAtom,
  appendAtom,
  reloadAtom,

  // handlers
  onErrorAtom,
  onResponseAtom,
  onToolCallAtom,
  onFinishAtom,
} = makeChatAtoms({
  messagesAtom,
});

export const useChat = (opts: UseChatOptions): UseChatReturn => {
  const [input, setInput] = useAtom(inputAtom);
  const [messages, setMessages] = useAtom(messagesAtom);

  const [data, setData] = useAtom(dataAtom);
  const isLoading = useAtomValue(isLoadingAtom);
  const error = useAtomValue(errorAtom);

  const append = useSetAtom(appendAtom);
  const reload = useSetAtom(reloadAtom);
  const stop = useSetAtom(stopAtom);

  const setOnFinish = useSetAtom(onFinishAtom);
  const setOnReponse = useSetAtom(onResponseAtom);
  const setOnToolCall = useSetAtom(onToolCallAtom);
  const setOnError = useSetAtom(onErrorAtom);

  if (opts.onFinish) setOnFinish(opts.onFinish);
  if (opts.onResponse) setOnReponse(opts.onResponse);
  if (opts.onToolCall) setOnToolCall(opts.onToolCall);
  if (opts.onError) setOnError(opts.onError);

  const handleSubmit = useCallback(
    (
      event?: { preventDefault?: () => void },
      options: ChatRequestOptions = {},
      metadata?: object,
    ) => {
      event?.preventDefault?.();
      if (!input && !options.allowEmptySubmit) return;

      const userMessage = {
        content: input,
        role: 'user' as const,
      };
      append(userMessage, options).catch((error: Error) => {
        // TODO: not implemented
        console.error(error);
      });
      setInput('');
    },
    [input],
  );

  return {
    // state
    isLoading,
    // firstTokenReceived,
    error,

    //
    messages,
    setMessages,
    data,
    setData,

    input,
    setInput,
    handleSubmit,

    //
    append,
    reload,
    stop,
  };
};
