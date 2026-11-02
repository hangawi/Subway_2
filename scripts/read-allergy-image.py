# 써브웨이 공식 알레르기 표(이미지, data/official/allergy_img.png)를 칸마다 읽어 data/official/allergens.json으로 저장한다.
# 칸 안의 검은 점 개수로 구분한다: 41개 이상 = ● (포함), 27~35개 = ★ (포함 가능성), 0개 = 없음.
# 줄 이름은 사람이 이미지를 보고 옮겨 적은 것(ROW_LABELS)이다. 표가 바뀌면 줄 수가 달라져서 바로 실패한다.
import json
import sys
from PIL import Image

SRC = 'data/official/allergy_img.png'
OUT = 'data/official/allergens.json'
ALLERGENS = ['난류', '우유', '메밀', '땅콩', '대두', '밀', '고등어', '게', '새우', '돼지고기', '복숭아', '토마토',
             '아황산류', '호두', '닭고기', '쇠고기', '오징어', '조개류', '잣']
COL_X = [217, 254, 291, 329, 365, 403, 440, 477, 514, 551, 589, 626, 663, 700, 737, 774, 811, 849, 886, 923]
SECTIONS = [
    ('샌드위치', '양상추, 토마토, 오이, 양파, 피망, 위트빵 기준', [
        '비엘티', '치킨 데리야끼', '에그마요', '햄', '이탈리안 비엠티', '풀드포크 바비큐', '로스트 치킨', '로티세리 바비큐 치킨',
        '쉬림프', '스파이시 이탈리안', '스테이크&치즈(아메리칸치즈포함)', '써브웨이 클럽(터키)', '베지', '참치', '치킨 슬라이스',
        '터키', '치킨 베이컨 아보카도', '터키 베이컨 아보카도', '스파이시 쉬림프', '에그 슬라이스', '안창 비프',
        '안창 비프&New 머쉬룸(F)', '안창 비프&New 머쉬룸(S)', 'New 머쉬룸(F)', 'New 머쉬룸(S)', '피자썹', '잠봉', '잠봉 플러스',
        '이탈리안 비엠티(J)', '써브웨이 클럽(J)', '써브웨이 클럽(JC)', '아기맹새우', '로스트 치킨 아보카도']),
    ('아침 메뉴 샌드위치', '아메리칸 치즈, 위트빵 기준', ['햄, 에그&치즈', '웨스턴, 에그&치즈', '잠봉, 에그&치즈', '웨스턴, 에그&치즈(J)']),
    ('아침 메뉴 랩/그릴드 랩', '아메리칸 치즈, 통밀랩 기준', [
        '햄, 에그&치즈 랩 or 그릴드 랩', '웨스턴, 에그&치즈 랩 or 그릴드 랩', '잠봉, 에그&치즈 랩 or 그릴드 랩',
        '웨스턴, 에그&치즈 랩 or 그릴드 랩(J)']),
    ('치즈', None, ['아메리칸 치즈', '모차렐라 치즈', '슈레드 치즈']),
    ('샐러드', None, [
        '그린', '참치 아보카도', '에그마요 베이컨', '로티세리 치킨 더블치즈', '로스트 치킨 베이컨', '쉬림프 아보카도', '스테이크&머쉬룸',
        '풀드포크 타코', '로티세리 치킨 타코', '스파이시 쉬림프 타코', '그린(G)', '참치 아보카도(G)', '에그마요 베이컨(G)',
        '로티세리 치킨 더블치즈(G)', '로스트 치킨 베이컨(G)', '쉬림프 아보카도(G)', '스테이크&머쉬룸(G)', '풀드포크 타코(G)',
        '로티세리 치킨 타코(G)', '스파이시 쉬림프 타코(G)', '그레인 믹스']),
    ('랩, 그릴드 랩', None, [
        '치킨 베이컨 미니 랩', '쉬림프 에그마요 랩', '스테이크&치즈 아보카도 랩', '치킨 베이컨 미니 그릴드 랩', '쉬림프 에그 그릴드 랩',
        '스테이크&치즈 아보카도 그릴드 랩']),
    ('빵', None, ['플랫 브레드', '허니 오트', '파마산 오레가노', '위트', '화이트', '통밀 랩', '그레인', '꼬마빵']),
    ('야채', None, ['아보카도', '오이', '피망', '할라피뇨', '양상추', '올리브', '양파', '토마토']),
    ('소스&드레싱', None, [
        '머스터드', '허니 머스터드', '홀스 래디쉬', '핫 칠리', '케첩', '마요네즈', '엑스트라 버진 올리브 오일', '랜치', '레드와인 식초',
        '스모크 바비큐', '사우스웨스트 치폴레', '스위트 칠리', '스위트 어니언', '저당 크리미 어니언', '저칼로리 오리엔탈']),
    ('미트류', None, [
        '베이컨 비츠', '베이컨', '치킨 데리야끼', '에그마요', '오믈렛', '햄', '페퍼로니', '풀드 포크 바비큐', '로스트 치킨',
        '로티세리 바비큐 치킨', '살라미', '쉬림프', '스테이크', '참치', '터키', '스파이시 쉬림프', '에그 슬라이스', '안창 비프', '머쉬룸',
        '잠봉', '치킨 슬라이스 햄']),
    ('스마일 썹', '수프, 사이드, 쿠키', [
        '머쉬룸 수프(M)', '콘 수프', '포테이토 베이컨 수프', '해쉬브라운', '웨지 포테이토', 'Cheesy 웨지 포테이토',
        'Bacon Cheesy 웨지 포테이토', '초코칩 쿠키', '더블 초코칩 쿠키', '오트밀 레이즌 쿠키', '라즈베리 치즈케이크 쿠키',
        '화이트 초코 마카다미아 쿠키', '오렌지 초코 칩 쿠키']),
]


