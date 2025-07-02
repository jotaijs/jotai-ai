/* eslint-disable @eslint-react/dom/no-missing-button-type */
import type { Message } from '@ai-sdk/ui-utils';

import React from 'react';

import { formatDataStreamPart, generateId } from 'ai';

import { withTestServer } from '@ai-sdk/provider-utils/test';
import '@testing-library/jest-dom/vitest';
import { cleanup, findByText, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChat } from './use-chat';

// adapt and modified from https://github.com/vercel/ai/blob/main/packages/react/src/use-chat.ui.test.tsx
describe('data protocol stream', () => {
  let onFinishCalls: {
    message: Message;
    options: {
      finishReason: string;
      usage: {
        completionTokens: number;
        promptTokens: number;
        totalTokens: number;
      };
    };
  }[] = [];

  const TestComponent = ({ id: idParam }: { id: string }) => {
    const [id, setId] = React.useState<string>(idParam);
    const { messages, append, error, isLoading, data, setData } = useChat({
      id,
      onFinish: (message, options) => {
        onFinishCalls.push({ message, options });
      },
    });

    return (
      <div>
        <div data-testid="loading">{isLoading.toString()}</div>
        {error && <div data-testid="error">{error.toString()}</div>}
        <div data-testid="data">{data != null ? JSON.stringify(data) : ''}</div>
        {messages.map((m, idx) => (
          <div data-testid={`message-${idx}`} key={m.id}>
            {m.role === 'user' ? 'User: ' : 'AI: '}
            {m.content}
          </div>
        ))}
        <button
          type="button"
          data-testid="do-append"
          onClick={() => {
            append({ role: 'user' as const, content: 'hi' });
          }}
        />
        <button
          type="button"
          data-testid="do-change-id"
          onClick={() => {
            setId('second-id');
          }}
        />
        <button
          type="button"
          data-testid="do-set-data"
          onClick={() => {
            setData([{ t1: 'set' }]);
          }}
        />
        <button
          type="button"
          data-testid="do-clear-data"
          onClick={() => {
            setData(undefined);
          }}
        />
      </div>
    );
  };

  beforeEach(() => {
    // use a random id to avoid conflicts:
    render(<TestComponent id={`first-id-${generateId()}`} />);
    onFinishCalls = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    onFinishCalls = [];
  });

  it(
    'should show streamed response',
    withTestServer(
      {
        type: 'stream-values',
        url: '/api/chat',
        content: ['0:"Hello"\n', '0:","\n', '0:" world"\n', '0:"."\n'],
      },
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        await userEvent.click(screen.getByTestId('do-append'));

        await screen.findByTestId('message-0');
        expect(screen.getByTestId('message-0')).toHaveTextContent('User: hi');

        await screen.findByTestId('message-1');
        expect(screen.getByTestId('message-1')).toHaveTextContent(
          'AI: Hello, world.',
        );
      },
    ),
  );

  it(
    'should set stream data',
    withTestServer(
      {
        type: 'stream-values',
        url: '/api/chat',
        content: ['2:[{"t1":"v1"}]\n', '0:"Hello"\n'],
      },
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        await userEvent.click(screen.getByTestId('do-append'));

        await screen.findByTestId('data');
        expect(screen.getByTestId('data')).toHaveTextContent('[{"t1":"v1"}]');

        await screen.findByTestId('message-1');
        expect(screen.getByTestId('message-1')).toHaveTextContent('AI: Hello');
      },
    ),
  );

  describe('setData', () => {
    it('should set data', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      await userEvent.click(screen.getByTestId('do-set-data'));

      await screen.findByTestId('data');
      expect(screen.getByTestId('data')).toHaveTextContent('[{"t1":"set"}]');
    });

    it(
      'should clear data',
      withTestServer(
        {
          type: 'stream-values',
          url: '/api/chat',
          content: ['2:[{"t1":"v1"}]\n', '0:"Hello"\n'],
        },
        async () => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          await userEvent.click(screen.getByTestId('do-append'));

          await screen.findByTestId('data');
          expect(screen.getByTestId('data')).toHaveTextContent('[{"t1":"v1"}]');

          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          await userEvent.click(screen.getByTestId('do-clear-data'));

          await screen.findByTestId('data');
          expect(screen.getByTestId('data')).toHaveTextContent('');
        },
      ),
    );
  });

  it(
    'should show error response when there is a server error',
    withTestServer(
      { type: 'error', url: '/api/chat', status: 404, content: 'Not found' },
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        await userEvent.click(screen.getByTestId('do-append'));

        await screen.findByTestId('error');
        expect(screen.getByTestId('error')).toHaveTextContent(
          'Error: Not found',
        );
      },
    ),
  );

  it(
    'should show error response when there is a streaming error',
    withTestServer(
      {
        type: 'stream-values',
        url: '/api/chat',
        content: ['3:"custom error message"\n'],
      },
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        await userEvent.click(screen.getByTestId('do-append'));

        await screen.findByTestId('error');
        expect(screen.getByTestId('error')).toHaveTextContent(
          'Error: custom error message',
        );
      },
    ),
  );

  describe('loading state', () => {
    it(
      'should show loading state',
      withTestServer(
        { url: '/api/chat', type: 'controlled-stream' },
        async ({ streamController }) => {
          streamController.enqueue('0:"Hello"\n');

          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          await userEvent.click(screen.getByTestId('do-append'));

          await screen.findByTestId('loading');
          expect(screen.getByTestId('loading')).toHaveTextContent('true');

          streamController.close();

          await findByText(await screen.findByTestId('loading'), 'false');
          expect(screen.getByTestId('loading')).toHaveTextContent('false');
        },
      ),
    );

    it(
      'should reset loading state on error',
      withTestServer(
        { type: 'error', url: '/api/chat', status: 404, content: 'Not found' },
        async () => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          await userEvent.click(screen.getByTestId('do-append'));

          await screen.findByTestId('loading');
          expect(screen.getByTestId('loading')).toHaveTextContent('false');
        },
      ),
    );
  });

  it(
    'should invoke onFinish when the stream finishes',
    withTestServer(
      {
        url: '/api/chat',
        type: 'stream-values',
        content: [
          formatDataStreamPart('data', [{ t1: 'Hello' }]),
          formatDataStreamPart('data', [{ t1: ',' }]),
          formatDataStreamPart('data', [{ t1: ' world' }]),
          formatDataStreamPart('data', [{ t1: '.' }]),
          formatDataStreamPart('finish_message', {
            finishReason: 'stop',
            usage: { completionTokens: 1, promptTokens: 3 },
          }),
        ],
      },
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        await userEvent.click(screen.getByTestId('do-append'));

        await screen.findByTestId('message-1');

        expect(onFinishCalls).toStrictEqual([
          {
            message: {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              id: expect.any(String),
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              createdAt: expect.any(Date),
              role: 'assistant',
              content: 'Hello, world.',
            },
            options: {
              finishReason: 'stop',
              usage: {
                completionTokens: 1,
                promptTokens: 3,
                totalTokens: 4,
              },
            },
          },
        ]);
      },
    ),
  );

  describe('id', () => {
    it(
      'should clear out messages when the id changes',
      withTestServer(
        {
          url: '/api/chat',
          type: 'stream-values',
          content: ['0:"Hello"\n', '0:","\n', '0:" world"\n', '0:"."\n'],
        },
        async () => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          await userEvent.click(screen.getByTestId('do-append'));

          await screen.findByTestId('message-1');
          expect(screen.getByTestId('message-1')).toHaveTextContent(
            'AI: Hello, world.',
          );

          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          await userEvent.click(screen.getByTestId('do-change-id'));

          expect(screen.queryByTestId('message-0')).not.toBeInTheDocument();
        },
      ),
    );
  });
});
