import { atom, type Getter, type Setter } from "jotai/vanilla";
import {
  type ChatRequest,
  type ChatRequestOptions,
  type CreateMessage,
  callChatApi,
  processChatStream,
  type JSONValue,
  type Message,
  type UseChatOptions,
} from "@ai-sdk/ui-utils";
import {
  countTrailingAssistantMessages,
  isAssistantMessageWithCompletedToolCalls,
  isPromiseLike,
} from "./utils";
import type { FormEvent } from "react";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import { generateId as generateIdImpl } from "@ai-sdk/provider-utils";

export function chatAtoms(
  chatOptions: Omit<
    UseChatOptions,
    | "onFinish"
    | "onResponse"
    | "onError"
    | "experimental_onFunctionCall"
    | "initialMessages"
  > & {
    onFinish?: (get: Getter, set: Setter, message: Message) => void;
    onResponse?: (
      get: Getter,
      set: Setter,
      response: Response,
    ) => void | Promise<void>;
    onError?: (get: Getter, set: Setter, error: Error) => void;
    maxToolRoundtrips?: number;

    /**
     * Experimental (React only). When a function is provided, it will be used
     * to prepare the request body for the chat API. This can be useful for
     * customizing the request body based on the messages and data in the chat.
     *
     * @param messages The current messages in the chat.
     * @param requestData The data object passed in the chat request.
     * @param requestBody The request body object passed in the chat request.
     */
    experimental_prepareRequestBody?: (
      get: Getter,
      set: Setter,
      options: {
        messages: Message[];
        requestData?: JSONValue;
        requestBody?: object;
      },
    ) => Record<string, any>;

    experimental_onFunctionCall?: (
      get: Getter,
      set: Setter,
      ...args: Parameters<
        Required<UseChatOptions>["experimental_onFunctionCall"]
      >
    ) => ReturnType<Required<UseChatOptions>["experimental_onFunctionCall"]>;
    // if you pass async function or promise, you will need a suspense boundary
    initialMessages?:
      | Message[]
      | Promise<Message[]>
      | (() => Message[] | Promise<Message[]>);
  } = {},
) {
  const api = chatOptions.api || "/api/chat";
  const sendExtraMessageFields = chatOptions.sendExtraMessageFields || false;
  const initialMessages = chatOptions.initialMessages || [];
  const maxToolRoundtrips = chatOptions.maxToolRoundtrips || 0;
  const generateId = chatOptions.generateId || generateIdImpl;

  const primitiveMessagesAtom = atom<Message[] | Promise<Message[]> | null>(
    typeof initialMessages === "function" ? null : initialMessages,
  );
  const messagesAtom = atom<
    Message[] | Promise<Message[]>,
    [messages: Message[] | Promise<Message[]>],
    void
  >(
    (get) => {
      const messages = get(primitiveMessagesAtom);
      if (messages === null) {
        return (initialMessages as () => Message[] | Promise<Message[]>)();
      } else {
        return messages;
      }
    },
    (_get, set, messages) => {
      set(primitiveMessagesAtom, messages);
    },
  );
  const dataAtom = atom<JSONValue[] | undefined>(undefined);
  const inputBaseAtom = atom(chatOptions.initialInput || "");

  const abortControllerAtom = atom<AbortController>(new AbortController());
  const isLoadingAtom = atom(false);

  type Metadata = {
    fetch?: FetchFunction;
    streamProtocol?: "data" | "text" | undefined;
    credentials?: RequestCredentials;
    headers?: HeadersInit;
    body?: Record<string, any>;
  };

  const metadataAtom = atom<Metadata>({
    fetch: chatOptions.fetch,
    streamProtocol: chatOptions.streamProtocol,
    credentials: chatOptions.credentials,
    headers: chatOptions.headers,
    body: chatOptions.body,
  });

  async function getStreamedResponse(
    get: Getter,
    set: Setter,
    chatRequest: ChatRequest,
  ) {
    // Do an optimistic update to the chat state to show the updated messages immediately:
    set(messagesAtom, chatRequest.messages);

    const constructedMessagesPayload = sendExtraMessageFields
      ? chatRequest.messages
      : chatRequest.messages.map(
          ({
            role,
            content,
            experimental_attachments,
            name,
            data,
            annotations,
            toolInvocations,
            function_call,
            tool_calls,
            tool_call_id,
          }) => ({
            role,
            content,
            ...(experimental_attachments !== undefined && {
              experimental_attachments,
            }),
            ...(name !== undefined && { name }),
            ...(data !== undefined && { data }),
            ...(annotations !== undefined && { annotations }),
            ...(toolInvocations !== undefined && { toolInvocations }),
            // outdated function/tool call handling (TODO deprecate):
            tool_call_id,
            ...(function_call !== undefined && { function_call }),
            ...(tool_calls !== undefined && { tool_calls }),
          }),
        );
    const metadata = get(metadataAtom);
    return callChatApi({
      api,
      abortController: () => get(abortControllerAtom),
      body: chatOptions.experimental_prepareRequestBody?.(get, set, {
        messages: chatRequest.messages,
        requestData: chatRequest.data,
        requestBody: chatRequest.body,
      }) ?? {
        messages: constructedMessagesPayload,
        data: chatRequest.data,
        ...metadata.body,
        ...chatRequest.body,
        ...(chatRequest.functions !== undefined && {
          functions: chatRequest.functions,
        }),
        ...(chatRequest.function_call !== undefined && {
          function_call: chatRequest.function_call,
        }),
        ...(chatRequest.tools !== undefined && {
          tools: chatRequest.tools,
        }),
        ...(chatRequest.tool_choice !== undefined && {
          tool_choice: chatRequest.tool_choice,
        }),
      },
      streamProtocol: metadata.streamProtocol,
      headers: {
        ...metadata.headers,
        ...chatRequest.options?.headers,
      },
      credentials: metadata.credentials,
      onResponse: (response) => chatOptions.onResponse?.(get, set, response),
      restoreMessagesOnFailure: () => {},
      onFinish: (message) => chatOptions.onFinish?.(get, set, message),
      fetch: metadata.fetch,
      onToolCall: chatOptions.onToolCall,
      onUpdate: (merged: Message[], data: JSONValue[] | undefined): void => {
        set(messagesAtom, [...chatRequest.messages, ...merged]);
        set(dataAtom, (existingData) => [
          ...(existingData ?? []),
          ...(data ?? []),
        ]);
      },
      generateId,
    });
  }

  async function triggerRequest(
    get: Getter,
    set: Setter,
    chatRequest: ChatRequest,
  ) {
    // ensure messages are loaded before sending the request
    await get(messagesAtom);

    const messageCount = chatRequest.messages.length;
    try {
      set(isLoadingAtom, true);
      const abortController = new AbortController();
      set(abortControllerAtom, abortController);

      const experimental_onFunctionCall =
        chatOptions.experimental_onFunctionCall;
      await processChatStream({
        getStreamedResponse: () => getStreamedResponse(get, set, chatRequest),
        getCurrentMessages(): Message[] {
          const messages = get(messagesAtom);
          if (messages instanceof Promise) {
            throw new Error(
              "Cannot get current messages while messages are still loading",
            );
          }
          return messages;
        },
        experimental_onFunctionCall: experimental_onFunctionCall
          ? (chatMessages, functionCall) => {
              return experimental_onFunctionCall(
                get,
                set,
                chatMessages,
                functionCall,
              );
            }
          : undefined,
        updateChatRequest(chatRequestParam: ChatRequest): void {
          chatRequest = chatRequestParam;
        },
      });
    } catch (err) {
      // Ignore abort errors as they are expected.
      if ((err as any).name === "AbortError") {
        set(abortControllerAtom, new AbortController());
        return null;
      }

      if (onError && err instanceof Error) {
        onError(get, set, err);
      }
    } finally {
      set(isLoadingAtom, false);
    }

    // auto-submit when all tool calls in the last assistant message have results:
    const messages = await get(messagesAtom);
    const lastMessage = messages[messageCount - 1];
    if (
      // ensure we actually have new messages (to prevent infinite loops in case of errors):
      messages.length > messageCount &&
      // ensure there is a last message:
      lastMessage != null &&
      // check if the feature is enabled:
      maxToolRoundtrips > 0 &&
      // check that roundtrip is possible:
      isAssistantMessageWithCompletedToolCalls(lastMessage) &&
      // limit the number of automatic roundtrips:
      countTrailingAssistantMessages(messages) <= maxToolRoundtrips
    ) {
      await triggerRequest(get, set, {
        messages: messages,
      });
    }
  }

  async function append(
    get: Getter,
    set: Setter,
    message: Message | CreateMessage,
    {
      options,
      functions,
      function_call,
      tools,
      tool_choice,
      data,
      headers,
      body,
    }: ChatRequestOptions = {},
  ) {
    if (!message.id) {
      message.id = generateId();
    }

    const requestOptions = {
      headers: headers ?? options?.headers,
      body: body ?? options?.body,
    };

    const messages = await get(messagesAtom);

    const chatRequest: ChatRequest = {
      messages: messages.concat(message as Message),
      options: requestOptions,
      headers: requestOptions.headers,
      body: requestOptions.body,
      data,
      ...(functions !== undefined && { functions }),
      ...(function_call !== undefined && { function_call }),
      ...(tools !== undefined && { tools }),
      ...(tool_choice !== undefined && { tool_choice }),
    };

    return triggerRequest(get, set, chatRequest);
  }

  function onError(get: Getter, set: Setter, error: Error) {
    if (chatOptions.onError) {
      chatOptions.onError(get, set, error);
    } else {
      throw error;
    }
  }

  // user side atoms
  return {
    messagesAtom: atom(
      (get) => get(messagesAtom),
      async (get, set, messages: Message[]): Promise<void> => {
        const prevMessages = get(messagesAtom);
        if (isPromiseLike(prevMessages)) {
          set(
            messagesAtom,
            prevMessages.then(() => messages),
          );
        } else {
          set(messagesAtom, messages);
        }
      },
    ),
    dataAtom: atom((get) => get(dataAtom)),
    isLoadingAtom: atom((get) => get(isLoadingAtom)),
    isPendingAtom: atom((get) => {
      const messages = get(messagesAtom);
      if (isPromiseLike(messages)) {
        return messages.then(
          (messages) => messages.at(-1)?.role !== "assistant",
        );
      }
      return messages.at(-1)?.role !== "assistant";
    }),
    inputAtom: atom(
      (get) => get(inputBaseAtom),
      (
        _get,
        set,
        event: {
          target: {
            value: string;
          };
        },
      ) => {
        set(inputBaseAtom, event.target.value);
      },
    ),
    submitAtom: atom(
      (get) => get(isLoadingAtom),
      (
        get,
        set,
        e: FormEvent<HTMLFormElement>,
        options: ChatRequestOptions = {},
        metadata?: Object,
      ) => {
        if (metadata) {
          set(metadataAtom, (prevMetadata) => ({
            ...prevMetadata,
            ...metadata,
          }));
        }
        e.preventDefault();
        const input = get(inputBaseAtom);
        if (!input) return;
        const promise = append(
          get,
          set,
          {
            content: input,
            role: "user",
            createdAt: new Date(),
          },
          options,
        ).catch((err) => onError(get, set, err));
        // clear input
        set(inputBaseAtom, "");
        return promise;
      },
    ),
    reloadAtom: atom(
      null,
      async (
        get,
        set,
        {
          options,
          functions,
          function_call,
          tools,
          tool_choice,
          data,
          headers,
          body,
        }: ChatRequestOptions = {},
      ) => {
        const messages = await get(messagesAtom);
        if (messages.length === 0) return null;

        const requestOptions = {
          headers: headers ?? options?.headers,
          body: body ?? options?.body,
        };

        // Remove the last assistant message and retry the last user message.
        const lastMessage = messages[messages.length - 1];
        if (lastMessage!.role === "assistant") {
          const chatRequest: ChatRequest = {
            messages: messages.slice(0, -1),
            options: requestOptions,
            headers: requestOptions.headers,
            body: requestOptions.body,
            data,
            ...(functions !== undefined && { functions }),
            ...(function_call !== undefined && { function_call }),
            ...(tools !== undefined && { tools }),
            ...(tool_choice !== undefined && { tool_choice }),
          };

          return triggerRequest(get, set, chatRequest);
        }

        const chatRequest: ChatRequest = {
          messages,
          options: requestOptions,
          headers: requestOptions.headers,
          body: requestOptions.body,
          data,
          ...(functions !== undefined && { functions }),
          ...(function_call !== undefined && { function_call }),
          ...(tools !== undefined && { tools }),
          ...(tool_choice !== undefined && { tool_choice }),
        };

        return triggerRequest(get, set, chatRequest);
      },
    ),
    stopAtom: atom(null, (get) => {
      get(abortControllerAtom).abort();
    }),
  };
}
