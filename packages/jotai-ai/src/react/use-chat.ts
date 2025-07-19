// adapt and modified from https://github.com/vercel/ai/blob/v4/packages/react/src/use-chat.ts
// aligned commit: 6c59ae7d7162140fcf37fc6afbec4486e82c50bc (codebase, not for single file)
'use client';

import type { ReactNode } from 'react';
import {
  type ChatRequestOptions,
  type IdGenerator,
  type JSONValue,
  type Message,
  type UIMessage,
  type CreateMessage,
} from 'ai';
import type { MakeChatAtomsOptions, Handlers } from '../make-chat-atoms';

import {
  useCallback,
  createContext,
  useContext,
  createElement,
  useEffect,
} from 'react';

import { atom, useSetAtom } from 'jotai';
import { useAtom } from 'jotai-lazy';
import { RESET } from 'jotai/utils';

import { makeChatAtoms } from '../make-chat-atoms';

export type UseChatOptions = Pick<
  MakeChatAtomsOptions,
  | 'api'
  | 'id'
  | 'streamProtocol'
  | 'keepLastMessageOnError'
  | 'maxSteps'
  | 'sendExtraMessageFields'
  | 'experimental_prepareRequestBody'
> & {
  /**
   * Initial messages of the chat. Useful to load an existing chat history.
   */
  initialMessages?: UIMessage[];
  /**
   * Initial input of the chat.
   */
  initialInput?: string;
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

  /**
   * Resume an ongoing chat generation stream. This does not resume an aborted generation.
   */
  experimental_resume: () => void;

  /**
   * Function to add a tool result to the chat.
   * This will update the chat messages with the tool result and call the API route
   * if all tool results for the last message are available.
   */
  addToolResult: ({
    toolCallId,
    result,
  }: {
    toolCallId: string;
    result: any;
  }) => void;
};

export type UseChatReturn = {
  /**
   * The id of the chat.
   */
  id: string;

  /** Current messages in the chat */
  messages: UIMessage[];
  /**
   * Update the `messages` state locally. This is useful when you want to
   * edit the messages on the client, and then trigger the `reload` method
   * manually to regenerate the AI response.
   */
  setMessages: (
    messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[]),
  ) => void;

  /** The current value of the input */
  input: string;
  /** setState-powered method to update the input value */
  setInput: React.Dispatch<React.SetStateAction<string>>;
  /** An input/textarea-ready onChange handler to control the value of the input */
  handleInputChange: (
    e:
      | React.ChangeEvent<HTMLInputElement>
      | React.ChangeEvent<HTMLTextAreaElement>,
  ) => void;
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

  /**
   * Whether the API request is in progress
   *
   * @deprecated use `status` instead
   */
  isLoading: boolean;
  /**
   * Hook status:
   *
   * - `submitted`: The message has been sent to the API and we're awaiting the start of the response stream.
   * - `streaming`: The response is actively streaming in from the API, receiving chunks of data.
   * - `ready`: The full response has been received and processed; a new user message can be submitted.
   * - `error`: An error occurred during the API request, preventing successful completion.
   */
  status: 'submitted' | 'streaming' | 'ready' | 'error';

  /** The error object of the API request */
  error?: Error;
} & UseChatActions;

const messagesAtom = atom<UIMessage[]>([]);
const inputAtom = atom<string>('');

const defaultChatAtoms = makeChatAtoms({ messagesAtom });
const ChatAtomsContext = createContext<ReturnType<typeof makeChatAtoms> | null>(
  null,
);

/**
 * @internal
 */
const useChatAtoms = () => {
  const context = useContext(ChatAtomsContext);
  if (!context) {
    return defaultChatAtoms;
  }
  return context;
};

export const ChatAtomsProvider = ({
  children,
  value,
}: {
  value: ReturnType<typeof makeChatAtoms>;
  children: ReactNode;
}) => {
  return createElement(ChatAtomsContext.Provider, {
    value,
    children,
  });
};

