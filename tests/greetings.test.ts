import { describe, expect, it } from 'vitest';
import { greetingTemplate, renderGreeting } from '../src/modules/moderation/greetings.js';

const context = {
  userId: '123456789012345678',
  userTag: 'budi',
  serverName: 'Server Uji',
  memberCount: 42,
};

describe('renderGreeting', () => {
  it('mengisi semua placeholder yang didukung', () => {
    const text = renderGreeting('Hai {mention} ({user}) di {server}! Member ke-{count}.', context);

    expect(text).toBe('Hai <@123456789012345678> (budi) di Server Uji! Member ke-42.');
  });

  it('mengganti placeholder yang muncul berkali-kali', () => {
    expect(renderGreeting('{user} {user}', context)).toBe('budi budi');
  });

  it('membiarkan placeholder asing apa adanya', () => {
    expect(renderGreeting('{role} untuk {user}', context)).toBe('{role} untuk budi');
  });
});

describe('greetingTemplate', () => {
  it('memakai fallback saat pesan kosong', () => {
    expect(greetingTemplate(null, 'fallback')).toBe('fallback');
    expect(greetingTemplate('   ', 'fallback')).toBe('fallback');
  });

  it('memakai pesan kustom saat diisi', () => {
    expect(greetingTemplate('Halo {user}', 'fallback')).toBe('Halo {user}');
  });
});
