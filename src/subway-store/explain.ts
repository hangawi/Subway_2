// 매장 추천 이유 (엔진 이유 코드 + 엔진에 넣은 매장 사실만): "걸어서 5분, 지금 영업 중"
import type { StoreFacts } from '../stores/store-facts.ts';

const MODE = { WALK: '걸어서', TRANSIT: '대중교통', CAR: '차로' } as const;

/** holiday: 오늘 공휴일 이름 (안내만 — 영업 여부는 매장 영업시간으로 판단) */
export function explainStore(s: StoreFacts, reasons: string[], holiday: string | null = null): string[] {
  const out: string[] = [];
  const unknownTravel = reasons.includes('TRAVEL_UNKNOWN');
  out.push(unknownTravel ? `이동 시간 확인 필요 (${(s.distanceM / 1000).toFixed(1)}km)` : `${MODE[s.travel.mode]} ${s.travel.minutes}분${reasons.includes('TRAVEL_ESTIMATED') ? ' (거리로 추정)' : ''}`);
  if (reasons.includes('OPEN_NOW')) out.push('지금 영업 중');
  if (reasons.includes('HOURS_UNKNOWN')) out.push('영업시간 확인 필요');
  if (s.specialToday) out.push('오늘은 매장이 따로 정한 영업시간이에요');
  else if (holiday) out.push(`${holiday} — 매장마다 다를 수 있어요`);
  return out;
}

export function explainStoreRejection(reasons: string[]): string[] {
  return reasons.map((r) =>
    r === 'CLOSED_NOW' ? '지금 문을 닫았어요' : r === 'CLOSING_SOON' ? '30분 안에 문을 닫아요' : r === 'TOO_FAR' ? '이동 시간이 너무 길어요' : `확인 필요 (${r})`,
  );
}
