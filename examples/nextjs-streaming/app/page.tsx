'use client';

import { useChat } from 'jotai-ai/react';
import { Provider } from 'jotai';

export default function Home() {
  return (
    <Provider>
      <ChatComponent />
    </Provider>
  );
}

function ChatComponent() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
    api: '/api/chat',
  });

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px' }}>
      <h1>Jotai-AI Streaming Chat Example</h1>
      
      <div style={{ marginBottom: '20px', minHeight: '400px', border: '1px solid #ccc', padding: '20px', borderRadius: '8px' }}>
        {messages.length === 0 && (
          <p style={{ color: '#666' }}>Start a conversation...</p>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            style={{
              marginBottom: '10px',
              padding: '10px',
              backgroundColor: message.role === 'user' ? '#e3f2fd' : '#f5f5f5',
              borderRadius: '8px',
            }}
          >
            <strong>{message.role === 'user' ? 'You' : 'Assistant'}:</strong>
            <div style={{ marginTop: '5px', whiteSpace: 'pre-wrap' }}>
              {message.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div style={{ color: '#666', fontStyle: 'italic' }}>
            Assistant is typing...
          </div>
        )}
        {error && (
          <div style={{ color: 'red', marginTop: '10px' }}>
            Error: {error.message}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '10px' }}>
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder="Type your message..."
          disabled={isLoading}
          style={{
            flex: 1,
            padding: '10px',
            fontSize: '16px',
            borderRadius: '4px',
            border: '1px solid #ccc',
          }}
        />
        <button
          type="submit"
          disabled={isLoading}
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            backgroundColor: '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            opacity: isLoading ? 0.6 : 1,
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}