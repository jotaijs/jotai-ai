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
    messages: UIMessage[] | ((UIMessages: UIMessage[]) => UIMessage[]),
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

  const append = useSetAtom(appendAtom);
  const reload = useSetAtom(reloadAtom);
  const stop = useSetAtom(stopAtom);
  const addToolResult = useSetAtom(addToolResultAtom);
  const resume = useSetAtom(resumeAtom);

  const setOnFinish = useSetAtom(onFinishAtom);
  const setOnReponse = useSetAtom(onResponseAtom);
  const setOnToolCall = useSetAtom(onToolCallAtom);
  const setOnError = useSetAtom(onErrorAtom);

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

  useEffect(() => {
    if (opts.onFinish) setOnFinish({ fn: opts.onFinish });
  }, [opts.onFinish, setOnFinish]);

  useEffect(() => {
    if (opts.onResponse) setOnReponse({ fn: opts.onResponse });
  }, [opts.onResponse, setOnReponse]);

  useEffect(() => {
    if (opts.onToolCall) setOnToolCall({ fn: opts.onToolCall });
  }, [opts.onToolCall, setOnToolCall]);

  useEffect(() => {
    if (opts.onError) setOnError({ fn: opts.onError });
  }, [opts.onError, setOnError]);

  // Handle id changes
  useEffect(() => {
    if (opts.id) setChatId(opts.id);
  }, [opts.id, chatId, setChatId]);

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
