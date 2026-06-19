// api/heatmap.js — 코스피 시가총액 상위 종목 히트맵 데이터
//
// 데이터 소스: 네이버 금융 모바일 시가총액 순위 API (m.stock.naver.com).
// 한 번 호출로 시가총액 상위 N개 종목의 코드/이름/현재가/등락폭/등락률/시가총액을
// 모두 받을 수 있어 종목별로 따로 호출할 필요가 없음(stocks.js처럼 종목당 1회씩 부르는
// 방식보다 훨씬 가벼움).
//
// 5분 캐시: 히트맵은 대화방/구성지표처럼 초 단위로 바뀔 필요가 없고(시가총액 순위 자체가
// 자주 안 바뀜), 네이버 서버에 부담을 주지 않기 위해 market.js와 같은 5분 캐시를 둠.

const TOP_N = 36; // 모바일 화면에서 트리맵으로 보기 좋은 개수 (요청에 따라 상위 30~40개 선)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300'); // 5분 캐시

  try {
    const stocks = await fetchTopMarketCap(TOP_N);
    res.status(200).json({ stocks, updatedAt: new Date().toISOString() });
  } catch (e) {
    console.error('heatmap: 조회 실패:', e.message);
    res.status(500).json({ error: e.message });
  }
}

// 네이버 응답 숫자 필드는 이미 숫자형(쉼표 없는 number)으로 내려오는 경우가 많지만,
// 혹시 문자열로 오는 경우를 대비해 안전하게 변환.
function toNum(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/,/g, '').trim());
  return Number.isNaN(n) ? 0 : n;
}

async function fetchTopMarketCap(n) {
  const r = await fetch(
    `https://m.stock.naver.com/api/json/sise/siseListJson.nhn?menu=market_sum&sosok=0&pageSize=${n}&page=1`,
    { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' }
  );
  if (!r.ok) throw new Error(`naver market_sum fetch failed: status ${r.status}`);
  const d = await r.json();

  // 응답 형식이 과거엔 { result: { itemList: [...] } } 형태였던 적도 있어, 두 형태 모두 대응
  const list = d?.result?.itemList || d?.result || d?.itemList || d;
  if (!Array.isArray(list)) throw new Error('naver market_sum response format unexpected: ' + JSON.stringify(d).slice(0, 200));

  return list.slice(0, n).map(o => ({
    code: o.cd || o.itemcode || '',
    name: o.nm || o.itemname || '',
    price: toNum(o.nv ?? o.close_val),
    change: toNum(o.cv ?? o.change_val),
    changeRate: toNum(o.cr ?? o.changeRate),
    marketCap: toNum(o.mks ?? o.market_sum), // 억원 단위
  })).filter(s => s.code && s.name);
}
