import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Harmony — Dashboard',
  description: 'Melihat dan mengubah konfigurasi bot Harmony untuk server Discord Anda.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          background: '#1e1f22',
          color: '#dbdee1',
          lineHeight: 1.5,
        }}
      >
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 20px 64px' }}>{children}</div>
      </body>
    </html>
  );
}
