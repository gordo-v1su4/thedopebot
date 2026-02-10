export const metadata = {
  title: 'thepopebot',
  description: 'AI Agent',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