def green(p):
    r, g, b = p
    return g > r + 30 and g > b + 10 and g < 200


def read_grid(path):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    px = im.load()
    lines = [y for y in range(h) if sum(1 for x in range(230, 960, 2) if green(px[x, y])) > 250]
    groups, start, prev = [], lines[0], lines[0]
    for y in lines[1:]:
        if y != prev + 1:
            groups.append((start, prev))
            start = y
        prev = y
    groups.append((start, prev))
    sections, section = [], -1
    for (a, b), (c, _) in zip(groups, groups[1:]):
        if b - a > 20:  # 초록 띠 = 구역 제목
            section += 1
            sections.append([])
        top, bot = b + 1, c - 1
        if bot - top < 15 or section < 0:
            continue
        row = []
        for j in range(len(ALLERGENS)):
            dark = sum(1 for x in range(COL_X[j] + 2, COL_X[j + 1] - 2) for y in range(top + 2, bot - 2)
                       if sum(px[x, y]) < 200)
            if dark == 0:
                row.append('')
            elif dark >= 41:
                row.append('CONTAINS')
            elif 27 <= dark <= 35:
                row.append('MAY_CONTAIN')
            else:
                raise SystemExit(f'판독 불가 칸: 구역 {section} 줄 {len(sections[section])} 열 {ALLERGENS[j]} 점 {dark}개')
        sections[section].append(row)
    return sections


def main():
    grid = read_grid(SRC)
    if len(grid) != len(SECTIONS):
        sys.exit(f'구역 수가 다름: 이미지 {len(grid)}, 이름 {len(SECTIONS)}')
    out = []
    for (name, basis, labels), rows in zip(SECTIONS, grid):
        if len(rows) != len(labels):
            sys.exit(f'{name}: 줄 수가 다름 (이미지 {len(rows)}, 이름 {len(labels)})')
        for label, row in zip(labels, rows):
            out.append({
                'section': name,
                'basis': basis,
                'name': label,
                'contains': [a for a, v in zip(ALLERGENS, row) if v == 'CONTAINS'],
                'mayContain': [a for a, v in zip(ALLERGENS, row) if v == 'MAY_CONTAIN'],
            })
    doc = {
        'source': {
            'site': 'https://www.subway.co.kr/sandwichAllergy',
            'image': 'https://www.subway.co.kr/images/menu/allergy_img.png?2026080101',
            'legend': '● 포함 (contains), ★ 포함 가능성 있음 (mayContain)',
        },
        'allergens': ALLERGENS,
        'rows': out,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f'rows {len(out)}')


if __name__ == '__main__':
    main()
