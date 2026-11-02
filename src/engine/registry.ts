// 써브웨이가 김민지 SOPHIA 공통 엔진에 붙이는 판단 규칙(어댑터) 등록부. 엔진은 새로 만들지 않는다.
import { DomainRegistry } from '../../vendor/sophia/pure_engine/decision-graph.ts';
import { subwayMenuDomain } from '../subway-menu/menu-domain.ts';
import { subwayStoreDomain } from '../subway-store/store-domain.ts';

export const SUBWAY_DOMAINS = new DomainRegistry().register(subwayStoreDomain).register(subwayMenuDomain);
