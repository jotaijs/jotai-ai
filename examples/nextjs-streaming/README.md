# Jotai-AI Next.js Streaming Example

This example demonstrates how to use jotai-ai with Next.js to create a streaming chat interface.

## Features

- Real-time streaming responses from OpenAI
- State management with Jotai atoms
- React hooks integration with `useChat`
- TypeScript support

## Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Set up your OpenAI API key:

   ```bash
   cp .env.example .env.local
   ```

   Then edit `.env.local` and add your OpenAI API key.

3. Run the development server:

   ```bash
   pnpm dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## How it works

- The app uses jotai-ai's `useChat` hook to manage chat state and handle streaming
- Messages are sent to `/api/chat` which uses the Vercel AI SDK to stream responses
- The UI updates in real-time as tokens are received from the API
- All state is managed through Jotai atoms for predictable updates

## Key files

- `app/page.tsx` - Main chat interface using `useChat` hook
- `app/api/chat/route.ts` - API route that handles streaming with OpenAI
- `package.json` - Dependencies including jotai-ai and AI SDK
