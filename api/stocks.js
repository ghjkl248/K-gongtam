// api/stocks.js — 삼성전자·SK하이닉스 실시간 시세 (10초 폴링 전용)
//
// market.js(5분 캐시)와 분리한 이유: 프론트엔드가 10초마다 호출해야 하는데, market.js는
// 코스피 지수/모멘텀/외인수급 등 무거운 호출을 여러 개 묶어서 5분 캐시로 운영 중이라
// 같은 엔드포인트를 10초마다 때리면 캐시 설계와 충돌함. 이 파일은 종목 시세 2개만
// 빠르게 가져오는 가벼운 별도 엔드포인트로 분리.
//
// 해외 추정가(바이비트/바이낸스 무기한 선물) 시도 결과: 바이비트는 403, 바이낸스는 451으로
// 둘 다 지역 차단되어 안정적으로 가져올 수 없는 것으로 확인됨. 잘못되거나 항상 실패하는 값을
// 보여주는 대신, 해외 추정가 기능은 제거하고 국내가만 정확하고 빠르게 제공하는 데 집중함.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // no-store: 이 응답은 절대 캐시하지 않음. 10초 폴링인데 캐시가 끼면 화면이 멈춘 것처럼 보임
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const [samsung, skhynix] = await Promise.allSettled([
      fetchStock('005930'), // 삼성전자 (네이버, 국내 정규장/프리/애프터 기준)
      fetchStock('000660'), // SK하이닉스 (네이버, 국내 정규장/프리/애프터 기준)
    ]);

    if (samsung.status === 'rejected') console.error('stocks: 삼성전자 조회 실패:', samsung.reason?.message);
    if (skhynix.status === 'rejected') console.error('stocks: SK하이닉스 조회 실패:', skhynix.reason?.message);

    res.status(200).json({
      samsung: samsung.status === 'fulfilled' ? samsung.value : null,
      skhynix: skhynix.status === 'fulfilled' ? skhynix.value : null,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('stocks: handler 전역 예외:', e.message);
    res.status(500).json({ error: e.message });
  }
}

// 네이버 응답의 숫자 필드는 "362,500"처럼 천 단위 쉼표가 포함된 문자열로 내려옴.
// parseFloat("362,500")은 쉼표에서 즉시 멈춰 362만 읽어버리는 버그가 있었음(₩362로 보이던 원인).
// 반드시 쉼표를 먼저 제거하고 숫자로 변환해야 함.
function toNum(v){
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const cleaned = String(v).replace(/,/g, '').trim();
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

// 네이버 금융 실시간 시세 API (market.js의 fetchKospi가 쓰는 것과 동일한 호스트/패턴).
// cache: 'no-store'를 명시해 Vercel 함수 내부에서도 네이버 응답이 재사용되지 않게 강제함.
async function fetchStock(code) {
  const r = await fetch(
    `https://polling.finance.naver.com/api/realtime/domestic/stock/${code}`,
    { headers: { Referer: 'https://finance.naver.com/' }, cache: 'no-store' }
  );
  if (!r.ok) throw new Error(`naver stock ${code} fetch failed: status ${r.status}`);
  const d = await r.json();
  const o = d.datas?.[0];
  if (!o) throw new Error(`naver stock ${code} response missing datas[0]`);

  const price      = toNum(o.closePrice);
  const change     = toNum(o.compareToPreviousClosePrice);
  const changeRate = toNum(o.fluctuationsRatio);

  // 방어적 검증: 삼성전자/SK하이닉스는 항상 수만~수백만원대이므로, 비정상적으로 작은 값이
  // 나오면(파싱 오류 등) 0 대신 명확히 실패로 처리해서 화면에 이상한 가격이 뜨지 않게 함
  if (price < 1000) {
    throw new Error(`naver stock ${code} price looks invalid: raw=${o.closePrice}, parsed=${price}`);
  }

  return {
    code,
    name: o.stockName || '',
    price,                      // 현재가(원) — 프리/정규/애프터장에 따라 네이버가 알맞은 값을 반영
    change,                     // 전일대비(원), 음수면 하락
    changeRate,                 // 전일대비(%), 음수면 하락
    marketStatus: o.marketStatus || null,
  };
}
