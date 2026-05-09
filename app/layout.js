import './globals.css';

export const metadata = {
  title: 'AI Jobs News Tracker',
  description: 'Automated AI Jobs News Aggregator and Summarizer',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
