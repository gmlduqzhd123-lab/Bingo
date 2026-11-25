// 엽쌤 앱 기본 점검: 첫 화면(창고·실시간·명예의전당)·편집기(텍스트/카드/인쇄)·설정(6팀·보상커스텀)·게임(모바일 1화면/1인 가드/TTS/실시간방)이
// 정상 작동하는지, 화면 오류가 없는지, 📲 설치·📱 QR 버튼이 있는지, 휴대폰(390px)에서 옆으로 넘치지 않는지 확인한다.
// 사용: SMOKE_URL=http://localhost:8080/<저장소>/ node tests/smoke.mjs
import { chromium } from 'playwright';

const url = process.env.SMOKE_URL;
if (!url) throw new Error('SMOKE_URL 이 필요합니다');
const launchOpts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const browser = await chromium.launch(launchOpts);
const problems = [];

for (const width of [390, 1280]) {
  const context = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const res = await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  if (!res || !res.ok()) problems.push(`${width}px: 첫 화면 응답 ${res && res.status()}`);

  const check = await page.evaluate(() => ({
    title: document.title.trim(),
    install: !!document.querySelector('[data-ys-install],.install-btn,#installApp,.install-button')
      || [...document.querySelectorAll('button,a')].some(b => /앱\s?설치|📲/.test(b.textContent)),
    qr: !!document.querySelector('[data-qr],[data-qr-btn],#qrApp,.qr-button')
      || [...document.querySelectorAll('button,a')].some(b => /\bQR\b/i.test(b.textContent)),
    codeBtn: !!document.getElementById('btn-code-join'),
    liveBtn: !!document.getElementById('btn-live-join'),
    libBtn: !!document.getElementById('btn-library'),
    hofBtn: !!document.getElementById('btn-hof'),
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  if (!check.title) problems.push(`${width}px: 제목(<title>)이 비어 있음`);
  if (!check.install || !check.qr) problems.push(`${width}px: 📲 설치·📱 QR 버튼이 없음`);
  if (!check.codeBtn || !check.liveBtn || !check.libBtn || !check.hofBtn) {
    problems.push(`${width}px: 첫 화면 핵심 버튼(코드/실시간/창고/명예의전당) 누락`);
  }
  if (width === 390 && check.overflow > 1) problems.push(`390px: 첫 화면이 옆으로 ${check.overflow}px 넘침`);

  // 공개 문제 창고 · 명예의 전당 · 실시간 방 모달 점검
  await page.click('#btn-library');
  await page.waitForTimeout(350);
  const libOk = await page.evaluate(() => document.querySelectorAll('#lib-grid .lib-card').length >= 1);
  if (!libOk) problems.push(`${width}px: 공개 문제 창고 카드가 표시되지 않음`);
  await page.click('#m-close');
  await page.waitForTimeout(120);

  await page.click('#btn-hof');
  await page.waitForTimeout(150);
  const hofOk = await page.evaluate(() => !!document.getElementById('modal')?.classList.contains('show'));
  if (!hofOk) problems.push(`${width}px: 명예의 전당 모달이 열리지 않음`);
  await page.click('#m-close');
  await page.waitForTimeout(120);

  await page.click('#btn-live-join');
  await page.waitForTimeout(150);
  const ljOk = await page.evaluate(() => !!document.getElementById('lj-code'));
  if (!ljOk) problems.push(`${width}px: 실시간 방 참여 모달이 열리지 않음`);
  await page.click('#m-close');
  await page.waitForTimeout(120);

  // 누적 약점 오답 보관함 점검
  await page.evaluate(() => {
    localStorage.setItem('bq_wrong_bank', JSON.stringify([{ key: 'q1', q: '샘플 오답 문제?', a: '정답', opts: null, explain: '', img: '', misses: 2, lastMissedAt: new Date().toISOString() }]));
  });
  await page.click('#btn-new');
  await page.waitForTimeout(100);
  await page.click('[data-go="title"]');
  await page.waitForTimeout(150);
  const wbBtnOk = await page.evaluate(() => {
    const b = document.getElementById('btn-weak-bank');
    return !!(b && !b.classList.contains('hidden'));
  });
  if (!wbBtnOk) problems.push(`${width}px: 누적 약점 문제 복습 버튼이 표시되지 않음`);
  else {
    await page.click('#btn-weak-bank');
    await page.waitForTimeout(150);
    const wbModalOk = await page.evaluate(() => !!(document.getElementById('wb-play') && document.getElementById('wb-print')));
    if (!wbModalOk) problems.push(`${width}px: 누적 약점 오답 보관함 모달 버튼 누락`);
    await page.click('#m-close');
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => localStorage.removeItem('bq_wrong_bank'));

  // 문제 세트 편집기 진입 점검 (텍스트 + 클린업 + 저장공간 + 복제 + 카드)
  await page.click('#btn-editor');
  await page.waitForTimeout(200);
  const edCheck = await page.evaluate(() => ({
    active: document.getElementById('screen-editor')?.classList.contains('active'),
    hasEditor: !!document.getElementById('ed-text'),
    hasCleanup: !!document.getElementById('ed-cleanup'),
    hasStorage: !!document.getElementById('ed-storage-bar')?.textContent?.includes('KB'),
    hasDup: document.querySelectorAll('#set-list [data-dup]').length >= 1,
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  if (!edCheck.active || !edCheck.hasEditor || !edCheck.hasCleanup || !edCheck.hasStorage || !edCheck.hasDup) {
    problems.push(`${width}px: 문제 세트 편집기 핵심 기능(입력·정리·저장공간·복제) 누락`);
  }
  if (width === 390 && edCheck.overflow > 1) problems.push(`390px: 문제 세트 편집기(텍스트)가 옆으로 ${edCheck.overflow}px 넘침`);

  await page.click('#ed-sample');
  await page.waitForTimeout(120);
  await page.click('[data-edmode="cards"]');
  await page.waitForTimeout(150);
  const cardCheck = await page.evaluate(() => ({
    visible: !document.getElementById('ed-cards-wrap')?.classList.contains('hidden'),
    hasBatch: !!document.getElementById('ed-batch-bar'),
    hasToggleType: !!document.getElementById('ed-toggle-type'),
    hasMoveTo: document.querySelectorAll('[data-cmoveto]').length >= 1,
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  if (!cardCheck.visible || !cardCheck.hasBatch || !cardCheck.hasToggleType || !cardCheck.hasMoveTo) {
    problems.push(`${width}px: 카드별 편집/일괄 유형변환/번호이동 요소 누락`);
  }
  if (width === 390 && cardCheck.overflow > 1) problems.push(`390px: 문제 세트 편집기(카드)가 옆으로 ${cardCheck.overflow}px 넘침`);

  await page.click('#ed-new');
  await page.waitForTimeout(100);
  await page.click('#ed-back');
  await page.waitForTimeout(150);

  // 설정 화면 진입 점검 (검색, 6팀, 3×3, 팀 프리셋, 스틸·콤보, 보상 세부 선택)
  await page.click('#btn-solo');
  await page.waitForTimeout(200);
  await page.click('#btn-adv');
  await page.waitForTimeout(150);
  const setupCheck = await page.evaluate(() => ({
    active: document.getElementById('screen-setup')?.classList.contains('active'),
    hasSearch: !!document.getElementById('set-search'),
    has3x3: !!document.querySelector('[data-bsize="3"]'),
    hasTeam6: !!document.querySelector('[data-mode="team6"]'),
    hasSteal: !!document.getElementById('o-steal'),
    hasCombo: !!document.getElementById('o-combo'),
    advOpen: !document.getElementById('adv-panel')?.classList.contains('hidden'),
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  if (!setupCheck.active || !setupCheck.hasSearch || !setupCheck.has3x3 || !setupCheck.hasTeam6 || !setupCheck.hasSteal || !setupCheck.hasCombo || !setupCheck.advOpen) {
    problems.push(`${width}px: 설정 화면 요소(검색·6팀·3×3·세부설정)가 정상 표시되지 않음`);
  }
  if (width === 390 && setupCheck.overflow > 1) problems.push(`390px: 설정 화면이 옆으로 ${setupCheck.overflow}px 넘침`);

  await page.click('#btn-rw-custom');
  await page.waitForTimeout(150);
  const rwcOk = await page.evaluate(() => document.querySelectorAll('[data-rwc]').length >= 15);
  if (!rwcOk) problems.push(`${width}px: 보상 카드 세부 선택 모달이 열리지 않음`);
  await page.click('#m-close');
  await page.waitForTimeout(120);

  if (width === 390) {
    // 390px 6팀 모바일 1화면(가로 스크롤 점수 스트립) 점검
    await page.click('[data-mode="team6"]');
    await page.waitForTimeout(120);
    await page.click('#tp-group');
    await page.waitForTimeout(100);
    await page.click('#btn-start');
    await page.waitForTimeout(300);
    const t6Check = await page.evaluate(() => ({
      active: document.getElementById('screen-game')?.classList.contains('active'),
      manyTeams: document.getElementById('mob-scores')?.classList.contains('many-teams'),
      chips: document.querySelectorAll('#mob-scores .ms-chip').length,
      sideVisible: document.getElementById('side-left')?.offsetParent !== null,
      overflow: document.documentElement.scrollWidth - innerWidth,
    }));
    if (!t6Check.active || !t6Check.manyTeams || t6Check.chips !== 6 || t6Check.sideVisible) {
      problems.push('390px: 6팀 모바일 1화면 점수 스트립이 올바르게 동작하지 않음');
    }
    if (t6Check.overflow > 1) problems.push(`390px: 6팀 게임 화면이 옆으로 ${t6Check.overflow}px 넘침`);

    await page.evaluate(() => {
      const ann = document.getElementById('announce');
      if (ann && ann.classList.contains('show')) ann.click();
    });
    await page.waitForTimeout(220);
    await page.click('#g-home');
    await page.waitForTimeout(120);
    await page.click('#cf-ok');
    await page.waitForTimeout(150);
    await page.click('#btn-solo');
    await page.waitForTimeout(150);
    await page.click('#btn-start');
    await page.waitForTimeout(120);
    await page.click('#cf-ok');
    await page.waitForTimeout(250);
  } else {
    // 게임 진입 점검 (1280px)
    await page.click('#btn-start');
    await page.waitForTimeout(300);
  }
  const gameCheck = await page.evaluate(() => ({
    active: document.getElementById('screen-game')?.classList.contains('active'),
    tiles: document.querySelectorAll('#board .tile').length,
    mobChips: document.querySelectorAll('#mob-scores .ms-chip').length,
    sideVisible: document.getElementById('side-left')?.offsetParent !== null,
    hasLiveBtn: !!document.getElementById('g-live'),
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  if (!gameCheck.active || gameCheck.tiles !== 25 || !gameCheck.hasLiveBtn) problems.push(`${width}px: 게임 보드가 정상 표시되지 않음 (${gameCheck.tiles}칸)`);
  if (width === 390) {
    if (gameCheck.overflow > 1) problems.push(`390px: 게임 화면이 옆으로 ${gameCheck.overflow}px 넘침`);
    if (gameCheck.mobChips < 2 || gameCheck.sideVisible) problems.push('390px: 모바일 1화면 점수 칩/사이드바 전환이 올바르지 않음');
  }

  if (width === 1280) {
    await page.evaluate(() => {
      const ann = document.getElementById('announce');
      if (ann && ann.classList.contains('show')) ann.click();
    });
    await page.waitForTimeout(250);

    // 게임 중 빠른 설정 모달 열기·닫기 점검
    await page.click('#g-settings');
    await page.waitForTimeout(150);
    const qsOk = await page.evaluate(() => !!document.getElementById('qs-theme'));
    if (!qsOk) problems.push('1280px: 게임 중 빠른 설정 모달이 열리지 않음');
    else {
      await page.click('#m-close');
      await page.waitForTimeout(120);
    }

    await page.click('#board .tile.closed');
    await page.waitForTimeout(150);
    const qState = await page.evaluate(() => ({
      opened: !!document.getElementById('modal')?.classList.contains('show'),
      hasTts: !!document.getElementById('q-tts'),
      hasCancel: !!document.getElementById('q-cancel'),
    }));
    if (!qState.opened || !qState.hasTts) problems.push('1280px: 첫 번째 칸 클릭 후 문제 모달/TTS 버튼이 열리지 않음');
    if (qState.hasCancel) problems.push('1280px: 1인 모드에서 문제 닫기 꼼수 버튼(#q-cancel)이 남아 있음');

    if (qState.opened) {
      const isMc = await page.evaluate(() => !!document.querySelector('#modal .q-opt'));
      if (isMc) await page.click('#modal .q-opt');
      else {
        await page.fill('#q-sa-input', '테스트');
        await page.click('#q-sa-submit');
      }
      await page.waitForTimeout(200);
      const hasNextOrOverride = await page.evaluate(() => !!(document.getElementById('q-next') || document.getElementById('q-sa-confirm-no')));
      if (!hasNextOrOverride) problems.push('1280px: 문제 답변 후 다음 진행 버튼이 나타나지 않음');
      await page.evaluate(() => {
        const b = document.getElementById('q-next') || document.getElementById('q-sa-confirm-no');
        if (b) b.click();
      });
      await page.waitForTimeout(150);
    }
  }

  if (errors.length) problems.push(`${width}px: 화면 오류 ${errors.slice(0, 3).join(' | ')}`);
  await context.close();
}

await browser.close();
if (problems.length) {
  console.error('점검 실패\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('점검 통과: 첫 화면(창고·실시간·명예의전당)·편집기(텍스트/카드)·설정(6팀·보상커스텀)·게임(모바일 1화면/1인 가드/TTS)·오류 없음·가로 넘침 없음');
