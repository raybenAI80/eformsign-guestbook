/**
 * 로컬 HTTPS 정적 서버 — 「고객 자체 도메인처럼 보이는 origin」을 만들기 위한 검증용 헬퍼.
 *
 * 왜 필요한가(2026-09-16)
 *   키오스크 래퍼가 실제로 검증된 origin 은 *.vercel.app 과 localhost 둘뿐이었다.
 *   고객 자체 도메인(https://kiosk.고객사.co.kr)에서도 이폼사인 임베딩이 열리는지는
 *   추론 상태였다. 이폼사인 서버가 Origin/Referer 를 보고 막는지 확인하려면
 *   **localhost 도 vercel 도 아닌 호스트명**으로 페이지를 열어야 한다.
 *   시스템 설정(hosts 파일·인증서 저장소)을 건드리지 않고 그렇게 하는 방법이
 *   공개 와일드카드 루프백 DNS 다: kiosk.127.0.0.1.nip.io · lvh.me · localtest.me
 *   전부 127.0.0.1 로 해석되지만 브라우저가 보는 origin 은 그 호스트명이다.
 *
 * 사용법
 *   node tools/serve-https.mjs --host kiosk.127.0.0.1.nip.io --port 8443 \
 *        --root <정적 디렉터리> [--cert-dir <임시 폴더>]
 *   (자체서명 인증서는 openssl 로 --cert-dir 에 자동 생성한다. 시스템 신뢰 저장소에는
 *    넣지 않는다 — 브라우저 쪽에서 --ignore-certificate-errors 로 통과시킨다.)
 *
 * 준비되면 stdout 에 `READY <url>` 한 줄을 찍는다(다른 스크립트가 이 줄을 기다린다).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { execFileSync } from 'node:child_process';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };

const HOST = arg('host', 'kiosk.127.0.0.1.nip.io');
const PORT = Number(arg('port', '8443'));
const ROOT = path.resolve(arg('root', process.cwd()));
const CERT_DIR = path.resolve(arg('cert-dir', path.join(os.tmpdir(), 'kiosk-origin-cert')));

/** 자체서명 인증서 생성(없을 때만). SAN 에 호스트명을 넣는다. */
export function ensureCert(host, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const key = path.join(dir, host + '.key');
  const crt = path.join(dir, host + '.crt');
  if (fs.existsSync(key) && fs.existsSync(crt)) return { key, crt };
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', crt, '-days', '30',
    '-subj', '/CN=' + host,
    '-addext', 'subjectAltName=DNS:' + host + ',DNS:localhost,IP:127.0.0.1',
  ], { stdio: 'pipe' });
  return { key, crt };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

/** 정적 HTTPS 서버를 띄운다. @returns {Promise<{server, url, close}>} */
export function serveHttps({ host, port, root, certDir } = {}) {
  const { key, crt } = ensureCert(host, certDir);
  const server = https.createServer(
    { key: fs.readFileSync(key), cert: fs.readFileSync(crt) },
    (req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'https://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(root, path.normalize(p).replace(/^([/\\])+/, ''));
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end('404 ' + p);
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      fs.createReadStream(file).pipe(res);
    }
  );
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const url = `https://${host}:${port}`;
      resolve({ server, url, close: () => new Promise(r => server.close(r)) });
    });
  });
}

// CLI 로 직접 실행했을 때만 서버를 띄운다(모듈로 import 하면 아무 일도 하지 않는다).
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const { url } = await serveHttps({ host: HOST, port: PORT, root: ROOT, certDir: CERT_DIR });
  console.log('READY ' + url);
  console.log('ROOT ' + ROOT);
}
