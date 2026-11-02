import { defineConfig } from 'vitest/config';

/** 外部コマンドは実行しない。パーサー・判定・スケジューラ・フィルタ・ペイロード組み立てを純粋関数で検証する */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
