// 카카오톡 안 브라우저에서 열리면 Chrome으로 옮기기 (10/16 예형님 요청: 카톡 링크 → 카톡 안 브라우저 → Chrome).
// SOPHIA runtime/execution/external-browser-handoff.ts 방식(페이지 하나에 한 번만, 지금 주소 그대로만 넘김 — 다른 곳으로
// 보내는 데 쓸 수 없음)에 "Chrome 먼저"를 더했다:
//  - 안드로이드: intent 주소로 Chrome 앱을 지정. Chrome이 없으면 browser_fallback_url(같은 주소)로.
//  - iPhone: Chrome 앱 주소(googlechromes://). Chrome이 없으면 안 열린다.
//  - 1.5초 안에 화면이 안 넘어가면(안 열림) SOPHIA처럼 kakaotalk://web/openExternal → 휴대폰 기본 브라우저(iPhone은 Safari).
//  - 그래도 안 되면 화면 위 안내: [Chrome에서 열기]·[링크 복사]·[카카오톡 안에서 계속].

export type Phone = 'android' | 'ios' | 'other';

export const isKakaoInApp = (ua: string) => /KAKAOTALK/i.test(ua);
export const phoneOf = (ua: string): Phone => (/Android/i.test(ua) ? 'android' : /iPhone|iPad|iPod/i.test(ua) ? 'ios' : 'other');

/** Chrome을 여는 주소 (http/https 주소만, 아니면 null) */
export function chromeUrl(href: string, phone: Phone): string | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const rest = `${u.host}${u.pathname}${u.search}${u.hash}`;
  if (phone === 'android') return `intent://${rest}#Intent;scheme=${u.protocol.slice(0, -1)};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(u.href)};end`;
  if (phone === 'ios') return `${u.protocol === 'https:' ? 'googlechromes' : 'googlechrome'}://${rest}`;
  return null;
}

/** 휴대폰 기본 브라우저로 여는 카카오톡 주소 (SOPHIA와 같음) */
export const kakaoExternalUrl = (href: string) => `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;

// 이 탭에서 이미 시도했는지: 메모리 + 탭 기록(sessionStorage). 안드로이드에 Chrome이 없으면 같은 주소가 카카오톡 안에서
// 다시 열리는데, 메모리만 보면 또 옮기려다 끝없이 반복되므로 탭 기록도 본다.
const TRIED = 'subway.kakao.tried';
const STAY = 'subway.kakao.stay';
let attempted = false;
const session = (win: Window) => {
  try {
    return win.sessionStorage;
  } catch {
    return null;
  }
};
export const hasAttempted = (win: Window = window) => attempted || session(win)?.getItem(TRIED) === '1';
export const resetAttempt = () => {
  attempted = false;
};
/** [카카오톡 안에서 계속]: 이 탭에서는 더 옮기지 않음 */
export const stayInKakao = (win: Window) => {
  try {
    session(win)?.setItem(STAY, '1');
  } catch {
    /* 저장 막힘: 이번 화면에서만 */
  }
};
export const staysInKakao = (win: Window) => session(win)?.getItem(STAY) === '1';

/**
 * 카카오톡 안이면 Chrome → (안 열리면) 기본 브라우저 순서로 연다. 페이지 하나에 자동으로는 한 번만.
 * 반환: 옮기기를 시도했는지. 시도해도 앱 시작은 막지 않는다 (안 열렸을 때 안내 화면이 그려져야 해서).
 */
export function openInChrome(win: Window, opts: { fallbackMs?: number; manual?: boolean } = {}): boolean {
  const ua = win.navigator.userAgent ?? '';
  if (!isKakaoInApp(ua)) return false;
  // 자동은 탭에 한 번, 안에서 계속을 고른 탭은 안 옮김. 손으로 누른 [Chrome에서 열기]는 늘
  if (!opts.manual && (hasAttempted(win) || staysInKakao(win))) return false;
  attempted = true;
  try {
    session(win)?.setItem(TRIED, '1');
  } catch {
    /* 저장 막힘: 메모리 기록만 */
  }
  const href = win.location.href;
  const chrome = chromeUrl(href, phoneOf(ua));
  const go = (url: string) => {
    try {
      win.location.href = url;
      return true;
    } catch {
      return false; // 카카오톡이 주소를 막아도 시작은 계속
    }
  };
  if (!chrome) return go(kakaoExternalUrl(href));
  let left = false;
  const onHide = () => {
    if (win.document.visibilityState === 'hidden') left = true;
  };
  win.document.addEventListener('visibilitychange', onHide);
  go(chrome);
  win.setTimeout(() => {
    win.document.removeEventListener('visibilitychange', onHide);
    if (!left && win.document.visibilityState === 'visible') go(kakaoExternalUrl(href));
  }, opts.fallbackMs ?? 1500);
  return true;
}
