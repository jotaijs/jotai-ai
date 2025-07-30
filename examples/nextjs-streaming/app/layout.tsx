export const metadata = {
  title: 'Jotai-AI Streaming Example',
  description: 'Streaming chat example using jotai-ai with Next.js',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}