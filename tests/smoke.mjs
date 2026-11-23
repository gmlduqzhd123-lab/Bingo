// 엽쌤 앱 기본 점검: 첫 화면·설정·게임 진입이 열리는지, 화면 오류가 없는지, 📲 설치·📱 QR 버튼이 있는지,
// 휴대폰(390px)에서 옆으로 넘치지 않는지 확인한다. GitHub Actions(.github/workflows/smoke.yml)에서 돌아간다.
// 사용: SMOKE_URL=http://localhost:8080/<저장소>/ node tests/smoke.mjs
import { chromium } from 'playwright';

const url = process.env.SMOKE_URL;
if (!url) throw new Error('SMOKE_URL 이 필요합니다');
const browser = await chromium.launch();
const problems = [];
for (const width of [390, 1280]) {
  const context = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const res = await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  if (!res || !res.ok()) problems.push(`${width}px: 첫 화면 응답 ${res && res.status()}`);
  const check = await page.evaluate(() => ({
    title: document.title.trim(),
    // 측정기(topcheck.cjs)와 같은 기준: 공통 속성이 없으면 버튼 글자로 찾는다
    install: !!document.querySelector('[data-ys-install],.install-btn,#installApp,.install-button')
      || [...document.querySelectorAll('button,a')].some(b => /앱\s?설치|📲/.test(b.textContent)),
    qr: !!document.querySelector('[data-qr],[data-qr-btn],#qrApp,.qr-button')
      || [...document.querySelectorAll('button,a')].some(b => /\bQR\b/i.test(b.textContent)),
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  if (!check.title) problems.push(`${width}px: 제목(<title>)이 비어 있음`);
  if (!check.install || !check.qr) problems.push(`${width}px: 📲 설치·📱 QR 버튼이 없음`);
  if (width === 390 && check.overflow > 1) problems.push(`390px: 첫 화면이 옆으로 ${check.overflow}px 넘침`);

  // 문제 세트 편집기 진입 점검
  await page.click('#btn-editor');
  await page.waitForTimeout(200);
  const edCheck = await page.evaluate(() => ({
    active: document.getElementById('screen-editor')?.classList.contains('active'),
    hasEditor: !!document.getElementById('ed-text'),
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  if (!edCheck.active || !edCheck.hasEditor) problems.push(`${width}px: 문제 세트 편집기가 열리지 않음`);
  if (width === 390 && edCheck.overflow > 1) problems.push(`390px: 문제 세트 편집기가 옆으로 ${edCheck.overflow}px 넘침`);
  await page.click('#ed-back');
  await page.waitForTimeout(150);

  // 설정 및 게임 화면 진입 점검
  await page.click('#btn-solo');
  await page.waitForTimeout(200);
  const setupCheck = await page.evaluate(() => ({
    active: document.getElementById('screen-setup')?.classList.contains('active'),
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  if (!setupCheck.active) problems.push(`${width}px: 설정 화면이 열리지 않음`);
  if (width === 390 && setupCheck.overflow > 1) problems.push(`390px: 설정 화면이 옆으로 ${setupCheck.overflow}px 넘침`);

  await page.click('#btn-start');
  await page.waitForTimeout(300);
  const gameCheck = await page.evaluate(() => ({
    active: document.getElementById('screen-game')?.classList.contains('active'),
    tiles: document.querySelectorAll('#board .tile').length,
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  if (!gameCheck.active || gameCheck.tiles < 16) problems.push(`${width}px: 게임 보드가 정상 표시되지 않음`);
  if (width === 390 && gameCheck.overflow > 1) problems.push(`390px: 게임 화면이 옆으로 ${gameCheck.overflow}px 넘침`);

  if (width === 1280) {
    await page.evaluate(() => {
      const ann = document.getElementById('announce');
      if (ann && ann.classList.contains('show')) ann.click();
    });
    await page.waitForTimeout(250);
    await page.click('#board .tile.closed');
    await page.waitForTimeout(150);
    const qOpened = await page.evaluate(() => !!document.getElementById('modal')?.classList.contains('show'));
    if (!qOpened) problems.push('1280px: 첫 번째 칸 클릭 후 문제 모달이 열리지 않음');
    else {
      const isMc = await page.evaluate(() => !!document.querySelector('#modal .q-opt'));
      if (isMc) await page.click('#modal .q-opt');
      else {
        await page.fill('#q-sa-input', '테스트');
        await page.click('#q-sa-submit');
      }
      await page.waitForTimeout(200);
    }
  }

  if (errors.length) problems.push(`${width}px: 화면 오류 ${errors.slice(0, 3).join(' | ')}`);
  await context.close();
}
await browser.close();
if (problems.length) { console.error('점검 실패\n- ' + problems.join('\n- ')); process.exit(1); }
console.log('점검 통과: 첫 화면·설정·게임 진입·오류 없음·설치/QR 버튼·휴대폰 가로 넘침 없음');
