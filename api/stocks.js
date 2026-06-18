// api/stocks.js — 삼성전자·SK하이닉스 실시간 시세 (10초 폴링 전용)
//
// market.js(5분 캐시)와 분리한 이유: 프론트엔드가 10초마다 호출해야 하는데, market.js는
// 코스피 지수/모멘텀/외인수급 등 무거운 호출을 여러 개 묶어서 5분 캐시로 운영 중이라
// 같은 엔드포인트를 10초마다 때리면 캐시 설계와 충돌함. 이 파일은 종목 시세 2개만
// 빠르게 가져오는 가벼운 별도 엔드포인트로 분리.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=8'); // 10초 폴링보다 살짝 짧게 캐시해 약간의 버퍼 확보

  try {
    const [samsung, skhynix] = await Promise.allSettled([
      fetchStock('005930'), // 삼성전자
      fetchStock('000660'), // SK하이닉스
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

// 네이버 금융 실시간 시세 API (market.js의 fetchKospi가 쓰는 것과 동일한 호스트/패턴).
// 종목코드 하나로 정규장 시세 + 프리장/애프터장 시세(overMarketPriceInfo)까지 함께 가져옴.
async function fetchStock(code) {
  const r = await fetch(
    `https://polling.finance.naver.com/api/realtime/domestic/stock/${code}`,
    { headers: { Referer: 'https://finance.naver.com/' } }
  );
  if (!r.ok) throw new Error(`naver stock ${code} fetch failed: status ${r.status}`);
  const d = await r.json();
  const o = d.datas?.[0];
  if (!o) throw new Error(`naver stock ${code} response missing datas[0]`);

  // overMarketPriceInfo: 정규장 시간 외(프리/애프터마켓)일 때 네이버가 함께 내려주는 시간외 시세.
  // tradingSessionType: 'PRE_MARKET' | 'AFTER_MARKET' 등. 정규장 중에는 이 필드가 없거나 비어있음.
  const over = o.overMarketPriceInfo || null;

  return {
    code,
    name: o.stockName || '',
    price: parseFloat(o.closePrice ?? 0),                     // 정규장 기준 현재가/종가(원)
    change: parseFloat(o.compareToPreviousClosePrice ?? 0),    // 전일대비(원), 음수면 하락
    changeRate: parseFloat(o.fluctuationsRatio ?? 0),          // 전일대비(%), 음수면 하락
    marketStatus: o.marketStatus || null,                      // 'OPEN' | 'CLOSE' 등 네이버 기준 정규장 상태
    overMarket: over ? {
      sessionType: over.tradingSessionType || null,            // 'PRE_MARKET' | 'AFTER_MARKET'
      price: parseFloat(over.overPrice ?? over.price ?? 0) || null,
      changeRate: parseFloat(over.overFluctuationsRatio ?? over.fluctuationsRatio ?? 0) || null,
    } : null,
  };
}
