#!/usr/bin/env node
/**
 * make-ozr-report.mjs — 홍보 영상 선택지 C: 「방문자 기록부(방명록) 참석자 명단」 OZR 보고서를
 * 이폼사인 완료 문서 한 건으로 만든다(모노레포 CLI `eformsign ozr report` 의 얇은 래퍼).
 *
 * 모드
 *   --preview  표본 3행(.local/ozr-report-sample-rows.json)으로 렌더 → PDF·PNG 저장 → 임시 서식·문서 **삭제**
 *   --live     efstest 방명록 템플릿의 실제 완료 문서(방문자성명 빈 문서 제외)로 생성 → 서식·문서 **보존**
 *
 * 필요한 것(값은 이 파일에 쓰지 않는다 — public 저장소)
 *   - env EFORMSIGN_CLI (모노레포 eformsign-cli/bin/eformsign.mjs)
 *   - .local/report.env (촬영 계정 efstest 자격, DOTENV_CONFIG_PATH 로 전달)
 *   - --live: 대상 템플릿 정보 파일의 templateId — 기본 `.local/template-demo-copy-v2.json`
 *     (커넥트 「방명록」·K02 시트·D01~D03 이 쓰는 v2). `--template-file <path>` 로 바꾼다.
 *     🔴 2026-09-28: 예전엔 v1(`template-demo-copy.json`) 로 하드코딩돼 D04 보고서가 K02 시트와
 *     다른 문서 묶음(이름만 같은 v1 문서)을 실었다. 영상 컷끼리 같은 템플릿을 써야 한다.
 * 결과: promo/out/check/ozr-report-{preview|live}.pdf / .png / .ozr, --live 는 .local/ozr-report.json 기록
 *
 * 사용: node promo/tools/make-ozr-report.mjs --preview
 *       node promo/tools/make-ozr-report.mjs --live [--date 2026-09-23] [--template-file .local/template-demo-copy-v2.json] [--template-name <유일한 서식 이름>]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const mode = args.includes('--live') ? 'live' : args.includes('--preview') ? 'preview' : null;
if (!mode) { console.error('usage: --preview | --live [--date YYYY-MM-DD]'); process.exit(2); }
const dateIdx = args.indexOf('--date');
const tplIdx = args.indexOf('--template-file');
const templateFile = resolve(root, tplIdx >= 0 ? args[tplIdx + 1] : '.local/template-demo-copy-v2.json');
const date = dateIdx >= 0 ? args[dateIdx + 1] : new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // KST 오늘

const cli = process.env.EFORMSIGN_CLI;
if (!cli || !existsSync(cli)) { console.error('EFORMSIGN_CLI 가 없거나 파일이 없다'); process.exit(2); }
const envFile = resolve(root, '.local/report.env');
if (!existsSync(envFile)) { console.error('.local/report.env 없음'); process.exit(2); }

const outDir = resolve(root, 'promo/out/check');
mkdirSync(outDir, { recursive: true });
const base = resolve(outDir, `ozr-report-${mode}`);

// 디자인(사용자 확인 대상) — 열 폭 합 802 = 가로 A4 인쇄 폭 전체(표가 가운데 온다).
const design = [
  '--title', '방문자 기록부(방명록) 참석자 명단',
  '--subtitle', '기간 {range} · 방문자 {count}명',
  '--footer-text', '이폼사인으로 작성된 문서 {count}건 기준',
  '--column', '@no:번호:50',
  '--column', '방문일시:방문일시:160',
  '--column', '방문자성명:성명:100',
  '--column', '소속:소속:150',
  '--column', '연락처:연락처:130',
  '--column', '방문목적:방문목적:130',
  '--column', '담당자:담당자:82',
  '--title-font-size', '26', '--subtitle-font-size', '14', '--body-font-size', '14',
  '--row-height', '34', '--footer-font-size', '13', '--no-data-source-hint', '--header-cells',
];

const common = ['--json', 'ozr', 'report', '-o', base + '.pdf', '--from', date, '--to', date, '--ozr-out', base + '.ozr', ...design];
let extra;
let docName;
let tplName;
if (mode === 'preview') {
  extra = ['--rows', resolve(root, '.local/ozr-report-sample-rows.json')];
} else {
  if (!existsSync(templateFile)) { console.error('템플릿 정보 파일 없음: ' + templateFile); process.exit(2); }
  const tpl = JSON.parse(readFileSync(templateFile, 'utf8'));
  console.error('대상 템플릿: ' + tpl.templateName + ' (' + templateFile.split(/[\/]/).pop() + ')');
  docName = `방문자 기록부 명단 - ${date}`;
  // 서식 이름은 회사 안에서 유일해야 한다(중복이면 HTTP 400 4000048 「connection name already exists」).
  // 기본값 = 영상 D04 가 쓰는 v2 서식명. v1 서식 「…보고서 (OZ Report)」는 2026-09-28 콘솔에서 삭제됨 — 되돌리지 말 것.
  // 🔴 v2 서식이 이미 회사에 있으면 기본값 그대로 재실행 시 400 4000048 → 새 이름을 --template-name 으로 주거나
  //    기존 v2 서식을 콘솔에서 정리한 뒤 실행한다(이 스크립트는 서식을 지우지 않는다).
  const tnIdx = args.indexOf('--template-name');
  tplName = tnIdx >= 0 ? args[tnIdx + 1] : `방문자 기록부 명단 보고서 v2 (OZ Report)`;
  extra = ['--template-id', tpl.templateId, '--require-field', '방문자성명', '--keep',
    '--document-name', docName, '--template-name', tplName];
}

const raw = execFileSync(process.execPath, [cli, ...common, ...extra], {
  env: { ...process.env, DOTENV_CONFIG_PATH: envFile },
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
const res = JSON.parse(raw);
const mask = (v) => (v ? String(v).slice(0, 4) + '…' : v);

// PDF 1페이지 → PNG(2000px). PyMuPDF 사용(pdftoppm 미설치 머신).
execFileSync('python', ['-c',
  'import fitz,sys\nd=fitz.open(sys.argv[1]);p=d[0];z=2000/p.rect.width\np.get_pixmap(matrix=fitz.Matrix(z,z)).save(sys.argv[2]);print(d.page_count)',
  base + '.pdf', base + '.png'], { stdio: 'inherit' });

const summary = {
  mode, date, templateFile: mode === 'live' ? templateFile.split(/[\/]/).pop() : undefined,
  rowCount: res.rowCount,
  skippedCount: res.skippedCount,
  documentCompletion: res.documentCompletion,
  inspection: res.inspection?.ok,
  cleanup: { ...res.cleanup, templateId: mask(res.cleanup?.templateId), documentId: mask(res.cleanup?.documentId) },
  templateName: res.templateName,
  documentName: res.documentName,
  tableRows: res.tableRows,
  pdf: base + '.pdf', png: base + '.png', ozr: base + '.ozr',
};
if (mode === 'live') {
  // .local 은 gitignore — 실제 ID 를 남겨도 되는 유일한 자리.
  writeFileSync(resolve(root, '.local/ozr-report.json'), JSON.stringify({
    createdAt: new Date().toISOString(), date, templateFile,
    templateName: res.templateName, templateId: res.templateId,
    documentName: res.documentName, documentId: res.documentId,
    rowCount: res.rowCount, skippedCount: res.skippedCount, tableRows: res.tableRows,
  }, null, 2));
}
console.log(JSON.stringify(summary, null, 1));
if (mode === 'preview' && !(res.cleanup?.documentDeleted && res.cleanup?.templateDeleted)) {
  console.error('⚠ 정리 미확인(삭제 전파 지연일 수 있음) — 잠시 뒤 문서함에서 제목 「참석자 명단 (auto-」 재확인');
  process.exitCode = 3;
}
