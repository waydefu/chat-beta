import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/rules.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: [
        'src/utils.ts',
        'src/calls/call-state.ts',
        'src/calls/call.service.ts',
        'src/calls/rtc-callable-options.ts',
        'src/firebase/offline-policy.ts',
        'src/messages/message-store.ts',
        'src/messages/message.service.ts',
        'src/bots/grounding.view.ts',
        'src/realtime/presence-state.ts',
        'src/realtime/realtime.repository.ts',
      ],
      reporter: ['text', 'html'],
    },
  },
});
