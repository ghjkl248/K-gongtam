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
    const [samsung, skhynix, usdkrw, samsungBn, skhynixBn] = await Promise.allSettled([
      fetchStock('005930'), // 삼성전자 (네이버, 국내 정규장 기준)
      fetchStock('000660'), // SK하이닉스 (네이버, 국내 정규장 기준)
      fetchUSDKRW(),         // 환율도 10초마다 함께 갱신 (해외 환산가 계산용)
      fetchBinancePerp('SAMSUNGUSDT'),  // 바이낸스 무기한 선물 — 해외(USD) 추정가 소스
      fetchBinancePerp('SKHYNIXUSDT'),
    ]);

    if (samsung.status === 'rejected') console.error('stocks: 삼성전자 조회 실패:', samsung.reason?.message);
    if (skhynix.status === 'rejected') console.error('stocks: SK하이닉스 조회 실패:', skhynix.reason?.message);
    if (usdkrw.status === 'rejected')  console.error('stocks: 환율 조회 실패:', usdkrw.reason?.message);
    if (samsungBn.status === 'rejected') console.error('stocks: 삼성전자 바이낸스 조회 실패:', samsungBn.reason?.message);
    if (skhynixBn.status === 'rejected') console.error('stocks: SK하이닉스 바이낸스 조회 실패:', skhynixBn.reason?.message);

    res.status(200).json({
      samsung: samsung.status === 'fulfilled' ? samsung.value : null,
      skhynix: skhynix.status === 'fulfilled' ? skhynix.value : null,
      usdkrw: usdkrw.status === 'fulfilled' ? usdkrw.value : null,
      samsungOverseasUsd: samsungBn.status === 'fulfilled' ? samsungBn.value : null,
      skhynixOverseasUsd: skhynixBn.status === 'fulfilled' ? skhynixBn.value : null,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('stocks: handler 전역 예외:', e.message);
    res.status(500).json({ error: e.message });
  }
}

// 바이낸스 USDT 무기한 선물(perpetual futures) 가격 조회. 인증 불필요한 공개 마켓 데이터 엔드포인트.
// 삼성전자/SK하이닉스는 한국거래소 외 정식 상장이 없어서, "해외에서 실시간으로 거래되는 가격"에
// 가장 가까운 공개 소스가 바이낸스의 SAMSUNGUSDT/SKHYNIXUSDT 무기한 선물(2025.6 상장)임.
// 단, 이는 현금(USDT) 정산되는 파생상품 가격으로 한국 코스피 정식 시세가 아니라 참고용 추정치임.
// 한국 거주자는 바이낸스 본사 차원에서 이 상품 이용이 제한되지만, 가격 조회 자체(공개 API)는
// Vercel 서버(해외 리전)에서 호출하므로 영향받지 않음.
async function fetchBinancePerp(symbol) {
  const r = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
  if (!r.ok) throw new Error(`binance ${symbol} fetch failed: status ${r.status}`);
  const d = await r.json();
  const price = parseFloat(d.price);
  if (!price || Number.isNaN(price)) throw new Error(`binance ${symbol} invalid price: ${JSON.stringify(d)}`);
  return price; // USD(USDT 기준) 가격
}

// market.js의 fetchUSDKRW와 동일한 소스(Yahoo Finance). 10초 폴링 화면에서 환율도
// "살아있는 값"으로 보여주기 위해 이 파일에서도 독립적으로 조회함.
async function fetchUSDKRW() {
  const r = await fetch(
    'https://query1.finance.yahoo.com/v8/finance/chart/USDKRW=X?interval=1d&range=1d',
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  if (!r.ok) throw new Error('yahoo USDKRW fetch failed: status ' + r.status);
  const d = await r.json();
  const price = d.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (!price) throw new Error('yahoo USDKRW response missing regularMarketPrice');
  return price;
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
    price,                      // 정규장 기준 현재가/종가(원)
    change,                     // 전일대비(원), 음수면 하락
    changeRate,                 // 전일대비(%), 음수면 하락
    marketStatus: o.marketStatus || null, // 'OPEN' | 'CLOSE' 등 네이버 기준 정규장 상태
    overMarket: over ? {
      sessionType: over.tradingSessionType || null, // 'PRE_MARKET' | 'AFTER_MARKET'
      price: toNum(over.overPrice ?? over.price) || null,
      changeRate: toNum(over.overFluctuationsRatio ?? over.fluctuationsRatio) || null,
    } : null,
  };
}