export const useChat = (opts: UseChatOptions = {}): UseChatReturn => {
  const {
    chatIdAtom,

    appendAtom,
    streamDataAtom,
    errorAtom,
    isLoadingAtom,
    statusAtom,

    reloadAtom,
    stopAtom,
    addToolResultAtom,
    resumeAtom,

    onErrorAtom,
    onResponseAtom,
    onFinishAtom,
    onToolCallAtom,

    prepareRequestBodyAtom,
    sendExtraMessageFieldsAtom,
    streamProtocolAtom,
    keepLastMessageonErrorAtom,
    maxStepsAtom,
  } = useChatAtoms();

  const [chatId, setChatId] = useAtom(chatIdAtom);

  const inputObject = useAtom(inputAtom);
  const messagesObject = useAtom(messagesAtom);

  const dataObject = useAtom(streamDataAtom);
  const isLoadingObject = useAtom(isLoadingAtom);
  const errorObject = useAtom(errorAtom);
  const statusObject = useAtom(statusAtom);

  const append = useSetAtom(appendAtom);
  const reload = useSetAtom(reloadAtom);
  const stop = useSetAtom(stopAtom);
  const addToolResult = useSetAtom(addToolResultAtom);
  const resume = useSetAtom(resumeAtom);

  const setOnFinish = useSetAtom(onFinishAtom);
  if (opts.onFinish) setOnFinish({ fn: opts.onFinish });
  else setOnFinish(RESET);

  const setOnReponse = useSetAtom(onResponseAtom);
  if (opts.onResponse) setOnReponse({ fn: opts.onResponse });
  else setOnReponse(RESET);

  const setOnToolCall = useSetAtom(onToolCallAtom);
  if (opts.onToolCall) setOnToolCall({ fn: opts.onToolCall });
  else setOnToolCall(RESET);

  const setOnError = useSetAtom(onErrorAtom);
  if (opts.onError) setOnError({ fn: opts.onError });
  else setOnError(RESET);

  const setStreamProtocol = useSetAtom(streamProtocolAtom);
  if (opts.streamProtocol) setStreamProtocol(opts.streamProtocol);
  else setStreamProtocol(RESET);

  const setMaxSteps = useSetAtom(maxStepsAtom);
  if (opts.maxSteps) setMaxSteps(opts.maxSteps);
  else setMaxSteps(RESET);

  const setKeepLastMessageonErrorAtom = useSetAtom(keepLastMessageonErrorAtom);
  if (opts.keepLastMessageOnError)
    setKeepLastMessageonErrorAtom(opts.keepLastMessageOnError);
  else setKeepLastMessageonErrorAtom(RESET);

  const setSendExtraMessageFields = useSetAtom(sendExtraMessageFieldsAtom);
  if (opts.sendExtraMessageFields)
    setSendExtraMessageFields(opts.sendExtraMessageFields);
  else setSendExtraMessageFields(RESET);

  const setPrepareRequestBody = useSetAtom(prepareRequestBodyAtom);
  if (opts.experimental_prepareRequestBody)
    setPrepareRequestBody({ fn: opts.experimental_prepareRequestBody });
  else setPrepareRequestBody(RESET);

  // useEffect(() => {
  //   if (opts.onFinish) setOnFinish({ fn: opts.onFinish });
  // }, [opts.onFinish, setOnFinish]);

  // useEffect(() => {
  //   if (opts.onResponse) setOnReponse({ fn: opts.onResponse });
  // }, [opts.onResponse, setOnReponse]);

  // useEffect(() => {
  //   if (opts.onToolCall) setOnToolCall({ fn: opts.onToolCall });
  // }, [opts.onToolCall, setOnToolCall]);

  // useEffect(() => {
  //   if (opts.onError) setOnError({ fn: opts.onError });
  // }, [opts.onError, setOnError]);

  // // // Handle id changes and reset messages
  // // useEffect(() => {
  // //   if (opts.id) {
  // //     setChatId(opts.id);
  // //   }
  // // }, [opts.id, chatId, setChatId]);

  // // // Handle initialMessages changes
  // // useEffect(() => {
  // //   if (opts.initialMessages) {
  // //     messagesObject[1](opts.initialMessages);
  // //   }
  // // }, [opts.initialMessages, messagesObject]);

  const handleSubmit = useCallback(
    (
      event?: { preventDefault?: () => void },
      options: ChatRequestOptions = {},
      _metadata?: object,
    ) => {
      const input = inputObject[0];
      const setInput = inputObject[1];
      event?.preventDefault?.();
      if (!input && !options.allowEmptySubmit) return;

      const userMessage = {
        content: input,
        role: 'user' as const,
      };
      append(userMessage, options).catch((_error: Error) => {
        // TODO: not implemented
      });
      setInput('');
    },
    [inputObject, append],
  );
  const handleInputChange = (e: any) => {
    const setInput = inputObject[1];
    setInput(e.target.value);
  };

  return {
    id: opts.id ?? chatId,

    // state
    get isLoading() {
      return isLoadingObject[0];
    },
    // firstTokenReceived,
    get error() {
      return errorObject[0];
    },
    get status() {
      return statusObject[0];
    },

    // user interface
    get messages() {
      return messagesObject[0];
    },
    setMessages: messagesObject[1],
    get data() {
      return dataObject[0];
    },
    setData: dataObject[1],

    get input() {
      return inputObject[0];
    },
    setInput: inputObject[1],
    handleInputChange,
    handleSubmit,

    addToolResult,
    append,
    reload,
    stop,
    experimental_resume: resume,
  };
};

const {
  // data containers,
  isLoadingAtom,
  errorAtom,
  streamDataAtom,

  // actions
  stopAtom,
  appendAtom,
  reloadAtom,

  // handlers
  onErrorAtom,
  onResponseAtom,
  onToolCallAtom,
  onFinishAtom,
} = defaultChatAtoms;

export {
  appendAtom,
  streamDataAtom,
  errorAtom,
  isLoadingAtom,
  messagesAtom,
  onErrorAtom,
  onFinishAtom,
  onResponseAtom,
  onToolCallAtom,
  reloadAtom,
  stopAtom,
};
