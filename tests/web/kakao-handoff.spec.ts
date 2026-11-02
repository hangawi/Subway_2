import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromeUrl, isKakaoInApp, kakaoExternalUrl, openInChrome, phoneOf, resetAttempt, stayInKakao } from '../../src/web/kakao-handoff.ts';

const ANDROID_KAKAO = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 KAKAOTALK 10.5.0';
const IPHONE_KAKAO = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 KAKAOTALK 10.5.0';
const PLAIN_CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const HREF = 'https://subway.metasolveai.com/?a=1#x';

function fakeWindow(ua: string, opts: { leaves?: boolean } = {}) {
  const went: string[] = [];
  const store = new Map<string, string>();
  let visibility: 'visible' | 'hidden' = 'visible';
  const listeners: Array<() => void> = [];
  const win = {
    navigator: { userAgent: ua },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    document: {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (_: string, f: () => void) => listeners.push(f),
      removeEventListener: () => undefined,
    },
    location: {
      get href() {
        return HREF;
      },
      set href(url: string) {
        went.push(url);
        // Chrome이 열리면 카카오톡 화면이 뒤로 감
        if (opts.leaves && (url.startsWith('intent://') || url.startsWith('googlechromes://'))) {
          visibility = 'hidden';
          listeners.forEach((f) => f());
        }
      },
    },
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
  } as unknown as Window;
  return { win, went, store };
}

describe('카카오톡 안 브라우저 → Chrome (10/16)', () => {
  beforeEach(() => {
    resetAttempt();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('카카오톡·휴대폰 구분', () => {
    expect(isKakaoInApp(ANDROID_KAKAO)).toBe(true);
    expect(isKakaoInApp(PLAIN_CHROME)).toBe(false);
    expect([phoneOf(ANDROID_KAKAO), phoneOf(IPHONE_KAKAO), phoneOf('Mozilla/5.0 (Windows NT 10.0)')]).toEqual(['android', 'ios', 'other']);
  });

  it('Chrome 주소: 안드로이드는 Chrome 앱 지정 + 없으면 같은 주소, iPhone은 googlechromes, 지금 주소 그대로', () => {
    expect(chromeUrl(HREF, 'android')).toBe(`intent://subway.metasolveai.com/?a=1#x#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(HREF)};end`);
    expect(chromeUrl(HREF, 'ios')).toBe('googlechromes://subway.metasolveai.com/?a=1#x');
    expect(chromeUrl(HREF, 'other')).toBeNull();
    expect(chromeUrl('javascript:alert(1)', 'android')).toBeNull(); // http(s) 말고는 안 넘김
    expect(kakaoExternalUrl(HREF)).toBe(`kakaotalk://web/openExternal?url=${encodeURIComponent(HREF)}`);
  });

  it('Chrome이 열리면(화면이 넘어가면) 기본 브라우저로 또 열지 않음', () => {
    const { win, went } = fakeWindow(ANDROID_KAKAO, { leaves: true });
    expect(openInChrome(win)).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(went).toHaveLength(1);
    expect(went[0]).toMatch(/^intent:\/\//);
  });

  it('Chrome이 안 열리면 1.5초 뒤 카카오톡 "다른 브라우저로 열기"(iPhone은 Safari)', () => {
    const { win, went } = fakeWindow(IPHONE_KAKAO);
    openInChrome(win);
    vi.advanceTimersByTime(1499);
    expect(went).toEqual(['googlechromes://subway.metasolveai.com/?a=1#x']);
    vi.advanceTimersByTime(2);
    expect(went[1]).toBe(kakaoExternalUrl(HREF));
  });

  it('자동은 탭에 한 번 — 다시 열린 같은 탭(Chrome 없는 안드로이드)에서 끝없이 반복하지 않음, 손으로 누르면 다시', () => {
    const { win, went, store } = fakeWindow(ANDROID_KAKAO);
    openInChrome(win);
    resetAttempt(); // 페이지가 새로 열린 것처럼 메모리만 비움 (탭 기록은 남음)
    expect(store.get('subway.kakao.tried')).toBe('1');
    expect(openInChrome(win)).toBe(false);
    expect(openInChrome(win, { manual: true })).toBe(true);
    expect(went.filter((u) => u.startsWith('intent://'))).toHaveLength(2);
  });

  it('[카카오톡 안에서 계속]을 고른 탭은 자동으로 안 옮김, 카카오톡이 아니면 아무것도 안 함', () => {
    const k = fakeWindow(ANDROID_KAKAO);
    stayInKakao(k.win);
    expect(openInChrome(k.win)).toBe(false);
    const c = fakeWindow(PLAIN_CHROME);
    expect(openInChrome(c.win)).toBe(false);
    expect(c.went).toEqual([]);
  });
});
