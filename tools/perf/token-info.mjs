// 토큰 응답 형식·발급 시간 확인(값은 출력하지 않는다): 환경변수 EFORMSIGN_API_KEY / EFORMSIGN_PRIVATE_KEY / EFORMSIGN_MEMBER_ID 필요
// 사용: node tools/perf/token-info.mjs [횟수]
import { issueToken, clearTokenCache } from '../../api/lib/eformsign-report.mjs';
const n = Number(process.argv[2] || 3);
const o = { apiKey: process.env.EFORMSIGN_API_KEY, privateKey: process.env.EFORMSIGN_PRIVATE_KEY, memberId: process.env.EFORMSIGN_MEMBER_ID };
for (let i = 0; i < n; i++) {
  clearTokenCache();
  const t0 = performance.now();
  const t = await issueToken(o);
  const ms = Math.round(performance.now() - t0);
  const t1 = performance.now(); await issueToken(o);
  console.log(JSON.stringify({ issueMs: ms, cachedMs: +(performance.now() - t1).toFixed(2), expiresInSec: t.expiresIn, apiHost: new URL(t.apiUrl).host, tokenLen: t.accessToken.length }));
}
